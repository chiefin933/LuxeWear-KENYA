import { z } from 'zod';

// ─── Cart Token Header ─────────────────────────────────────────────────────
// Every guest request must carry X-Cart-Token so sessions survive without auth.
export const cartTokenHeaderSchema = z.object({
  headers: z.object({
    'x-cart-token': z.string().uuid('X-Cart-Token must be a valid UUID').optional(),
  }).passthrough(),
});

// ─── Add / Update Item ─────────────────────────────────────────────────────
export const upsertCartItemSchema = z.object({
  body: z
    .object({
      variantId: z.string().uuid('variantId must be a valid UUID'),
      quantity: z
        .number({ required_error: 'quantity is required' })
        .int('quantity must be an integer')
        .min(1, 'quantity must be at least 1')
        .max(10, 'maximum 10 units per item'),
    })
    .strict(),
});

// ─── Remove Item ───────────────────────────────────────────────────────────
export const removeCartItemSchema = z.object({
  params: z.object({
    variantId: z.string().uuid('variantId path param must be a valid UUID'),
  }),
});

// ─── Inferred Types ────────────────────────────────────────────────────────
export type UpsertCartItemInput = z.infer<typeof upsertCartItemSchema>['body'];
export type RemoveCartItemParams = z.infer<typeof removeCartItemSchema>['params'];
