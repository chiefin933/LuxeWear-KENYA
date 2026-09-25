import { z } from 'zod';

// ─── Kenyan Phone Number Validator ─────────────────────────────────────────
// Accepts: 07XXXXXXXX, 01XXXXXXXX, +2547XXXXXXXX, 2547XXXXXXXX
const kenyanPhoneRegex = /^(?:\+?254|0)([71]\d{8})$/;

const phoneSchema = z
  .string()
  .regex(kenyanPhoneRegex, 'Please provide a valid Kenyan phone number (e.g. 0712345678)');

// ─── Delivery Address ──────────────────────────────────────────────────────
export const deliveryAddressSchema = z
  .object({
    recipientName: z
      .string()
      .min(2, 'Recipient name must be at least 2 characters')
      .max(100, 'Recipient name too long'),
    phoneNumber: phoneSchema,
    city: z.string().min(2).max(60).default('Nairobi'),
    suburbArea: z
      .string()
      .min(2, 'Please provide a suburb or area name')
      .max(100, 'Area name too long'),
    streetAddress: z
      .string()
      .min(5, 'Please provide a full street address')
      .max(200, 'Street address too long'),
    buildingName: z.string().max(100).optional(),
  })
  .strict();

// ─── Checkout Initiation ───────────────────────────────────────────────────
export const initiateCheckoutSchema = z.object({
  headers: z
    .object({
      'idempotency-key': z
        .string()
        .uuid('Idempotency-Key header must be a valid UUID')
        .optional(),
    })
    .passthrough(),
  body: z
    .object({
      cartToken: z.string().uuid('cartToken must be a valid UUID'),
      phoneNumber: phoneSchema,
      deliveryAddress: deliveryAddressSchema,
    })
    .strict(),
});

export type DeliveryAddressInput = z.infer<typeof deliveryAddressSchema>;
export type InitiateCheckoutInput = z.infer<typeof initiateCheckoutSchema>['body'];
