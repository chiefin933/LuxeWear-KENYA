import { Request, Response, NextFunction } from 'express';
import { CatalogService } from './catalog.service.js';
import { GetProductsQueryInput } from './catalog.schemas.js';

export class CatalogController {
  static async getCategories(req: Request, res: Response, next: NextFunction) {
    try {
      const categories = await CatalogService.getCategories();

      res.status(200).json({
        success: true,
        data: categories,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  static async getProducts(req: Request, res: Response, next: NextFunction) {
    try {
      // validate middleware has already Zod-coerced req.query values
      // (page/limit → number, minPrice/maxPrice → number, isFeatured → boolean).
      // The double-cast to unknown bridges Express's ParsedQs static type.
      const queryParams = req.query as unknown as GetProductsQueryInput;
      const result = await CatalogService.getProducts(queryParams);

      res.status(200).json({
        success: true,
        data: result.products,
        meta: result.pagination,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  static async getProductBySlug(req: Request, res: Response, next: NextFunction) {
    try {
      const { slug } = req.params;
      const product = await CatalogService.getProductBySlug(slug);

      res.status(200).json({
        success: true,
        data: product,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}
