# 🗄️ LuxeWear Kenya — Database Schema Blueprint & ERD

> **Document Status**: APPROVED / PHASE 2 VERIFIED & PROVEN ✅  
> **Version**: 1.3.0  
> **Database Engine**: PostgreSQL 16  
> **ORM**: Prisma  

---

## 1. Complete Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    Category ||--o{ Product : contains
    Product ||--|{ ProductVariant : has
    Product ||--o{ ProductImage : showcases
    ProductVariant ||--|| Inventory : tracks
    ProductVariant ||--o{ InventoryReservation : reserves
    ProductVariant ||--o{ InventoryMovement : logs

    Customer ||--o{ CustomerAddress : owns
    Customer ||--o{ Cart : maintains
    Customer ||--o{ CheckoutSession : initiates
    Customer ||--o{ Order : places
    Customer ||--o{ Conversation : engages
    Customer ||--o{ Lead : captures

    Cart ||--o{ CartItem : contains
    ProductVariant ||--o{ CartItem : references

    CheckoutSession ||--o{ InventoryReservation : holds
    CheckoutSession ||--o{ PaymentAttempt : triggers
    CheckoutSession ||--o{ PaymentCallback : receives
    PaymentAttempt ||--o{ PaymentTransaction : generates
    PaymentAttempt ||--o{ PaymentCallback : receives
    PaymentTransaction ||--o{ PaymentCallback : links

    Order ||--|{ OrderItem : includes
    Order ||--o{ PaymentAttempt : tracks
    Order ||--|| DeliveryAddress : delivers_to
    Order ||--o{ Fulfillment : executes
    ProductVariant ||--o{ OrderItem : snapshot_of

    Conversation ||--o{ Message : contains
    Customer ||--o{ SupportTicket : opens

    User ||--o{ UserRole : assigned
    Role ||--o{ UserRole : grants
    Role ||--o{ RolePermission : defines
    Permission ||--o{ RolePermission : authorizes
```

---

## 2. Stock Reservation & Availability Rules

- **PostgreSQL Source of Truth**:
  $$\text{Available Stock} = \text{Inventory.stock\_quantity} - \sum \text{InventoryReservation.quantity where status = 'ACTIVE' and expires\_at > NOW()}$$
- **Concurrency Protection**: Stock reservations are executed inside PostgreSQL explicit database transactions using `Serializable` isolation and row locking. Asserts zero overselling and zero negative stock levels under concurrent `Promise.all()` spikes.

---

## 3. Phase 2 Empirical Verification & Sign-off Checklist

- [x] Complete Entity Relationship Diagram (Mermaid ERD) mapped
- [x] All 10 core domain modules defined with exact data types & constraints
- [x] Enums and state machine transitions codified (`ReservationStatus`, `CallbackStatus`, `OrderStatus`, `PaymentStatus`, etc.)
- [x] Variant-level stock tracking & 15-minute reservation model hardened
- [x] Transactionally atomic Outbox Pattern (`outbox_events`) specified
- [x] `prisma/schema.prisma` validated (`npx prisma format` & `npx prisma validate`)
- [x] PostgreSQL database migration executed (`20260925181634_init`)
- [x] 12 Launch products seed script executed (`prisma/seed.ts`)
- [x] **Real PostgreSQL Concurrency & Integration Tests PASSED (3/3 Suites)**:
  - ✅ **Promise.all() Async Concurrency**: 5 parallel worker promises tested against PostgreSQL row locks. Stock non-negativity and reservation serialization verified.
  - ✅ **Atomic Order & Outbox Event Creation**: Full payment callback → stock deduction → `Order` creation → `OutboxEvent` (`PENDING`) written in single DB transaction.
  - ✅ **Concurrent Duplicate Callback Idempotency**: Verified zero duplicate orders created when receiving parallel M-Pesa receipt callbacks.

---
**Approved by**: LuxeWear Database & Engineering Team  
**Date**: September 25, 2026
