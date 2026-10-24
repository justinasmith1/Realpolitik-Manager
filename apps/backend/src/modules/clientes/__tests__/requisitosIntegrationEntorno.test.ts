import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { exigirBaseDeEstaSuite } from './requisitosIntegrationEntorno';

const LOCAL =
  'postgresql://realpolitik:realpolitik_dev@127.0.0.1:5433/realpolitik_test?schema=public';
const CI = 'postgresql://postgres:postgres@localhost:5432/realpolitik_test?schema=public';

describe('exigirBaseDeEstaSuite', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    vi.stubEnv('ALLOW_COMPOSE_TEST_DB', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('acepta el entorno local del proyecto', () => {
    expect(() => exigirBaseDeEstaSuite(LOCAL)).not.toThrow();
  });

  it('acepta localhost:5432/realpolitik_test solo en GitHub Actions', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    expect(() => exigirBaseDeEstaSuite(CI)).not.toThrow();
  });

  it('rechaza localhost:5432 fuera de GitHub Actions', () => {
    expect(() => exigirBaseDeEstaSuite(CI)).toThrow(/entorno autorizado/);
  });

  it('rechaza localhost con un puerto distinto de 5432 en GitHub Actions', () => {
    vi.stubEnv('GITHUB_ACTIONS', 'true');
    expect(() =>
      exigirBaseDeEstaSuite(
        'postgresql://postgres:postgres@localhost:5433/realpolitik_test?schema=public',
      ),
    ).toThrow(/entorno autorizado/);
  });

  it('rechaza realpolitik_db en el puerto local autorizado', () => {
    expect(() =>
      exigirBaseDeEstaSuite(
        'postgresql://realpolitik:realpolitik_dev@127.0.0.1:5433/realpolitik_db?schema=public',
      ),
    ).toThrow(/entorno autorizado/);
  });

  it('rechaza realpolitik_test en un host o puerto no autorizado', () => {
    expect(() =>
      exigirBaseDeEstaSuite(
        'postgresql://realpolitik:realpolitik_dev@127.0.0.1:5432/realpolitik_test?schema=public',
      ),
    ).toThrow(/entorno autorizado/);
  });

  const COMPOSE = 'postgresql://realpolitik:realpolitik_dev@db:5432/realpolitik_test?schema=public';

  it('acepta db:5432/realpolitik_test solo con ALLOW_COMPOSE_TEST_DB=true', () => {
    vi.stubEnv('ALLOW_COMPOSE_TEST_DB', 'true');
    expect(() => exigirBaseDeEstaSuite(COMPOSE)).not.toThrow();
  });

  it('rechaza db:5432 sin ALLOW_COMPOSE_TEST_DB', () => {
    expect(() => exigirBaseDeEstaSuite(COMPOSE)).toThrow(/entorno autorizado/);
  });

  it('con ALLOW_COMPOSE_TEST_DB sigue rechazando la base de desarrollo en db', () => {
    vi.stubEnv('ALLOW_COMPOSE_TEST_DB', 'true');
    expect(() =>
      exigirBaseDeEstaSuite(
        'postgresql://realpolitik:realpolitik_dev@db:5432/realpolitik_db?schema=public',
      ),
    ).toThrow(/entorno autorizado/);
  });

  it('con ALLOW_COMPOSE_TEST_DB no habilita otros hosts', () => {
    vi.stubEnv('ALLOW_COMPOSE_TEST_DB', 'true');
    expect(() =>
      exigirBaseDeEstaSuite(
        'postgresql://realpolitik:realpolitik_dev@otro-host:5432/realpolitik_test?schema=public',
      ),
    ).toThrow(/entorno autorizado/);
  });
});
