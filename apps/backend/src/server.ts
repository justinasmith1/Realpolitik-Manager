import { createApp } from './app';
import { EnvError, loadEnv } from './config/env';
import { crearAlmacenamiento } from './lib/almacenamiento/crearAlmacenamiento';

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
const app = createApp({
  corsOrigins: env.CORS_ORIGINS,
  documentos: env.documentos && {
    almacenamiento: crearAlmacenamiento(env.documentos.almacenamiento),
  },
});

app.listen(env.PORT, () => {
  // process.stdout.write evita la regla no-console y no suma una librería de logs.
  const documentos = env.documentos?.almacenamiento.tipo ?? 'deshabilitados';
  process.stdout.write(
    `Backend escuchando en http://localhost:${env.PORT} (${env.NODE_ENV}, documentos: ${documentos})\n`,
  );
});
