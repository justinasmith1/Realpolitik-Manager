import type { RequestHandler } from 'express';

import { notFound } from '../errors/app-error';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(notFound());
};
