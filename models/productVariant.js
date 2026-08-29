// models/productVariant.js
// Handles all DB operations for the variants system:
//   product_variant_attributes  – the dimension names (Colour, Size, RAM …)
//   product_variants            – each purchasable combination
//   product_variant_options     – the values for each combination
//
// Variants deliberately have no price of their own - see upsertVariant
// below for why. Every variant always uses its parent product's price.

const pool = require('../db');
const { computeFinalPrice } = require('../helpers');

const ProductVariant = {

  // One-time cleanup for variants that already had a price set before
  // per-variant pricing was removed - clears every price-related column
  // so cart.js's COALESCE(v.price, p.price) correctly falls through to
  // the parent product's price for all of them. Safe to run more than
  // once; a variant with nothing left to clear is just skipped.
  async clearVariantPricing() {
    const [result] = await pool.query(
      `UPDATE product_variants
       SET price = NULL, seller_price = NULL, price_margin = NULL,
           price_delivery_allocation = NULL, price_risk_allocation = NULL, original_price = NULL
       WHERE price IS NOT NULL OR seller_price IS NOT NULL`
    );
    return { cleared: result.affectedRows };
  },

  // ── Attributes (dimension names for one product) ────────────────────

  // names can be either plain strings (backward compatible - every
  // existing caller that just sends ['Colour','Size'] keeps working
  // exactly as before, defaulting to single-select) or objects
  // {name, selection_type} for the new multi-select feature. A group
  // marked 'multiple' lets a buyer pick more than one value at once
  // (e.g. several sizes) and add them all as separate cart lines in one
  // action - 'single' (the default) behaves exactly as it always has.
  async setAttributes(productId, names) {
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM product_variant_attributes WHERE product_id = ?', [productId]);
      if (names && names.length) {
        const rows = names.map((n, i) => {
          const isObj = typeof n === 'object' && n !== null;
          const name = (isObj ? n.name : n).trim();
          const selectionType = (isObj && n.selection_type === 'multiple') ? 'multiple' : 'single';
          return [productId, name, i, selectionType];
        });
        await conn.query(
          'INSERT INTO product_variant_attributes (product_id, name, position, selection_type) VALUES ?',
          [rows]
        );
      }
      await conn.commit();
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  async getAttributes(productId) {
    const [rows] = await pool.query(
      'SELECT * FROM product_variant_attributes WHERE product_id = ? ORDER BY position',
      [productId]
    );
    return rows;
  },

  // ── Variants ────────────────────────────────────────────────────────

  /**
   * upsertVariant — creates or updates a single variant row, then
   * replaces its option values entirely.
   *
   * Per-variant pricing (deliberately removed earlier, then explicitly
   * asked to come back so different sizes/options can have genuinely
   * different prices - see Master Product System Upgrade spec). A
   * variant's own seller_price is optional: when provided, its final
   * buyer-facing price is computed through the exact same
   * computeFinalPrice() formula the parent product uses (commission
   * bracket off the variant's own price, delivery fee off the PARENT
   * product's weight, since a variant has no weight of its own). When
   * not provided, price/seller_price are explicitly cleared to NULL, so
   * cart.js's COALESCE(v.price, p.price) falls through to the parent
   * product's price - letting some variants of a product carry their
   * own price while others simply inherit the base price.
   *
   * @param {number}   productId
   * @param {object}   variantData  { id?, sku?, stock, images_json?,
   *                                  is_active?, seller_price?, original_price?,
   *                                  options: [{attribute_id, value}] }
   * @returns {number} variant id
   */
  async upsertVariant(productId, variantData) {
    const { id, sku, stock, images_json, is_active = 1, seller_price, original_price, kanyaga_price, options = [] } = variantData;

    // Price this variant using the parent product's weight (variants
    // don't carry their own weight) - only when a real seller_price was
    // actually given; otherwise leave every pricing column NULL so this
    // variant inherits the parent's price via COALESCE at read time.
    let priced = null;
    if (seller_price !== undefined && seller_price !== null && seller_price !== '') {
      const [[product]] = await pool.query('SELECT weight FROM products WHERE id = ?', [productId]);
      priced = computeFinalPrice(seller_price, { weight: product ? product.weight : 1 });
    }

    // A variant's own Kanyaga price - deliberately just a flat KES
    // amount, not run through the pricing formula, matching the exact
    // same convention as the product-level Kanyaga price it can
    // override. Left blank/undefined means "use the product's one flat
    // Kanyaga price for this variant too", same COALESCE fallback used
    // for seller_price/price above.
    const kanyagaPriceValue = (kanyaga_price !== undefined && kanyaga_price !== null && kanyaga_price !== '')
      ? Number(kanyaga_price)
      : null;

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let variantId;
      if (id) {
        // Update existing variant
        await conn.query(
          `UPDATE product_variants
           SET sku = ?, price = ?, seller_price = ?, original_price = ?, kanyaga_price = ?,
               stock = ?, images_json = ?, is_active = ?
           WHERE id = ? AND product_id = ?`,
          [sku || null, priced ? priced.finalPrice : null, priced ? priced.sellerPrice : null,
           (original_price !== undefined && original_price !== null && original_price !== '') ? original_price : null,
           kanyagaPriceValue,
           stock, images_json || null, is_active ? 1 : 0, id, productId]
        );
        variantId = id;
      } else {
        // Insert new variant
        const [result] = await conn.query(
          `INSERT INTO product_variants (product_id, sku, price, seller_price, original_price, kanyaga_price, stock, images_json, is_active)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [productId, sku || null, priced ? priced.finalPrice : null, priced ? priced.sellerPrice : null,
           (original_price !== undefined && original_price !== null && original_price !== '') ? original_price : null,
           kanyagaPriceValue,
           stock, images_json || null, is_active ? 1 : 0]
        );
        variantId = result.insertId;
      }

      // Replace option values for this variant
      await conn.query('DELETE FROM product_variant_options WHERE variant_id = ?', [variantId]);
      if (options.length) {
        const rows = options.map(o => [variantId, o.attribute_id, o.value.trim()]);
        await conn.query(
          'INSERT INTO product_variant_options (variant_id, attribute_id, value) VALUES ?',
          [rows]
        );
      }

      await conn.commit();
      return variantId;
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  },

  async deleteVariant(variantId, productId) {
    // product_variant_options are cascade-deleted by FK
    const [result] = await pool.query(
      'DELETE FROM product_variants WHERE id = ? AND product_id = ?',
      [variantId, productId]
    );
    return result.affectedRows > 0;
  },

  async deleteVariantAsAdmin(variantId) {
    const [result] = await pool.query('DELETE FROM product_variants WHERE id = ?', [variantId]);
    return result.affectedRows > 0;
  },

  async updateStock(variantId, stock) {
    await pool.query('UPDATE product_variants SET stock = ? WHERE id = ?', [stock, variantId]);
  },

  // Price-only update - deliberately separate from upsertVariant, which
  // replaces a variant's full option set from whatever's in the request
  // body. A price-only PATCH (like the existing stock PATCH) must never
  // risk wiping out a variant's Colour/Size options just because they
  // weren't included in this particular request.
  //
  // sellerPrice and originalPrice are each independently optional here -
  // `undefined` means "this field wasn't part of this request, leave it
  // alone" (e.g. the Original Price input firing its own PATCH with only
  // original_price, without also blanking out an already-set seller
  // price), while an explicit '' means "clear this field back to using
  // the parent product's price."
  async updatePrice(variantId, productId, sellerPrice, originalPrice) {
    const sets = [];
    const values = [];

    if (sellerPrice !== undefined) {
      if (sellerPrice === null || sellerPrice === '') {
        sets.push('price = NULL', 'seller_price = NULL');
      } else {
        const [[product]] = await pool.query('SELECT weight FROM products WHERE id = ?', [productId]);
        const priced = computeFinalPrice(sellerPrice, { weight: product ? product.weight : 1 });
        sets.push('price = ?', 'seller_price = ?');
        values.push(priced.finalPrice, priced.sellerPrice);
      }
    }
    if (originalPrice !== undefined) {
      sets.push('original_price = ?');
      values.push((originalPrice === null || originalPrice === '') ? null : originalPrice);
    }
    if (!sets.length) return;

    values.push(variantId, productId);
    await pool.query(
      `UPDATE product_variants SET ${sets.join(', ')} WHERE id = ? AND product_id = ?`,
      values
    );
  },

  async decrementStock(variantId, qty) {
    await pool.query(
      'UPDATE product_variants SET stock = GREATEST(0, stock - ?) WHERE id = ?',
      [qty, variantId]
    );
  },

  // ── Fetching ────────────────────────────────────────────────────────

  /**
   * Returns all variants for a product, each enriched with its option
   * values as an array: options = [{attribute_id, attribute_name, value}]
   */
  async findByProduct(productId) {
    const [variants] = await pool.query(
      `SELECT v.*, GROUP_CONCAT(
         CONCAT(a.id, ':', a.name, '=', o.value)
         ORDER BY a.position SEPARATOR '||'
       ) AS _options_raw
       FROM product_variants v
       LEFT JOIN product_variant_options o ON o.variant_id = v.id
       LEFT JOIN product_variant_attributes a ON a.id = o.attribute_id
       WHERE v.product_id = ?
       GROUP BY v.id
       ORDER BY v.id`,
      [productId]
    );
    return variants.map(v => ({
      ...v,
      images: v.images_json ? JSON.parse(v.images_json) : [],
      options: v._options_raw
        ? v._options_raw.split('||').map(raw => {
            const colonIdx = raw.indexOf(':');
            const eqIdx    = raw.indexOf('=');
            return {
              attribute_id:   Number(raw.slice(0, colonIdx)),
              attribute_name: raw.slice(colonIdx + 1, eqIdx),
              value:          raw.slice(eqIdx + 1)
            };
          })
        : [],
      _options_raw: undefined
    }));
  },

  async findVariantById(variantId) {
    const [rows] = await pool.query(
      `SELECT v.*, GROUP_CONCAT(
         CONCAT(a.id, ':', a.name, '=', o.value)
         ORDER BY a.position SEPARATOR '||'
       ) AS _options_raw
       FROM product_variants v
       LEFT JOIN product_variant_options o ON o.variant_id = v.id
       LEFT JOIN product_variant_attributes a ON a.id = o.attribute_id
       WHERE v.id = ?
       GROUP BY v.id`,
      [variantId]
    );
    if (!rows[0]) return null;
    const v = rows[0];
    return {
      ...v,
      images: v.images_json ? JSON.parse(v.images_json) : [],
      options: v._options_raw
        ? v._options_raw.split('||').map(raw => {
            const colonIdx = raw.indexOf(':');
            const eqIdx    = raw.indexOf('=');
            return {
              attribute_id:   Number(raw.slice(0, colonIdx)),
              attribute_name: raw.slice(colonIdx + 1, eqIdx),
              value:          raw.slice(eqIdx + 1)
            };
          })
        : [],
      _options_raw: undefined
    };
  },

  /**
   * Full product detail including all variants and attributes.
   * Used by the public product detail page.
   */
  async getProductWithVariants(productId) {
    const attributes = await this.getAttributes(productId);
    const variants   = await this.findByProduct(productId);

    // Build a lookup matrix: { [attrName]: Set<value> }
    const valueSets = {};
    for (const attr of attributes) valueSets[attr.name] = new Set();
    for (const v of variants) {
      for (const o of v.options) valueSets[o.attribute_name]?.add(o.value);
    }

    return {
      attributes,
      variants,
      // Unique values per attribute for the buyer-side picker
      attributeValues: Object.fromEntries(
        Object.entries(valueSets).map(([k, s]) => [k, [...s]])
      )
    };
  },

  // Admin inventory overview
  async getLowStockVariants(threshold = 5) {
    const [rows] = await pool.query(
      `SELECT v.*, p.name AS product_name,
              GROUP_CONCAT(CONCAT(a.name, '=', o.value) ORDER BY a.position SEPARATOR ', ') AS label
       FROM product_variants v
       JOIN products p ON p.id = v.product_id
       LEFT JOIN product_variant_options o ON o.variant_id = v.id
       LEFT JOIN product_variant_attributes a ON a.id = o.attribute_id
       WHERE v.stock <= ?
       GROUP BY v.id
       ORDER BY v.stock ASC`,
      [threshold]
    );
    return rows;
  }
};

module.exports = ProductVariant;
