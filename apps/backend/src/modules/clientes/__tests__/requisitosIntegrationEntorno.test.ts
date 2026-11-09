import { describe, expect, it } from 'vitest';

import { exigirBaseDeEstaSuite } from './requisitosIntegrationEntorno';

// La guarda de las suites de requisitos: solo `realpolitik_test`, en el host y el puerto de
// `TEST_DATABASE_URL`.
const url = (destino: string) => `postgresql://usuario:clave@${destino}?schema=public`;

describe('exigirBaseDeEstaSuite', () => {
  it.each([
    ['la base de Docker en local (5432)', '127.0.0.1:5432/realpolitik_test'],
    ['otro puerto local (POSTGRES_PORT=5433)', '127.0.0.1:5433/realpolitik_test'],
    ['el servicio de GitHub Actions', 'localhost:5432/realpolitik_test'],
    ['el servicio db de Docker Compose', 'db:5432/realpolitik_test'],
  ])('acepta realpolitik_test en %s', (_caso, destino) => {
    expect(() => exigirBaseDeEstaSuite(url(destino))).not.toThrow();
  });

  it.each([
    ['la base de desarrollo', '127.0.0.1:5432/realpolitik_db'],
    ['la base de desarrollo en Docker Compose', 'db:5432/realpolitik_db'],
    ['otra base descartable', '127.0.0.1:5432/realpolitik_audit'],
    ['un nombre parecido', '127.0.0.1:5432/realpolitik_test_2'],
  ])('rechaza %s', (_caso, destino) => {
    expect(() => exigirBaseDeEstaSuite(url(destino))).toThrow(
      /solo puede utilizar realpolitik_test/,
    );
  });
});
