// models/productVariant.js
// Handles all DB operations for the variants system:
//   product_variant_attributes  – the dimension names (Colour, Size, RAM …)
//   product_variants            – each purchasable combination
//   product_variant_options     – the values for each combination

const pool = require('../db');
const Product = require('./product');
const PricingRule = require('./pricingRule');
const PricingSettings = require('./pricingSettings');
const { computeFinalPrice } = require('../helpers');

// A variant has no category/fragile of its own - it belongs to a parent
// product that does, so pricing a variant means fetching that parent's
// category/fragile and running the exact same calculation used for the
// product itself. This is what makes selecting a colour/size now show a
// real, calculated price instead of whatever raw number was typed in.
async function priceVariant(sellerPrice, productId) {
  const [product, rules, settings] = await Promise.all([
    Product.findById(productId),
    PricingRule.findAllActive(),
    PricingSettings.get()
  ]);
  return computeFinalPrice(sellerPrice, { category: product?.category, fragile: !!product?.fragile }, rules, settings);
}

const ProductVariant = {

  // Exposed for a live "buyer will pay" preview while adding/editing a
  // variant, same pattern as Product.previewPrice.
  async previewPrice(sellerPrice, productId) {
    return priceVariant(sellerPrice, productId);
  },

  // ── Attributes (dimension names for one product) ────────────────────

  async setAttributes(productId, names) {
    // Replace all attribute rows for this product atomically.
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.query('DELETE FROM product_variant_attributes WHERE product_id = ?', [productId]);
      if (names && names.length) {
        const rows = names.map((n, i) => [productId, n.trim(), i]);
        await conn.query(
          'INSERT INTO product_variant_attributes (product_id, name, position) VALUES ?',
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
   * @param {number}   productId
   * @param {object}   variantData  { id?, sku?, seller_price, original_price?,
   *                                  stock, images_json?, is_active?,
   *                                  options: [{attribute_id, value}] }
   * @returns {number} variant id
   */
  async upsertVariant(productId, variantData) {
    const { id, sku, seller_price, original_price, stock, images_json, is_active = 1, options = [] } = variantData;
    const priced = await priceVariant(seller_price, productId);

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      let variantId;
      if (id) {
        // Update existing variant
        await conn.query(
          `UPDATE product_variants
           SET sku = ?, price = ?, seller_price = ?, price_margin = ?, price_delivery_allocation = ?,
               price_risk_allocation = ?, original_price = ?, stock = ?, images_json = ?, is_active = ?
           WHERE id = ? AND product_id = ?`,
          [sku || null, priced.finalPrice, priced.sellerPrice, priced.margin, priced.deliveryAllocation,
           priced.riskAllocation, original_price || null, stock, images_json || null, is_active ? 1 : 0, id, productId]
        );
        variantId = id;
      } else {
        // Insert new variant
        const [result] = await conn.query(
          `INSERT INTO product_variants
             (product_id, sku, price, seller_price, price_margin, price_delivery_allocation,
              price_risk_allocation, original_price, stock, images_json, is_active)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [productId, sku || null, priced.finalPrice, priced.sellerPrice, priced.margin, priced.deliveryAllocation,
           priced.riskAllocation, original_price || null, stock, images_json || null, is_active ? 1 : 0]
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
