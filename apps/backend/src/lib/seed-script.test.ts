// El seed de desarrollo borra clientes. `db:seed` tiene que cargar `apps/backend/.env` cuando
// no hay una DATABASE_URL en el entorno, y NO pisar una que ya esté definida: si no, un valor
// heredado se reemplazaría en silencio por el archivo (o al revés). No abre una conexión.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ARCHIVO = 'postgresql://usuario:clave@127.0.0.1:5433/realpolitik_db?schema=public';
const HEREDADA = 'postgresql://usuario:clave@127.0.0.1:5433/realpolitik_test?schema=public';

function destino(databaseUrl: string | undefined): string {
  const dir = mkdtempSync(join(tmpdir(), 'seed-env-'));
  const archivo = join(dir, '.env');
  writeFileSync(archivo, `DATABASE_URL=${ARCHIVO}\nNODE_ENV=development\n`, 'utf8');
  try {
    const env = { ...process.env };
    // Vitest deja NODE_ENV=test. Si no se quita, --env-file no lo pisa y el caso no
    // prueba que una variable ausente sí sale del archivo.
    delete env.NODE_ENV;
    if (databaseUrl === undefined) delete env.DATABASE_URL;
    else env.DATABASE_URL = databaseUrl;
    return execFileSync(
      process.execPath,
      [
        '--env-file',
        archivo,
        '--eval',
        'const u = new URL(process.env.DATABASE_URL); process.stdout.write([u.hostname, u.port, u.pathname.slice(1), process.env.NODE_ENV].join("|"))',
      ],
      { env, encoding: 'utf8' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('db:seed carga el entorno sin elegir otra base en silencio', () => {
  it('el script usa node --env-file=.env y conserva el build previo de shared', () => {
    const paquete = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as {
      scripts: Record<string, string>;
      prisma: { seed: string };
    };
    expect(paquete.scripts['db:seed']).toBe('node --env-file=.env --import tsx prisma/seed.ts');
    expect(paquete.scripts['predb:seed']).toBe('pnpm run build:shared');
    expect(paquete.prisma.seed).toBe('pnpm run db:seed');
  });

  it('sin DATABASE_URL en el entorno, toma la del archivo', () => {
    expect(destino(undefined)).toBe('127.0.0.1|5433|realpolitik_db|development');
  });

  it('si DATABASE_URL ya está definida, el archivo no la reemplaza', () => {
    expect(destino(HEREDADA)).toBe('127.0.0.1|5433|realpolitik_test|development');
  });
});
