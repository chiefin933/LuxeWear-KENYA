# ⚡ LuxeWear Kenya — Backend API Specification & Architecture Blueprint

> **Document Status**: REVIEW / PHASE 3 BLUEPRINT  
> **Version**: 1.0.0  
> **Runtime**: Node.js v20+ / TypeScript  
> **Framework**: Express.js  
> **Database Access**: Prisma ORM (PostgreSQL 16)  

---

## 1. Architectural Role & Boundary Constraints

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        BACKEND API RESPONSIBILITY                      │
│                                                                        │
│   Auth & RBAC → Validation → Business Rules → PostgreSQL Transactions   │
│                                                     │                  │
│                                                     ▼                  │
│                                             Outbox Event Buffer        │
└────────────────────────────────────────────────────────────────────────┘
```

1. **Business Authority**: The Backend API enforces all business constraints (stock reservations, price computations, discount validations, M-Pesa receipt verification, and order state transitions).
2. **Transaction Isolation**: Multi-step business operations execute inside PostgreSQL explicit transactions with `Serializable` isolation level where stock reservation locks are involved.
3. **Outbox Event Guarantee**: All side-effects (WhatsApp notifications, CRM updates, email receipts) are triggered asynchronously via `OutboxEvent` records produced in the same PostgreSQL transaction as order creation.

---

## 2. Directory & Module Architecture

```text
src/
├── app.ts                  # Express app initialization & middleware wiring
├── server.ts               # HTTP server listener & graceful shutdown
├── config/
│   ├── env.ts              # Environment variables schema (Zod)
│   ├── logger.ts           # Structured Winston JSON logger
│   └── constants.ts        # Business constants & defaults
├── middleware/
│   ├── auth.middleware.ts  # JWT bearer token verification
│   ├── rbac.middleware.ts  # Role-Based Access Control authorization
│   ├── rateLimit.middleware.ts # Nginx/Express rate limiting
│   ├── validate.middleware.ts  # Zod schema validation middleware
│   └── error.middleware.ts # Global error handler & RFC 7807 formatter
├── errors/
│   ├── app.error.ts        # Base custom application error class
│   ├── notFound.error.ts   # 404 Error handler
│   ├── conflict.error.ts   # 409 Conflict / Stock Exceeded Error
│   └── unauthorized.error.ts # 401 / 403 Security Errors
├── modules/
│   ├── auth/               # Admin & staff login, token generation
│   ├── catalog/            # Categories, products, variants, images
│   ├── inventory/          # Stock movements, low-stock alerts
│   ├── cart/               # Guest & customer cart management
│   ├── checkout/           # Checkout sessions & 15m reservation locks
│   ├── payment/            # M-Pesa STK Push & async Daraja callback engine
│   ├── order/              # Order placement, lookup, item snapshots
│   ├── admin/              # Store management, fulfillment dispatch
│   └── outbox/             # Outbox event worker & n8n webhook dispatcher
└── types/                  # Express Request extensions & ambient types
```

---

## 3. Standard API Request & Response Contracts

### 3.1 Standard Success Format
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 12
  }
}
```

### 3.2 Standard Error Format (RFC 7807 Inspired)
```json
{
  "success": false,
  "code": "INSUFFICIENT_STOCK",
  "message": "The requested item 'Nairobi Nights Satin Gala Dress (Size M)' has only 2 units available.",
  "errors": [
    {
      "field": "quantity",
      "message": "Requested 5 units exceeds available stock of 2"
    }
  ],
  "timestamp": "2026-09-25T21:40:00.000Z"
}
```

---

## 4. API Endpoints Catalog

### 4.1 Authentication Domain (`/api/v1/auth`)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/auth/login` | Public | Admin/Staff login. Returns JWT access token. |
| `GET` | `/api/v1/auth/me` | Authenticated | Fetch current logged-in user profile & assigned roles. |

---

### 4.2 Catalog Domain (`/api/v1/catalog`)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/catalog/categories` | Public | List all categories with sub-category hierarchy. |
| `GET` | `/api/v1/catalog/products` | Public | Search & filter products (category, size, color, price range). |
| `GET` | `/api/v1/catalog/products/:slug` | Public | Get product details, variants, images, and stock availability. |

---

### 4.3 Cart & Checkout Domain (`/api/v1/checkout`)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/cart` | Public | Create or update shopping cart session. |
| `GET` | `/api/v1/cart/:token` | Public | Retrieve cart items & calculate totals. |
| `POST` | `/api/v1/checkout/initiate` | Public | Create `CheckoutSession` and lock 15m `InventoryReservation`. Requires `Idempotency-Key`. |

#### Example Payload: `POST /api/v1/checkout/initiate`
```json
{
  "cartToken": "cart_session_9921",
  "phoneNumber": "254712345678",
  "customerInfo": {
    "firstName": "Jane",
    "lastName": "Wambui",
    "email": "jane.wambui@example.com"
  },
  "deliveryAddress": {
    "recipientName": "Jane Wambui",
    "phoneNumber": "254712345678",
    "city": "Nairobi",
    "suburbArea": "Kilimani",
    "streetAddress": "Lenana Road, Apt 4B",
    "buildingName": "Kilimani Heights"
  },
  "items": [
    {
      "variantId": "var_uuid_1234",
      "quantity": 1
    }
  ]
}
```

---

### 4.4 Payments Domain (`/api/v1/payments`)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/v1/payments/mpesa/stkpush` | Public | Trigger M-Pesa Daraja STK Push prompt to customer mobile. |
| `POST` | `/api/v1/payments/mpesa/callback` | Safaricom Gateway | Authoritative M-Pesa async callback handler. Processes payment, creates Order, updates stock, writes Outbox Event. |

#### Example Response: `POST /api/v1/payments/mpesa/stkpush`
```json
{
  "success": true,
  "data": {
    "checkoutRequestId": "ws_CO_2509202621450012345",
    "merchantRequestId": "29182-1029381-1",
    "customerMessage": "STK Push sent to 254712345678. Please enter your M-Pesa PIN to complete payment of KES 8,800."
  }
}
```

---

### 4.5 Orders Domain (`/api/v1/orders`)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/orders/:orderNumber` | Public (with phone verification) | Lookup order status, items, delivery details, & fulfillment state. |
| `GET` | `/api/v1/customer/orders` | Customer Auth | Fetch customer purchase history. |

---

### 4.6 Admin Operations Domain (`/api/v1/admin`)

| Method | Endpoint | Access | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/v1/admin/orders` | RBAC (`SUPER_ADMIN`, `STORE_MANAGER`, `CUSTOMER_SUPPORT`) | List & filter store orders. |
| `PATCH` | `/api/v1/admin/orders/:id/fulfillment` | RBAC (`SUPER_ADMIN`, `STORE_MANAGER`, `INVENTORY_CLERK`) | Update order fulfillment status & courier tracking details. |
| `POST` | `/api/v1/admin/inventory/adjust` | RBAC (`SUPER_ADMIN`, `STORE_MANAGER`, `INVENTORY_CLERK`) | Manual stock adjustment with mandatory audit movement log. |
| `POST` | `/api/v1/admin/products` | RBAC (`SUPER_ADMIN`, `STORE_MANAGER`) | Add new product & variants. |

---

## 5. Security & Authentication Blueprint

1. **JWT Auth Middleware**: Validates `Authorization: Bearer <token>`. Extracts `userId`, `email`, and `roles`.
2. **RBAC Guard Middleware**:
   ```typescript
   export const requireRole = (allowedRoles: RoleName[]) => {
     return (req: Request, res: Response, next: NextFunction) => {
       const userRoles = req.user?.roles || [];
       const hasRole = userRoles.some((r) => allowedRoles.includes(r));
       if (!hasRole) {
         throw new UnauthorizedError('Insufficient role permissions for this operation.');
       }
       next();
     };
   };
   ```
3. **M-Pesa Webhook Signature Verification**: Verifies incoming request headers and Safaricom IP ranges.

---

## 6. Phase 3 Definition of Done Checklist

- [x] Backend architecture & directory structure defined
- [x] API contracts specified for Auth, Catalog, Cart, Checkout, Payments, Orders, Admin, & Outbox
- [x] Zod validation & standard RFC 7807 error format codified
- [x] JWT & RBAC security middleware specified
- [x] PostgreSQL transaction isolation & idempotency strategy defined
- [ ] Core Express server setup & app wiring
- [ ] Catalog, Checkout, and M-Pesa endpoints implementation
- [ ] Automated integration test suite (`supertest`) for API endpoints

---
**Approved by**: LuxeWear Backend Engineering Team  
**Date**: September 25, 2026
