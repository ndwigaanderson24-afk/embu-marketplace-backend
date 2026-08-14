# Seller "Verified" badge — backend pieces

## Status: fully done, backend-side. Only the SQL migration is left for you to run.

## 1. Database migration — you still need to run this

```sql
ALTER TABLE users ADD COLUMN verified BOOLEAN NOT NULL DEFAULT FALSE;
```

## 2. Model — done

`models/user.js`:
- `verified` added to the `findAllSellers()` SELECT.
- New `User.setVerified(id, verified)` method.

## 3. Controller — done

`controllers/adminController.js` has `exports.setSellerVerified`,
right next to `approveSeller`/`activateSeller`, in the same style
(`sendSuccess`/`sendError`, `logActivity`, a `Notification.create` on
verify — matching how `approveSeller`/`rejectSeller` already notify).

## 4. Route — done

`routes/adminRoutes.js` now has:

```js
router.put('/sellers/:id/verify', wrap(admin.setSellerVerified));
```

Added right after `/sellers/:id/activate`, inside the same
`router.use(protect, requireAdmin)` block as the rest of the seller
routes — so it's already protected the same way `/approve` and
`/reject` are.

## That's it

Run the migration, restart your server, and the frontend's "Mark
Verified" button will work end-to-end.
