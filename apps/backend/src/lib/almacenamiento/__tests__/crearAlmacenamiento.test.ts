import { describe, expect, it } from 'vitest';

import { crearAlmacenamiento } from '../crearAlmacenamiento';
import { AlmacenamientoEnDisco } from '../disco';
import { AlmacenamientoEnMemoria } from '../memoria';
import { AlmacenamientoS3 } from '../s3';

describe('crearAlmacenamiento', () => {
  it('crea el adaptador de cada configuración (sin conectarse a nada)', () => {
    expect(crearAlmacenamiento({ tipo: 'memoria' })).toBeInstanceOf(AlmacenamientoEnMemoria);
    expect(
      crearAlmacenamiento({ tipo: 'disco', directorio: '.almacenamiento-local' }),
    ).toBeInstanceOf(AlmacenamientoEnDisco);
    expect(
      crearAlmacenamiento({
        tipo: 's3',
        s3: {
          endpoint: 'https://proyecto.supabase.co/storage/v1/s3',
          region: 'us-east-1',
          bucket: 'documentos',
          accessKeyId: 'id-de-prueba',
          secretAccessKey: 'clave-de-prueba',
          forcePathStyle: true,
        },
      }),
    ).toBeInstanceOf(AlmacenamientoS3);
  });
});
