/**
 * Preflight de `TEST_DATABASE_URL` exclusivo de la suite de integración de requisitos.
 * Solo admite `realpolitik_test` en el entorno local del proyecto, en GitHub Actions o, con
 * `ALLOW_COMPOSE_TEST_DB=true`, en el servicio `db` de la red de Docker Compose.
 */

export function exigirBaseDeEstaSuite(conexion: string): void {
  const destino = new URL(conexion);
  const base = decodeURIComponent(destino.pathname.replace(/^\//, ''));

  const entornoLocal = destino.hostname === '127.0.0.1' && destino.port === '5433';

  const entornoCI =
    process.env.GITHUB_ACTIONS === 'true' &&
    destino.hostname === 'localhost' &&
    destino.port === '5432';


  const entornoCompose =
    process.env.ALLOW_COMPOSE_TEST_DB === 'true' &&
    destino.hostname === 'db' &&
    destino.port === '5432';

  if (base !== 'realpolitik_test' || (!entornoLocal && !entornoCI && !entornoCompose)) {
    throw new Error(
      `La suite solo puede utilizar realpolitik_test en un entorno autorizado. Recibió ${destino.hostname}:${destino.port}/${base}.`,
    );
  }
}
