import { z } from 'zod';
import { DarajaClient } from './daraja.client.js';

export const initiateStkPushSchema = z.object({
  body: z.object({
    checkoutToken: z.string().min(1, 'Checkout token is required.'),
    phoneNumber: z
      .string()
      .optional()
      .refine(
        (val) => {
          if (!val) return true;
          try {
            DarajaClient.normalizePhoneNumber(val);
            return true;
          } catch {
            return false;
          }
        },
        {
          message: 'Invalid Kenyan phone number format. Must start with 07, 01, 254, or +254.',
        }
      ),
  }),
});

export type InitiateStkPushInput = z.infer<typeof initiateStkPushSchema>['body'];
