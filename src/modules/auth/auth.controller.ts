import { Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, password } = req.body;
      const result = await AuthService.login(email, password);

      res.status(200).json({
        success: true,
        data: result,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  static async me(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.userId;
      const profile = await AuthService.getProfile(userId);

      res.status(200).json({
        success: true,
        data: profile,
        correlationId: req.correlationId,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }
}
