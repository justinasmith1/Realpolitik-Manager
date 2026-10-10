// Guarda de los tests de integración contra PostgreSQL real: solo corren contra una base
// DESCARTABLE. Sin `TEST_DATABASE_URL` devuelve `undefined` y los tests se saltan; si la
// variable apunta a una base que no se llama `*_audit` o `*_test`, falla antes de tocar nada.

function nombreDeLaBase(conexion: string): string {
  return new URL(conexion).pathname.replace(/^\//, '');
}

export function urlDeBaseDescartable(): string | undefined {
  const url = process.env.TEST_DATABASE_URL;
  if (url !== undefined && !/_(audit|test)$/.test(nombreDeLaBase(url))) {
    throw new Error(
      `TEST_DATABASE_URL apunta a "${nombreDeLaBase(url)}": solo se permiten bases descartables (*_audit o *_test).`,
    );
  }
  return url;
}
