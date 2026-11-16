// Comprobaciones estáticas de la migración del responsable de los cambios de estado (HU4.6): que
// solo AGREGUE (sin tocar ni completar el historial existente), que la FK proteja a los usuarios y
// que el SQL y schema.prisma describan lo mismo. Que el SQL se aplique de verdad lo prueba el CI
// (`db:migrate:deploy` sobre una base vacía, con todo el historial de migraciones).

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const NOMBRE = '20261116120000_hu4_6_responsable_historial';
const DIR_MIGRACIONES = fileURLToPath(new URL('../../../../prisma/migrations/', import.meta.url));
const SCHEMA = fileURLToPath(new URL('../../../../prisma/schema.prisma', import.meta.url));

const migraciones = readdirSync(DIR_MIGRACIONES, { withFileTypes: true })
  .filter((entrada) => entrada.isDirectory())
  .map((entrada) => entrada.name)
  .sort();
const sql = readFileSync(`${DIR_MIGRACIONES}${NOMBRE}/migration.sql`, 'utf8');
// Sin comentarios, para no confundir una palabra de un comentario con una instrucción.
const instrucciones = sql.replace(/--.*$/gm, '');
const sentencias = instrucciones
  .split(';')
  .map((sentencia) => sentencia.replace(/\s+/g, ' ').trim())
  .filter(Boolean);
const schema = readFileSync(SCHEMA, 'utf8');

/** El bloque `model X { … }` o `enum X { … }` de schema.prisma. */
const bloqueDelSchema = (tipo: 'model' | 'enum', nombre: string): string =>
  new RegExp(`^${tipo} ${nombre} \\{\\n([\\s\\S]*?)^\\}`, 'm').exec(schema)?.[1] ?? '';

describe(`migración ${NOMBRE}`, () => {
  it('se aplica después de todas las que existían cuando se creó (nada intercalado antes)', () => {
    const posicion = migraciones.indexOf(NOMBRE);
    expect(posicion).toBeGreaterThan(0);
    expect(migraciones[posicion - 1]).toBe('20261113120000_hu3_10_cobro_rendicion');
  });

  it('solo agrega: un enum, columnas y constraints (nada de DROP, UPDATE, DELETE…)', () => {
    const permitida =
      /^(CREATE TYPE "\w+" AS ENUM|ALTER TABLE "\w+" ADD COLUMN|ALTER TABLE "\w+" ADD CONSTRAINT "\w+" (CHECK|FOREIGN KEY))/;

    expect(sentencias).toHaveLength(4);
    for (const sentencia of sentencias) {
      expect({ sentencia, permitida: permitida.test(sentencia) }).toEqual({
        sentencia,
        permitida: true,
      });
    }
    // `ON DELETE` / `ON UPDATE` de la FK son acciones referenciales, no sentencias.
    const sinAccionesDeLaFk = instrucciones.replace(/ON (DELETE|UPDATE) (RESTRICT|CASCADE)/g, '');
    expect(sinAccionesDeLaFk).not.toMatch(
      /\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME|ALTER COLUMN)\b/i,
    );
  });

  it('solo altera el historial: no toca Usuario ni otras tablas', () => {
    const alteradas = [...instrucciones.matchAll(/ALTER TABLE "(\w+)"/g)].map((m) => m[1]);
    expect(new Set(alteradas)).toEqual(new Set(['HistorialEstadoRendicion']));
  });

  it('crea el enum con exactamente MANUAL y AUTOMATICO', () => {
    expect(sentencias[0]).toBe(`CREATE TYPE "OrigenCambioEstado" AS ENUM ('MANUAL', 'AUTOMATICO')`);
  });

  it('las dos columnas son nullable y sin valor por defecto: no completa las entradas existentes', () => {
    const columnas = [...instrucciones.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^,;]+)/g)].map((m) => [
      m[1],
      (m[2] ?? '').trim(),
    ]);
    expect(columnas).toEqual([
      ['origen', '"OrigenCambioEstado"'],
      ['registradoPorId', 'UUID'],
    ]);
    expect(instrucciones).not.toMatch(/NOT NULL|DEFAULT/i);
  });

  it('la FK apunta a Usuario y no deja borrar a un usuario con cambios registrados', () => {
    expect(sentencias).toContain(
      'ALTER TABLE "HistorialEstadoRendicion" ADD CONSTRAINT "HistorialEstadoRendicion_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
    );
  });

  it('el CHECK exige responsable y origen juntos: los dos cargados o los dos NULL', () => {
    expect(sentencias).toContain(
      'ALTER TABLE "HistorialEstadoRendicion" ADD CONSTRAINT "ck_historial_responsable_con_origen" CHECK ( ("registradoPorId" IS NULL) = ("origen" IS NULL) )',
    );
  });

  it('cada CHECK está documentado en la cabecera de schema.prisma', () => {
    const checks = [...instrucciones.matchAll(/CONSTRAINT "(ck_\w+)"/g)].map((m) => m[1] ?? '');

    expect(checks).toEqual(['ck_historial_responsable_con_origen']);
    for (const check of checks) expect(schema).toContain(`//   ${check}`);
  });

  it('schema.prisma describe la misma estructura que el SQL', () => {
    const valoresDelEnum = bloqueDelSchema('enum', 'OrigenCambioEstado')
      .split('\n')
      .map((linea) => linea.trim())
      .filter((linea) => linea !== '' && !linea.startsWith('//'));
    expect(valoresDelEnum).toEqual(['MANUAL', 'AUTOMATICO']);

    const historial = bloqueDelSchema('model', 'HistorialEstadoRendicion');
    expect(historial).toMatch(/^\s*registradoPorId\s+String\?\s+@db\.Uuid\s*$/m);
    expect(historial).toMatch(
      /^\s*registradoPor\s+Usuario\?\s+@relation\(fields: \[registradoPorId\], references: \[id\], onDelete: Restrict\)\s*$/m,
    );
    expect(historial).toMatch(/^\s*origen\s+OrigenCambioEstado\?\s*$/m);
    // Sin índice nuevo: el historial se sigue leyendo por rendición.
    expect(historial.match(/@@index/g)).toHaveLength(1);

    expect(bloqueDelSchema('model', 'Usuario')).toMatch(
      /^\s*cambiosDeEstado\s+HistorialEstadoRendicion\[\]\s*$/m,
    );
  });
});
