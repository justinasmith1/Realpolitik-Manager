// Comprobaciones estáticas de la migración de usuarios y sesiones: que solo AGREGUE (compatible con
// el historial y con los datos existentes) y que sus CHECK estén documentados en el schema. Que el
// SQL se aplique de verdad lo prueban el CI (`db:migrate:deploy` sobre una base vacía, con todo el
// historial) y la suite de integración `usuarios-sesiones.integration.test.ts`.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const NOMBRE = '20261111120000_hu4_1_usuarios_sesiones';
const DIR_MIGRACIONES = fileURLToPath(new URL('../../../../prisma/migrations/', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../../prisma/schema.prisma', import.meta.url));

const migraciones = readdirSync(DIR_MIGRACIONES, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
const sql = readFileSync(`${DIR_MIGRACIONES}${NOMBRE}/migration.sql`, 'utf8');
// Sin comentarios, para no confundir una palabra de un comentario con una instrucción.
const instrucciones = sql.replace(/--.*$/gm, '');

describe(`migración ${NOMBRE}`, () => {
  it('se aplica después de todas las que existían cuando se creó (nada intercalado antes)', () => {
    // Las migraciones posteriores (HU3.7 en adelante) van después: no se exige que sea la última.
    const posicion = migraciones.indexOf(NOMBRE);
    expect(posicion).toBeGreaterThan(0);
    expect(migraciones[posicion - 1]).toBe('20261109120000_hu3_4_indice_atrasadas');
  });

  it('solo agrega: cada sentencia crea un objeto o agrega un constraint (nada de DROP, UPDATE, DELETE…)', () => {
    const sentencias = instrucciones
      .split(';')
      .map((sentencia) => sentencia.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const permitida =
      /^(CREATE TYPE "\w+" AS ENUM|CREATE TABLE "\w+"|CREATE (UNIQUE )?INDEX "\w+" ON "\w+"|ALTER TABLE "\w+" ADD CONSTRAINT "\w+" (CHECK|FOREIGN KEY))/;

    expect(sentencias.length).toBeGreaterThan(0);
    for (const sentencia of sentencias) {
      expect({ sentencia, permitida: permitida.test(sentencia) }).toEqual({
        sentencia,
        permitida: true,
      });
    }
  });

  it('solo altera las tablas que crea', () => {
    const alteradas = [...instrucciones.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);

    expect(new Set(alteradas)).toEqual(new Set(['Usuario', 'Sesion']));
    expect([...instrucciones.matchAll(/CREATE TABLE "(\w+)"/g)].map((m) => m[1])).toEqual([
      'Usuario',
      'Sesion',
    ]);
  });

  it('no crea usuarios ni sesiones', () => {
    expect(instrucciones).not.toMatch(/\bINSERT\b/i);
  });

  it('cada CHECK está documentado en la cabecera de schema.prisma', () => {
    const schema = readFileSync(SCHEMA, 'utf8');
    const checks = [...instrucciones.matchAll(/CONSTRAINT "(ck_\w+)"/g)].map((m) => m[1] ?? '');

    expect(checks).toEqual([
      'ck_usuario_email_normalizado',
      'ck_usuario_nombre_no_vacio',
      'ck_usuario_password_hash_argon2id',
      'ck_sesion_token_hash_formato',
      'ck_sesion_fechas_coherentes',
    ]);
    for (const check of checks) expect(schema).toContain(`//   ${check}`);
  });
});
