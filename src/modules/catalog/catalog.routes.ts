import { Router } from 'express';
import { CatalogController } from './catalog.controller.js';
import { validate } from '../../middleware/validate.middleware.js';
import { getProductsQuerySchema, getProductBySlugSchema } from './catalog.schemas.js';

export const catalogRouter = Router();

catalogRouter.get('/categories', CatalogController.getCategories);
catalogRouter.get('/products', validate(getProductsQuerySchema), CatalogController.getProducts);
catalogRouter.get('/products/:slug', validate(getProductBySlugSchema), CatalogController.getProductBySlug);
