// Primer administrador, sin base de datos: validación de los datos, destino del comando y el
// comportamiento con PostgreSQL caído (un cliente real apuntado a un puerto cerrado, sin mocks).

import { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { BaseDeDatosNoDisponibleError } from '../../../lib/baseDeDatosNoDisponible';
import { destinoDe } from '../../../scripts/crear-primer-administrador';
import {
  crearPrimerAdministrador,
  NOMBRE_MAXIMO,
  validarDatosDelPrimerAdministrador,
} from '../primerAdministrador';

const VALIDOS = {
  email: 'Direccion@Estudio.Example',
  nombre: '  Dora Dirección  ',
  password: 'tranvía ámbar sobre el puente 47',
};

describe('validación de los datos del primer administrador', () => {
  it('acepta datos válidos y devuelve el email normalizado y el nombre sin espacios sobrantes', () => {
    expect(validarDatosDelPrimerAdministrador(VALIDOS)).toEqual({
      ok: true,
      email: 'direccion@estudio.example',
      nombre: 'Dora Dirección',
    });
  });

  it.each([
    ['email sin formato', { email: 'no-es-un-email' }, 'email'],
    ['email vacío', { email: '   ' }, 'email'],
    ['nombre vacío', { nombre: '   ' }, 'nombre'],
    ['nombre demasiado largo', { nombre: 'a'.repeat(NOMBRE_MAXIMO + 1) }, 'nombre'],
    ['nombre con caracteres de control', { nombre: 'Dora\u0000Dirección' }, 'nombre'],
    ['contraseña corta', { password: 'corta' }, 'password'],
    ['contraseña vacía', { password: '' }, 'password'],
    ['contraseña de la lista de comunes', { password: 'password1234567' }, 'password'],
    ['contraseña derivada del nombre', { password: 'Dora Dirección 2026!' }, 'password'],
    ['contraseña derivada del email', { password: 'direccion-2026-!!!!' }, 'password'],
  ])('rechaza: %s', (_caso, cambio, campo) => {
    const resultado = validarDatosDelPrimerAdministrador({ ...VALIDOS, ...cambio });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errores.map((e) => e.campo)).toEqual([campo]);
  });

  it('informa todos los campos inválidos a la vez y nunca repite la contraseña en el mensaje', () => {
    const password = 'corta-secreta';
    const resultado = validarDatosDelPrimerAdministrador({ email: 'x', nombre: '', password });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.errores.map((e) => e.campo)).toEqual(['email', 'nombre', 'password']);
    expect(JSON.stringify(resultado)).not.toContain(password);
  });
});

describe('destino del comando', () => {
  it('muestra host y base, sin usuario ni contraseña', () => {
    const destino = destinoDe(
      'postgresql://usuario:clave-secreta@db.interna:5432/realpolitik_test?schema=public',
    );
    expect(destino).toEqual({ host: 'db.interna:5432', base: 'realpolitik_test' });
    expect(JSON.stringify(destino)).not.toContain('clave-secreta');
    expect(JSON.stringify(destino)).not.toContain('usuario');
  });

  it.each([undefined, '', 'no es una url', 'https://ejemplo.com/base', 'postgresql://host:5432/'])(
    'rechaza un destino inválido (%s) sin repetir el valor',
    (valor) => {
      expect(() => destinoDe(valor)).toThrow(/DATABASE_URL/);
    },
  );
});

describe('con PostgreSQL caído', () => {
  it('rechaza con BaseDeDatosNoDisponibleError, sin crear nada y sin exponer la conexión', async () => {
    const prisma = new PrismaClient({
      datasourceUrl:
        'postgresql://nadie:clave-de-conexion@127.0.0.1:1/inexistente?schema=public&connect_timeout=2',
      log: [],
    });
    try {
      const error: unknown = await crearPrimerAdministrador(prisma, VALIDOS).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(BaseDeDatosNoDisponibleError);
      const texto = `${(error as Error).message} ${JSON.stringify(error)}`;
      expect(texto).not.toContain('clave-de-conexion');
      expect(texto).not.toContain(VALIDOS.password);
    } finally {
      await prisma.$disconnect();
    }
  }, 20_000);

  it('los datos inválidos se rechazan antes de tocar la base', async () => {
    const prisma = new PrismaClient({
      datasourceUrl: 'postgresql://nadie:nada@127.0.0.1:1/inexistente?connect_timeout=2',
      log: [],
    });
    await expect(
      crearPrimerAdministrador(prisma, { ...VALIDOS, password: 'corta' }),
    ).resolves.toMatchObject({ resultado: 'datos-invalidos' });
    await prisma.$disconnect();
  });
});
