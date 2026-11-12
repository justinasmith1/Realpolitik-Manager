// Alta del PRIMER administrador (HU4.1, ADR-0006 "Secuencia de despliegue"). Es lo único que crea
// una cuenta antes de que exista la administración de usuarios (HU4.5): sin ella nadie podría
// entrar después de activar la autenticación.
//
// Reglas:
// - Solo crea si NO existe ningún ADMINISTRADOR activo. Si existe, no hace nada: no es una vía para
//   sumar administradores ni para recuperar una cuenta.
// - Nunca modifica una cuenta existente: no cambia contraseñas, no reactiva, no cambia roles. Si el
//   email ya está en uso (activo o no, con cualquier rol), se informa y no se toca.
// - La cuenta nace con `debeCambiarPassword: true`: la contraseña inicial es temporal y el primer
//   ingreso obliga a elegir una propia. No se crea ninguna sesión.
// - Dos ejecuciones a la vez no crean dos administradores: la comprobación y el alta van en una
//   transacción con un bloqueo de aviso de PostgreSQL, y el email es único en la base.
// - Ningún resultado ni error incluye la contraseña ni su hash.

import { Prisma, type PrismaClient } from '@prisma/client';
import { IniciarSesionSchema } from '@realpolitik/shared';

import { conLaBaseDeDatos } from '../../lib/baseDeDatosNoDisponible';

import { hashearContrasena } from './contrasenas';
import { evaluarContrasenaNueva } from './politicaDeContrasenas';
import { registrarEventoDeAuth } from './registroDeEventos';

export const NOMBRE_MAXIMO = 150;

/** Clave del bloqueo de aviso (`pg_advisory_xact_lock`): fija, propia de esta operación. */
const BLOQUEO_PRIMER_ADMINISTRADOR = 41_001;

export interface DatosDelPrimerAdministrador {
  email: string;
  nombre: string;
  password: string;
}

export type CampoInvalido = 'email' | 'nombre' | 'password';

export type ResultadoDelPrimerAdministrador =
  | { resultado: 'creado'; usuario: { id: string; email: string; nombre: string } }
  /** Ya hay al menos un ADMINISTRADOR activo: no se crea otro. */
  | { resultado: 'ya-existe-administrador' }
  /** El email ya pertenece a una cuenta, que no se modifica. `activo` y `rol` son los de esa cuenta. */
  | { resultado: 'email-en-uso'; activo: boolean; esAdministrador: boolean }
  | { resultado: 'datos-invalidos'; errores: { campo: CampoInvalido; mensaje: string }[] };

// El mismo email que acepta y normaliza el inicio de sesión: lo que se guarda es lo que se busca.
const EmailSchema = IniciarSesionSchema.shape.email;

/** Normaliza y valida. Devuelve los datos listos para guardar, o los errores por campo. */
export function validarDatosDelPrimerAdministrador(
  datos: DatosDelPrimerAdministrador,
):
  | { ok: true; email: string; nombre: string }
  | { ok: false; errores: { campo: CampoInvalido; mensaje: string }[] } {
  const errores: { campo: CampoInvalido; mensaje: string }[] = [];

  const email = EmailSchema.safeParse(datos.email);
  if (!email.success) {
    errores.push({
      campo: 'email',
      mensaje: email.error.issues[0]?.message ?? 'Ingresá un email válido.',
    });
  }

  const nombre = datos.nombre.trim();
  if (nombre === '') {
    errores.push({ campo: 'nombre', mensaje: 'Ingresá el nombre.' });
  } else if ([...nombre].length > NOMBRE_MAXIMO) {
    errores.push({
      campo: 'nombre',
      mensaje: `El nombre puede tener como máximo ${NOMBRE_MAXIMO} caracteres.`,
    });
  } else if (/\p{Cc}/u.test(nombre)) {
    errores.push({ campo: 'nombre', mensaje: 'El nombre tiene caracteres que no se pueden usar.' });
  }

  // La misma política que una contraseña elegida por la persona, con su email y su nombre como
  // contexto. El mensaje es el de la política: nunca incluye la contraseña.
  const politica = evaluarContrasenaNueva(datos.password, {
    email: email.success ? email.data : null,
    nombre,
  });
  if (!politica.aceptada) {
    errores.push({ campo: 'password', mensaje: politica.mensaje });
  }

  if (errores.length > 0 || !email.success) {
    return { ok: false, errores };
  }
  return { ok: true, email: email.data, nombre };
}

type Cliente = Pick<PrismaClient, 'usuario'>;

/** Por qué no corresponde crear, o `null` si se puede. Se evalúa antes y dentro de la transacción. */
async function impedimento(
  db: Cliente,
  email: string,
): Promise<Exclude<
  ResultadoDelPrimerAdministrador,
  { resultado: 'creado' | 'datos-invalidos' }
> | null> {
  const administradores = await db.usuario.count({
    where: { rol: 'ADMINISTRADOR', activo: true },
  });
  if (administradores > 0) {
    return { resultado: 'ya-existe-administrador' };
  }
  const existente = await db.usuario.findUnique({
    where: { email },
    select: { activo: true, rol: true },
  });
  if (existente) {
    return {
      resultado: 'email-en-uso',
      activo: existente.activo,
      esAdministrador: existente.rol === 'ADMINISTRADOR',
    };
  }
  return null;
}

/**
 * Crea el primer ADMINISTRADOR si no hay ninguno activo. Idempotente: repetirlo no duplica ni
 * modifica nada. Si la base no responde, rechaza con `BaseDeDatosNoDisponibleError` (sin detalles
 * de conexión).
 */
export async function crearPrimerAdministrador(
  prisma: PrismaClient,
  datos: DatosDelPrimerAdministrador,
  ahora: Date = new Date(),
): Promise<ResultadoDelPrimerAdministrador> {
  const validos = validarDatosDelPrimerAdministrador(datos);
  if (!validos.ok) {
    return { resultado: 'datos-invalidos', errores: validos.errores };
  }
  const { email, nombre } = validos;

  return conLaBaseDeDatos(async () => {
    // Antes de calcular el hash (caro): si no corresponde crear, no se gasta ni se retiene nada.
    const previo = await impedimento(prisma, email);
    if (previo) {
      return previo;
    }

    const passwordHash = await hashearContrasena(datos.password);

    try {
      const salida = await prisma.$transaction(async (tx) => {
        // Serializa las ejecuciones simultáneas: la segunda espera y ve el alta de la primera.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BLOQUEO_PRIMER_ADMINISTRADOR})`;
        const ahoraNo = await impedimento(tx, email);
        if (ahoraNo) {
          return ahoraNo;
        }
        const usuario = await tx.usuario.create({
          data: {
            email,
            nombre,
            rol: 'ADMINISTRADOR',
            passwordHash,
            activo: true,
            debeCambiarPassword: true,
            passwordActualizadaEn: ahora,
          },
          select: { id: true, email: true, nombre: true },
        });
        return { resultado: 'creado' as const, usuario };
      });
      if (salida.resultado === 'creado') {
        registrarEventoDeAuth('auth.usuario.creado', { usuarioId: salida.usuario.id });
      }
      return salida;
    } catch (error) {
      // Red de seguridad: el email es único en la base aunque algo saltee el bloqueo.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return (
          (await impedimento(prisma, email)) ?? {
            resultado: 'email-en-uso',
            activo: true,
            esAdministrador: false,
          }
        );
      }
      throw error;
    }
  });
}
