import { createApp } from './app';
import { EnvError, loadEnv } from './config/env';
import { crearAlmacenamiento } from './lib/almacenamiento/crearAlmacenamiento';
import { prepararHashFicticio } from './modules/auth/autenticacion.service';
import { limitePorOrigenAplicable, ProteccionDeLogin } from './modules/auth/proteccionDeLogin';

function readEnv(): ReturnType<typeof loadEnv> {
  try {
    return loadEnv();
  } catch (error) {
    if (error instanceof EnvError) {
      console.error(`${error.message}\nRevisá apps/backend/.env (el modelo está en .env.example).`);
      process.exit(1);
    }
    throw error;
  }
}

const env = readEnv();
// Sin una IP de cliente confiable no se limita por origen (bloquearía a todos a la vez).
const limitePorOrigen = limitePorOrigenAplicable({
  nodeEnv: env.NODE_ENV,
  saltosDeProxyConfiables: env.TRUST_PROXY_SALTOS,
});
const app = createApp({
  corsOrigins: env.CORS_ORIGINS,
  documentos: env.documentos && {
    almacenamiento: crearAlmacenamiento(env.documentos.almacenamiento),
  },
  saltosDeProxyConfiables: env.TRUST_PROXY_SALTOS,
  proteccionDeLogin: new ProteccionDeLogin({ limitePorOrigen }),
});

// El hash ficticio del login (ADR-0006 §3) se calcula una vez, antes de atender pedidos. Si argon2
// no carga, el import ya falló y el servidor no arranca. El tiempo queda en el registro de
// arranque: es la medición de argon2 en el entorno real.
const inicioDelHash = performance.now();
await prepararHashFicticio();
const msDelHash = Math.round(performance.now() - inicioDelHash);

app.listen(env.PORT, () => {
  // process.stdout.write evita la regla no-console y no suma una librería de logs.
  const documentos = env.documentos?.almacenamiento.tipo ?? 'deshabilitados';
  process.stdout.write(
    `Backend escuchando en http://localhost:${env.PORT} (${env.NODE_ENV}, documentos: ${documentos}, hash ficticio: ${msDelHash} ms, límite de login por origen: ${limitePorOrigen ? 'activo' : 'inactivo'})\n`,
  );
});
