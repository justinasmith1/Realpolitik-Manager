// Guarda del seed (`prisma/seed.ts`). El seed BORRA todos los clientes antes de cargar los de
// ejemplo, así que tiene que ser imposible ejecutarlo por accidente contra una base real.
//
// Dos condiciones, ambas necesarias:
// - `NODE_ENV` no es `production`.
// - La base está en esta misma máquina (`localhost`, `127.0.0.1` o `::1`).
//
// La segunda es la que importa: `NODE_ENV` queda en su valor por defecto cuando el proveedor
// olvida definirlo, y entonces no distingue nada. El host de `DATABASE_URL`, en cambio, no se
// puede olvidar: una base de producción nunca es local. En desarrollo con Docker (el flujo del
// equipo, ver docs/development/database.md) la base es `localhost`, así que no molesta.
//
// Sin forma de saltearla por variable de entorno, a propósito: si algún día hace falta
// sembrar una base remota, se decide y se cambia acá, a la vista del equipo.

const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Host de una URL de conexión, o `null` si no hay URL o no se puede leer. */
function hostDeLaBase(databaseUrl: string | undefined): string | null {
  if (databaseUrl === undefined || databaseUrl === '') return null;
  try {
    return new URL(databaseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Lanza un error si el seed no puede ejecutarse con este entorno. Los mensajes no incluyen
 * la URL ni el host: `DATABASE_URL` contiene la contraseña de la base.
 */
export function verificarSeedPermitido(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV === 'production') {
    throw new Error(
      'El seed borra todos los clientes y no puede ejecutarse con NODE_ENV=production.',
    );
  }

  const host = hostDeLaBase(env.DATABASE_URL);
  if (host === null || !HOSTS_LOCALES.has(host)) {
    throw new Error(
      'El seed borra todos los clientes y solo puede ejecutarse contra una base local ' +
        '(DATABASE_URL con host localhost, 127.0.0.1 o ::1). Revisá DATABASE_URL.',
    );
  }
}
