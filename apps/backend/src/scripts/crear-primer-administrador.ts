// Comando: crea el PRIMER administrador de Realpolitik Manager (HU4.1).
//
//   pnpm --filter @realpolitik/backend admin:crear          (desarrollo, con tsx)
//   node dist/crear-primer-administrador.js                  (build de producción)
//
// Usa `DATABASE_URL` del entorno. Pide el email, el nombre y la contraseña inicial por la terminal;
// la contraseña no se muestra al escribirla y se pide dos veces. Antes de escribir muestra el
// destino (host y base, sin credenciales) y pide confirmarlo escribiendo el nombre de la base.
//
// La contraseña NUNCA se recibe por argumentos ni por variables de entorno (quedarían en el
// historial de la terminal, en `ps` o en el panel del proveedor) y nunca se imprime ni se registra.
// Sin terminal interactiva (aprovisionamiento automatizado) se lee de la entrada estándar: una sola
// línea; el email y el nombre vienen de `ADMIN_EMAIL` y `ADMIN_NOMBRE`, y la confirmación del
// destino de `ADMIN_CONFIRMAR_BASE` (el nombre exacto de la base).
//
// La contraseña inicial es temporal: el primer ingreso obliga a cambiarla. No se crea una sesión.
//
// Salida: 0 si se creó; 2 si no correspondía crear (ya hay administrador, email en uso); 1 ante
// datos inválidos, cancelación o error.

import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { PrismaClient } from '@prisma/client';

import { BaseDeDatosNoDisponibleError } from '../lib/baseDeDatosNoDisponible';
import {
  crearPrimerAdministrador,
  validarDatosDelPrimerAdministrador,
} from '../modules/auth/primerAdministrador';

const decir = (texto: string) => stdout.write(`${texto}\n`);

/** Host y base de `DATABASE_URL`, sin usuario ni contraseña. */
export function destinoDe(databaseUrl: string | undefined): { host: string; base: string } {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? '');
  } catch {
    throw new Error('DATABASE_URL no está definida o no es una URL válida.');
  }
  const base = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!/^postgres(ql)?:$/.test(url.protocol) || base === '') {
    throw new Error('DATABASE_URL no es una URL de PostgreSQL con nombre de base.');
  }
  return { host: url.port ? `${url.hostname}:${url.port}` : url.hostname, base };
}

/** Lee una línea de la terminal sin mostrar lo que se escribe. */
function leerOculto(pregunta: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(pregunta);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let valor = '';
    const terminar = (accion: () => void) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.off('data', alTeclear);
      stdout.write('\n');
      accion();
    };
    const alTeclear = (trozo: string) => {
      for (const caracter of trozo) {
        if (caracter === '\r' || caracter === '\n') {
          terminar(() => resolve(valor));
          return;
        }
        if (caracter === '\u0003') {
          terminar(() => reject(new Error('Cancelado.')));
          return;
        }
        if (caracter === '\u007f' || caracter === '\b') {
          valor = [...valor].slice(0, -1).join('');
        } else {
          valor += caracter;
        }
      }
    };
    stdin.on('data', alTeclear);
  });
}

/** Toda la entrada estándar (sin terminal), hasta el primer salto de línea. */
async function leerDeLaEntrada(): Promise<string> {
  let todo = '';
  stdin.setEncoding('utf8');
  for await (const trozo of stdin) {
    todo += String(trozo);
  }
  return todo.split(/\r?\n/, 1)[0] ?? '';
}

async function pedirDatos(base: string) {
  if (!stdin.isTTY) {
    if (process.env.ADMIN_CONFIRMAR_BASE !== base) {
      throw new Error(
        `Sin terminal interactiva hay que confirmar el destino: ADMIN_CONFIRMAR_BASE tiene que ser "${base}".`,
      );
    }
    return {
      email: process.env.ADMIN_EMAIL ?? '',
      nombre: process.env.ADMIN_NOMBRE ?? '',
      password: await leerDeLaEntrada(),
    };
  }

  const rl = createInterface({ input: stdin, output: stdout });
  let email: string;
  let nombre: string;
  try {
    const confirmacion = await rl.question(
      `Para continuar, escribí el nombre de la base ("${base}"): `,
    );
    if (confirmacion.trim() !== base) {
      throw new Error('El nombre no coincide. No se hizo ningún cambio.');
    }
    email = await rl.question('Email del administrador: ');
    nombre = await rl.question('Nombre y apellido: ');
  } finally {
    rl.close();
  }
  const password = await leerOculto('Contraseña inicial (no se muestra): ');
  const repetida = await leerOculto('Repetí la contraseña inicial: ');
  if (password !== repetida) {
    throw new Error('Las contraseñas no coinciden. No se hizo ningún cambio.');
  }
  return { email, nombre, password };
}

async function main(): Promise<number> {
  if (process.argv.length > 2) {
    throw new Error(
      'Este comando no recibe argumentos: los datos se piden por la terminal (nunca pongas una contraseña en la línea de comandos).',
    );
  }
  const { host, base } = destinoDe(process.env.DATABASE_URL);
  decir('Crear el primer administrador de Realpolitik Manager');
  decir(`Destino: base "${base}" en ${host}`);

  const datos = await pedirDatos(base);
  const validos = validarDatosDelPrimerAdministrador(datos);
  if (!validos.ok) {
    for (const { campo, mensaje } of validos.errores) decir(`- ${campo}: ${mensaje}`);
    decir('No se hizo ningún cambio.');
    return 1;
  }

  const prisma = new PrismaClient({ log: [] });
  try {
    const salida = await crearPrimerAdministrador(prisma, datos);
    switch (salida.resultado) {
      case 'creado':
        decir(`Listo: se creó el administrador ${salida.usuario.email}.`);
        decir('La contraseña inicial es temporal: el primer ingreso va a pedir cambiarla.');
        return 0;
      case 'ya-existe-administrador':
        decir('Ya existe un administrador activo. No se creó ninguna cuenta ni se modificó nada.');
        return 2;
      case 'email-en-uso':
        decir(
          `Ese email ya pertenece a una cuenta ${salida.activo ? 'activa' : 'desactivada'}${salida.esAdministrador ? ' de administrador' : ''}. No se modificó: este comando no cambia contraseñas, roles ni estados.`,
        );
        return 2;
      case 'datos-invalidos':
        for (const { campo, mensaje } of salida.errores) decir(`- ${campo}: ${mensaje}`);
        return 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

// Solo al ejecutarlo como comando (los tests importan `destinoDe` sin correrlo).
if (process.env.VITEST === undefined) {
  main().then(
    (codigo) => {
      process.exitCode = codigo;
    },
    (error: unknown) => {
      // Mensajes propios; de un error inesperado solo el nombre: nunca datos de conexión.
      const texto =
        error instanceof BaseDeDatosNoDisponibleError
          ? 'No se pudo conectar con la base de datos. No se hizo ningún cambio.'
          : error instanceof Error && error.constructor === Error
            ? error.message
            : `Error inesperado (${error instanceof Error ? error.name : 'desconocido'}). No se hizo ningún cambio.`;
      process.stderr.write(`${texto}\n`);
      process.exitCode = 1;
    },
  );
}
