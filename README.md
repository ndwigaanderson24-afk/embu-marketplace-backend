# Embu Marketplace — Backend (Complete)

MySQL/Express backend matching **embu-marketplace.html** exactly, now with
everything filled in: seller management, withdrawals, product reviews,
notifications, file uploads, and admin analytics.

## Full structure

```
embu-backend-final/
├── server.js
├── db.js
├── helpers.js              # delivery pricing, subscription pricing, JWT, response format
├── seed.js
├── package.json
├── .env
├── sql/schema.sql          # 11 tables
├── models/
│   ├── user.js              # unified customer/seller account
│   ├── product.js
│   ├── order.js              # multi-seller checkout splitting
│   ├── cart.js                # guest (session) + logged-in cart
│   ├── withdrawal.js
│   ├── review.js
│   └── notification.js
├── controllers/
│   ├── authController.js     # register/login/apply-seller/subscribe
│   ├── productController.js  # CRUD + reviews
│   ├── withdrawalController.js
│   └── adminController.js    # sellers, earnings, referrals, analytics, announcements
├── routes/
│   ├── authRoutes.js
│   ├── productRoutes.js
│   ├── orderRoutes.js        # checkout, tracking, status, rider, rating (inline handlers)
│   ├── cartRoutes.js
│   ├── withdrawalRoutes.js
│   └── adminRoutes.js
├── middleware/
│   ├── auth.js                # protect / optionalAuth / requireAdmin / requireActiveSeller
│   └── upload.js               # multer: documents + product images
└── uploads/
    ├── documents/
    └── products/
```

Verified the same way as before (no live DB or `npm install` possible in
this environment — no network access here): all 23 JS files pass a syntax
check, every `require()` path resolves to a real file (including the
inline `require()` calls inside route handlers), and every route handler
referenced exists as an export in its controller.

## What's new since the last version

| Area | What was added |
|---|---|
| Admin | Full seller management (approve/reject/suspend/reactivate), seller earnings overview, referral overview, analytics dashboard, announcements, activity log |
| Withdrawals | Full request → admin review → payout flow, KES 800 minimum, balance calculated from `Completed` orders only |
| Reviews | Product reviews gated to Delivered/Completed orders, one review per order+product |
| Notifications | In-app notifications table; order status changes and admin announcements both create them |
| File uploads | `multer`-based upload for seller ID/business documents and product images, served at `/uploads/...` |
| Activity log | Every admin action and order status change is now recorded |

## Setup

```bash
npm install
mysql -u root -p < sql/schema.sql
node -e "console.log(require('bcryptjs').hashSync('yourpassword', 10))"
# paste into ADMIN_PASSWORD_HASH in .env
npm run db:seed
npm run dev
```

Test accounts after seeding: `seller@example.com` / `Seller123!` (already
approved + subscribed) and `customer@example.com` / `Customer123!`.

## Full smoke test

```
1.  POST /api/auth/register                          -> get token
2.  POST /api/auth/apply-seller  (multipart, optional id_photo/business_doc files)
3.  POST /api/auth/admin-login                        -> get admin token
4.  GET  /api/admin/sellers?status=pending            -> see the application
5.  POST /api/admin/sellers/:id/approve
6.  POST /api/auth/subscribe          { "months": 6 }
7.  POST /api/products  (multipart, field "images")   -> add a product
8.  GET  /api/products                                 -> see it publicly
9.  POST /api/cart/add                { product_id, qty }
10. POST /api/orders/preview                          -> live delivery-fee estimate
11. POST /api/orders                                   -> checkout, splits per seller
12. GET  /api/orders/:trackingNumber/track
13. PUT  /api/orders/:id/status       { "status": "Completed" }
14. POST /api/orders/:id/rate          { "rating": 5, "remarks": "..." }  <- works even with no rider
15. POST /api/products/:id/reviews     { "order_id": ..., "rating": 5, "comment": "..." }
16. GET  /api/withdrawals/balance
17. POST /api/withdrawals              { "amount": 800, "method": "mpesa", "mpesa_number": "0712345678" }
18. GET  /api/admin/sellers-earnings
19. PUT  /api/withdrawals/admin/:id/status  { "status": "completed" }
20. POST /api/admin/announcements      { "title": "...", "message": "...", "target": "all" }
```

## Still not wired (same caveat as before)

Payments are marked "paid" based on whatever's sent to `/api/auth/subscribe`
or checkout — there's no real M-Pesa verification. Trigger an STK push on
the frontend and only mark things paid from inside a payment-gateway
callback route before this touches real money. Subscription-expiry
reminder emails also aren't on a cron job yet — `subscription_end` is
tracked, but nothing currently checks it daily and notifies sellers.
