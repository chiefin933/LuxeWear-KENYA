import { prisma } from '../../db/prisma.js';
import { NotFoundError } from '../../errors/app.error.js';
import { GetProductsQueryInput } from './catalog.schemas.js';

export class CatalogService {
  static async getCategories() {
    const rootCategories = await prisma.category.findMany({
      where: { parentId: null },
      include: {
        children: {
          select: { id: true, name: true, slug: true, description: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return rootCategories;
  }

  static async getProducts(params: GetProductsQueryInput) {
    const page = params.page || 1;
    const limit = params.limit || 20;
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
        include: { children: { select: { id: true } } },
      });

      if (!category) {
        throw new NotFoundError(`Category '${params.categorySlug}' not found.`);
      }

      const categoryIds = [category.id, ...category.children.map((c) => c.id)];
      where.categoryId = { in: categoryIds };
    }

    if (params.search) {
      where.OR = [
        { name: { contains: params.search, mode: 'insensitive' } },
        { description: { contains: params.search, mode: 'insensitive' } },
      ];
    }

    // Effective Price Filtering: Check both basePriceKes and salePriceKes
    if (params.minPrice !== undefined || params.maxPrice !== undefined) {
      const priceConditions: any[] = [];

      if (params.minPrice !== undefined && params.maxPrice !== undefined) {
        priceConditions.push(
          { basePriceKes: { gte: params.minPrice, lte: params.maxPrice } },
          { salePriceKes: { gte: params.minPrice, lte: params.maxPrice } }
        );
      } else if (params.minPrice !== undefined) {
        priceConditions.push(
          { basePriceKes: { gte: params.minPrice } },
          { salePriceKes: { gte: params.minPrice } }
        );
      } else if (params.maxPrice !== undefined) {
        priceConditions.push(
          { basePriceKes: { lte: params.maxPrice } },
          { salePriceKes: { lte: params.maxPrice } }
        );
      }

      where.OR = where.OR ? [...where.OR, ...priceConditions] : priceConditions;
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
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          basePriceKes: true,
          salePriceKes: true,
          isFeatured: true,
          category: {
            select: { id: true, name: true, slug: true },
          },
          images: {
            take: 2,
            orderBy: [{ isThumbnail: 'desc' }, { displayOrder: 'asc' }],
            select: { id: true, url: true, altText: true, isThumbnail: true },
          },
          variants: {
            where: { isActive: true, deletedAt: null },
            select: {
              id: true,
              size: true,
              color: true,
              inventory: { select: { stockQuantity: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.count({ where }),
    ]);

    const formattedProducts = products.map((p) => {
      const inStock = p.variants.some((v) => (v.inventory?.stockQuantity || 0) > 0);
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        basePriceKes: p.basePriceKes,
        salePriceKes: p.salePriceKes,
        effectivePriceKes: p.salePriceKes || p.basePriceKes,
        category: p.category,
        isFeatured: p.isFeatured,
        thumbnailUrl: p.images[0]?.url || null,
        images: p.images,
        availableSizes: Array.from(new Set(p.variants.map((v) => v.size))),
        availableColors: Array.from(new Set(p.variants.map((v) => v.color))),
        inStock,
      };
    });

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
        category: { select: { id: true, name: true, slug: true } },
        images: {
          orderBy: [{ isThumbnail: 'desc' }, { displayOrder: 'asc' }],
          select: { id: true, url: true, altText: true, isThumbnail: true },
        },
        variants: {
          where: { isActive: true, deletedAt: null },
          select: {
            id: true,
            sku: true,
            size: true,
            color: true,
            colorHex: true,
            priceOverrideKes: true,
            inventory: { select: { stockQuantity: true, safetyStockThreshold: true } },
          },
        },
      },
    });

    if (!product || !product.isActive || product.deletedAt !== null) {
      throw new NotFoundError(`Product '${slug}' not found.`);
    }

    const variants = product.variants.map((v) => {
      const qty = v.inventory?.stockQuantity || 0;
      let stockStatus: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' = 'OUT_OF_STOCK';

      if (qty > (v.inventory?.safetyStockThreshold || 3)) {
        stockStatus = 'IN_STOCK';
      } else if (qty > 0) {
        stockStatus = 'LOW_STOCK';
      }

      return {
        id: v.id,
        sku: v.sku,
        size: v.size,
        color: v.color,
        colorHex: v.colorHex,
        priceOverrideKes: v.priceOverrideKes,
        effectivePriceKes: v.priceOverrideKes || product.salePriceKes || product.basePriceKes,
        inStock: qty > 0,
        stockStatus,
      };
    });

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      description: product.description,
      fabricCare: product.fabricCare,
      basePriceKes: product.basePriceKes,
      salePriceKes: product.salePriceKes,
      effectivePriceKes: product.salePriceKes || product.basePriceKes,
      category: product.category,
      isFeatured: product.isFeatured,
      images: product.images,
      variants,
      inStock: variants.some((v) => v.inStock),
    };
  }
}
