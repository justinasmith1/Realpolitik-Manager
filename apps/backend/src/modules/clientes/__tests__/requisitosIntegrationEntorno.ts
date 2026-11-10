/**
 * Preflight de `TEST_DATABASE_URL` de las suites de integración de requisitos. Además de la guarda
 * común (`urlDeBaseDescartable`: solo `*_audit` o `*_test`), exige que la base se llame
 * exactamente `realpolitik_test`, para no correr nunca contra `realpolitik_db`. El host y el puerto
 * son los de `TEST_DATABASE_URL`, como en las demás suites: la base de Docker en local
 * (`127.0.0.1:5432`, o el `POSTGRES_PORT` que se haya elegido), el servicio de GitHub Actions o el
 * servicio `db` de Docker Compose.
 */

export function exigirBaseDeEstaSuite(conexion: string): void {
  const destino = new URL(conexion);
  const base = decodeURIComponent(destino.pathname.replace(/^\//, ''));

  if (base !== 'realpolitik_test') {
    throw new Error(
      `La suite solo puede utilizar realpolitik_test. Recibió ${destino.hostname}:${destino.port}/${base}.`,
    );
  }
}
