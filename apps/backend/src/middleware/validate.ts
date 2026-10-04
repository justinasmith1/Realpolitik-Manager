import type { Request, RequestHandler } from 'express';
import type { z, ZodTypeAny } from 'zod';

import { validationError, type ValidationDetail } from '../errors/app-error';

const SOURCES = ['body', 'params', 'query'] as const;

export type ValidationSchemas = Partial<Record<(typeof SOURCES)[number], ZodTypeAny>>;

/** Datos ya validados y tipados según los schemas que se le pasaron a `validate`. */
export type Validated<S extends ValidationSchemas> = {
  [K in keyof S]: S[K] extends ZodTypeAny ? z.output<S[K]> : never;
};

/** Tipo de `res.locals` en los handlers que van detrás de `validate`. */
export interface ValidatedLocals<S extends ValidationSchemas> {
  validated: Validated<S>;
}

const toDetail = (source: string, issue: z.ZodIssue): ValidationDetail => ({
  campo: issue.path.join('.') || source,
  mensaje: issue.message,
});

/**
 * Valida body, params y/o query con Zod. Si algo es inválido responde VALIDATION_ERROR;
 * si todo está bien, deja los datos parseados en `res.locals.validated`.
 */
export function validate<S extends ValidationSchemas>(
  schemas: S,
): RequestHandler<Request['params'], unknown, unknown, Request['query'], ValidatedLocals<S>> {
  return (req, res, next) => {
    const validated: Record<string, unknown> = {};
    const details: ValidationDetail[] = [];

    for (const source of SOURCES) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (result.success) {
        validated[source] = result.data;
      } else {
        details.push(...result.error.issues.map((issue) => toDetail(source, issue)));
      }
    }

    if (details.length > 0) {
      next(validationError(details));
      return;
    }

    // Los datos salieron de los mismos schemas que definen `Validated<S>`.
    res.locals.validated = validated as Validated<S>;
    next();
  };
}
