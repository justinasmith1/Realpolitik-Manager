import { z } from 'zod';

const isPostgresUrl = (value: string): boolean => /^postgres(ql)?:\/\/.+/.test(value);

// Un origen es "esquema://host[:puerto]" sin barra final: el navegador lo envía así
// y CORS lo compara tal cual, por eso no se acepta nada distinto.
const isOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().refine(isPostgresUrl),
  CORS_ORIGINS: z
    .string()
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().refine(isOrigin)).min(1)),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvError extends Error {
  constructor(readonly variables: string[]) {
    super(`Variables de entorno faltantes o inválidas: ${variables.join(', ')}`);
    this.name = 'EnvError';
  }
}

/**
 * Valida las variables de entorno. El mensaje de error nombra las variables pero
 * nunca su valor: DATABASE_URL contiene la contraseña de la base.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) return result.data;

  const names = result.error.issues.map((issue) => String(issue.path[0]));
  throw new EnvError([...new Set(names)]);
}
