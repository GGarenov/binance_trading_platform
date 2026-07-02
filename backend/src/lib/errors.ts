import type { NextFunction, Request, Response } from "express";

/**
 * Error with an HTTP status code attached, so routes can throw
 * `new HttpError(404, "...")` and the middleware below maps it to a response.
 */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // Express identifies error middleware by its arity (4 params), so this
  // unused parameter must stay.
  _next: NextFunction
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

/**
 * Express 4 does not catch rejected promises from async handlers on its own —
 * without this wrapper a thrown error inside `async (req, res) => ...` would
 * crash the process instead of reaching the error middleware.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
