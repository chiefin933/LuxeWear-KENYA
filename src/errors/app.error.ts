export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly errors?: any[];

  constructor(message: string, statusCode = 500, code = 'INTERNAL_SERVER_ERROR', errors?: any[]) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Requested resource not found') {
    super(message, 404, 'NOT_FOUND');
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Invalid request parameters', errors?: any[]) {
    super(message, 400, 'BAD_REQUEST', errors);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication credentials invalid or missing') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Access forbidden for your user permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Resource conflict or stock capacity exceeded', code = 'CONFLICT') {
    super(message, 409, code);
  }
}

export class SerializationError extends AppError {
  constructor(message = 'Database serialization conflict. Please retry transaction.') {
    super(message, 409, 'SERIALIZATION_FAILURE');
  }
}
