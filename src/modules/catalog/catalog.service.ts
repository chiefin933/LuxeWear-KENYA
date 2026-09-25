import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../errors/app.error.js';

export interface ProductFilterParams {
  page?: number;
  limit?: number;
  categorySlug?: string;
  size?: string;
  color?: string;
  minPrice?: number;
  maxPrice?: number;
  isFeatured?: boolean;
  search?: string;
}

export class CatalogService {
  static async getCategories() {
    const rootCategories = await prisma.category.findMany({
      where: { parentId: null },
      include: {
        children: true,
      },
      orderBy: { name: 'asc' },
    });

    return rootCategories;
  }

  static async getProducts(params: ProductFilterParams) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = params.limit && params.limit > 0 ? params.limit : 20;
    const skip = (page - 1) * limit;

    const where: any = {
      isActive: true,
      deletedAt: null,
    };

    if (params.isFeatured !== undefined) {
      where.isFeatured = params.isFeatured;
    }

    if (params.categorySlug) {
      const category = await prisma.category.findUnique({
        where: { slug: params.categorySlug },
        include: { children: true },
      });

      if (category) {
        const categoryIds = [category.id, ...category.children.map((c) => c.id)];
        where.categoryId = { in: categoryIds };
      }
    }

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      where.basePriceKes = {};
      if (params.minPrice !== undefined) where.basePriceKes.gte = params.minPrice;
      if (params.maxPrice !== undefined) where.basePriceKes.lte = params.maxPrice;
    }

    if (params.size || params.color) {
      where.variants = {
        some: {
          isActive: true,
          deletedAt: null,
          ...(params.size ? { size: params.size } : {}),
          ...(params.color ? { color: { contains: params.color, mode: 'insensitive' } } : {}),
        },
      };
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        skip,
        take: limit,
        include: {
          category: true,
          images: {
            orderBy: [{ isThumbnail: 'desc' }, { displayOrder: 'asc' }],
          },
          variants: {
            where: { isActive: true, deletedAt: null },
            include: { inventory: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);

    const formattedProducts = products.map((p) => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      basePriceKes: p.basePriceKes,
      salePriceKes: p.salePriceKes,
      category: { id: p.category.id, name: p.category.name, slug: p.category.slug },
      isFeatured: p.isFeatured,
      images: p.images,
      variantsCount: p.variants.length,
      inStock: p.variants.some((v) => (v.inventory?.stockQuantity || 0) > 0),
    }));

    return {
      products: formattedProducts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  static async getProductBySlug(slug: string) {
    const product = await prisma.product.findUnique({
      where: { slug },
      include: {
        category: true,
        images: {
          orderBy: [{ isThumbnail: 'desc' }, { displayOrder: 'asc' }],
        },
        variants: {
          where: { isActive: true, deletedAt: null },
          include: {
            inventory: true,
          },
        },
      },
    });

    if (!product || !product.isActive || product.deletedAt !== null) {
      throw new NotFoundError(`Product '${slug}' not found.`);
    }

    const variants = product.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      color: v.color,
      colorHex: v.colorHex,
      priceOverrideKes: v.priceOverrideKes,
      effectivePriceKes: v.priceOverrideKes || product.salePriceKes || product.basePriceKes,
      stockQuantity: v.inventory?.stockQuantity || 0,
      inStock: (v.inventory?.stockQuantity || 0) > 0,
    }));

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      fabricCare: product.fabricCare,
      basePriceKes: product.basePriceKes,
      salePriceKes: product.salePriceKes,
      category: {
        id: product.category.id,
        name: product.category.name,
        slug: product.category.slug,
      },
      isFeatured: product.isFeatured,
      images: product.images,
      variants,
      inStock: variants.some((v) => v.inStock),
    };
  }
}
