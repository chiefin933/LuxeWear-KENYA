import { z } from 'zod';

export const getProductsQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
      limit: z.coerce.number().int().min(1, 'Limit must be at least 1').max(100, 'Limit cannot exceed 100').default(20),
      categorySlug: z.string().min(1).optional(),
      size: z.string().min(1).optional(),
      color: z.string().min(1).optional(),
      minPrice: z.coerce.number().min(0, 'minPrice must be greater than or equal to 0').optional(),
      maxPrice: z.coerce.number().min(0, 'maxPrice must be greater than or equal to 0').optional(),
      isFeatured: z
        .string()
        .optional()
        .transform((val) => (val !== undefined ? val === 'true' : undefined)),
      search: z.string().min(1).optional(),
    })
    .refine(
      (data) => {
        if (data.minPrice !== undefined && data.maxPrice !== undefined) {
          return data.minPrice <= data.maxPrice;
        }
        return true;
      },
      {
        message: 'minPrice cannot be greater than maxPrice',
        path: ['minPrice'],
      }
    ),
});

export const getProductBySlugSchema = z.object({
  params: z
    .object({
      slug: z.string().min(1, 'Product slug is required'),
    })
    .strict(),
});

export type GetProductsQueryInput = z.infer<typeof getProductsQuerySchema>['query'];
