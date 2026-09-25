import { z } from 'zod';

export const getProductsQuerySchema = z.object({
  query: z.object({
    page: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 1)),
    limit: z.string().optional().transform((val) => (val ? Math.min(parseInt(val, 10), 100) : 20)),
    categorySlug: z.string().optional(),
    size: z.string().optional(),
    color: z.string().optional(),
    minPrice: z.string().optional().transform((val) => (val ? parseFloat(val) : undefined)),
    maxPrice: z.string().optional().transform((val) => (val ? parseFloat(val) : undefined)),
    isFeatured: z.string().optional().transform((val) => (val !== undefined ? val === 'true' : undefined)),
    search: z.string().optional(),
  }),
});

export const getProductBySlugSchema = z.object({
  params: z.object({
    slug: z.string().min(1, 'Product slug is required'),
  }),
});
