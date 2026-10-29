import type { AlmacenamientoDocumentos } from './almacenamiento';
import { AlmacenamientoEnDisco } from './disco';
import { AlmacenamientoEnMemoria } from './memoria';
import { AlmacenamientoS3, crearClienteS3, type ConfigS3 } from './s3';

/**
 * Qué almacenamiento usar, ya resuelto y validado por `loadEnv` (src/config/env.ts): ahí están
 * las reglas por entorno (memoria en tests, disco en desarrollo, S3 obligatorio en producción).
 */
export type ConfigAlmacenamiento =
  { tipo: 'memoria' } | { tipo: 'disco'; directorio: string } | { tipo: 's3'; s3: ConfigS3 };

export function crearAlmacenamiento(config: ConfigAlmacenamiento): AlmacenamientoDocumentos {
  switch (config.tipo) {
    case 'memoria':
      return new AlmacenamientoEnMemoria();
    case 'disco':
      return new AlmacenamientoEnDisco(config.directorio);
    case 's3':
      return new AlmacenamientoS3(crearClienteS3(config.s3), config.s3.bucket);
  }
}
