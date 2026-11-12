import path from 'node:path';

import { z } from 'zod';

import type { ConfigAlmacenamiento } from '../lib/almacenamiento/crearAlmacenamiento';

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

const isHttpUrl = (value: string): boolean => {
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/** Una variable que, si se define, no puede quedar vacía (un `S3_BUCKET=` por error). */
const textoNoVacio = z.string().trim().min(1);

/** Carpeta del almacenamiento en disco si no se indica otra, relativa a donde corre el backend. */
export const DIRECTORIO_ALMACENAMIENTO_POR_DEFECTO = '.almacenamiento-local';

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

  // Documentos (HU2.8, ADR-0004). Las reglas por entorno están en `resolverDocumentos`; acá solo
  // la forma de cada variable.
  DOCUMENTOS_HABILITADOS: z.enum(['true', 'false']).optional(),
  ALMACENAMIENTO: z.enum(['memoria', 'disco', 's3']).optional(),
  ALMACENAMIENTO_DIRECTORIO: textoNoVacio.optional(),
  S3_ENDPOINT: z.string().refine(isHttpUrl).optional(),
  S3_REGION: textoNoVacio.optional(),
  S3_BUCKET: textoNoVacio.optional(),
  S3_ACCESS_KEY_ID: textoNoVacio.optional(),
  S3_SECRET_ACCESS_KEY: textoNoVacio.optional(),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
});

type VariablesDeDocumentos =
  | 'DOCUMENTOS_HABILITADOS'
  | 'ALMACENAMIENTO'
  | 'ALMACENAMIENTO_DIRECTORIO'
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
  | 'S3_FORCE_PATH_STYLE';

/**
 * Las variables ya validadas. Las de documentos no quedan sueltas (entre ellas está la clave
 * secreta del proveedor): se entregan resueltas en `documentos`, que es `null` si los endpoints
 * de documentos están deshabilitados.
 */
export type Env = Omit<z.infer<typeof EnvSchema>, VariablesDeDocumentos> & {
  documentos: { almacenamiento: ConfigAlmacenamiento } | null;
};

export class EnvError extends Error {
  constructor(readonly variables: string[]) {
    super(`Variables de entorno faltantes o inválidas: ${variables.join(', ')}`);
    this.name = 'EnvError';
  }
}

type Resolucion =
  | { almacenamiento: ConfigAlmacenamiento; invalidas?: never }
  | { almacenamiento?: never; invalidas: string[] };

/**
 * Si los endpoints de documentos (`/documentos`) se montan. Hoy no hay autenticación: en
 * producción quedan DESHABILITADOS salvo `DOCUMENTOS_HABILITADOS=true`, que solo se define cuando
 * hay una protección efectiva del lado del servidor o de la infraestructura (ADR-0004, Seguridad).
 * Habilitados por defecto solo con `NODE_ENV` definido en `development` o `test`: sin `NODE_ENV`
 * (un deploy que lo olvidó) también quedan deshabilitados.
 */
function documentosHabilitados(datos: z.infer<typeof EnvSchema>, nodeEnvDefinido: boolean) {
  if (datos.DOCUMENTOS_HABILITADOS !== undefined) return datos.DOCUMENTOS_HABILITADOS === 'true';
  return nodeEnvDefinido && datos.NODE_ENV !== 'production';
}

/**
 * Qué almacenamiento usar (solo si los documentos están habilitados):
 * - `ALMACENAMIENTO` explícito, si está.
 * - Si no: memoria con `NODE_ENV=test`, y disco solo con `NODE_ENV=development` **definido**. Si
 *   `NODE_ENV` falta, el servidor asume development, pero eso también es lo que pasa en un deploy
 *   que olvidó definirlo: ahí no se elige disco por defecto, hay que pedirlo.
 * - En producción, solo `s3`, y con endpoint HTTPS: ni memoria ni disco (se pierden con el
 *   contenedor).
 * - `s3` exige todas sus variables.
 */
function resolverAlmacenamiento(
  datos: z.infer<typeof EnvSchema>,
  nodeEnvDefinido: boolean,
  directorioBase: string,
): Resolucion {
  const porDefecto =
    datos.NODE_ENV === 'test'
      ? 'memoria'
      : datos.NODE_ENV === 'development' && nodeEnvDefinido
        ? 'disco'
        : undefined;
  const tipo = datos.ALMACENAMIENTO ?? porDefecto;
  if (tipo === undefined || (datos.NODE_ENV === 'production' && tipo !== 's3')) {
    return { invalidas: ['ALMACENAMIENTO'] };
  }

  if (tipo === 'memoria') return { almacenamiento: { tipo } };
  if (tipo === 'disco') {
    const directorio = path.resolve(
      directorioBase,
      datos.ALMACENAMIENTO_DIRECTORIO ?? DIRECTORIO_ALMACENAMIENTO_POR_DEFECTO,
    );
    return { almacenamiento: { tipo, directorio } };
  }

  const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = datos;
  if (
    S3_ENDPOINT === undefined ||
    S3_REGION === undefined ||
    S3_BUCKET === undefined ||
    S3_ACCESS_KEY_ID === undefined ||
    S3_SECRET_ACCESS_KEY === undefined
  ) {
    const requeridas = {
      S3_ENDPOINT,
      S3_REGION,
      S3_BUCKET,
      S3_ACCESS_KEY_ID,
      S3_SECRET_ACCESS_KEY,
    };
    return {
      invalidas: Object.keys(requeridas).filter(
        (nombre) => requeridas[nombre as keyof typeof requeridas] === undefined,
      ),
    };
  }
  if (datos.NODE_ENV === 'production' && new URL(S3_ENDPOINT).protocol !== 'https:') {
    return { invalidas: ['S3_ENDPOINT'] };
  }
  return {
    almacenamiento: {
      tipo,
      s3: {
        endpoint: S3_ENDPOINT,
        region: S3_REGION,
        bucket: S3_BUCKET,
        accessKeyId: S3_ACCESS_KEY_ID,
        secretAccessKey: S3_SECRET_ACCESS_KEY,
        // Supabase exige el bucket en la ruta: es el valor por defecto.
        forcePathStyle: datos.S3_FORCE_PATH_STYLE !== 'false',
      },
    },
  };
}

/**
 * Valida las variables de entorno. El mensaje de error nombra las variables pero
 * nunca su valor: DATABASE_URL contiene la contraseña de la base (y S3_SECRET_ACCESS_KEY, la
 * clave del almacenamiento). `directorioBase` resuelve la carpeta del almacenamiento en disco.
 */
export function loadEnv(
  source: NodeJS.ProcessEnv = process.env,
  directorioBase: string = process.cwd(),
): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const names = result.error.issues.map((issue) => String(issue.path[0]));
    throw new EnvError([...new Set(names)]);
  }

  const nodeEnvDefinido = source.NODE_ENV !== undefined;
  let documentos: Env['documentos'] = null;
  if (documentosHabilitados(result.data, nodeEnvDefinido)) {
    const resolucion = resolverAlmacenamiento(result.data, nodeEnvDefinido, directorioBase);
    if (resolucion.invalidas !== undefined) {
      throw new EnvError(resolucion.invalidas);
    }
    documentos = { almacenamiento: resolucion.almacenamiento };
  }

  const {
    DOCUMENTOS_HABILITADOS: _habilitados,
    ALMACENAMIENTO: _tipo,
    ALMACENAMIENTO_DIRECTORIO: _directorio,
    S3_ENDPOINT: _endpoint,
    S3_REGION: _region,
    S3_BUCKET: _bucket,
    S3_ACCESS_KEY_ID: _accessKeyId,
    S3_SECRET_ACCESS_KEY: _secretAccessKey,
    S3_FORCE_PATH_STYLE: _forcePathStyle,
    ...resto
  } = result.data;
  return { ...resto, documentos };
}
