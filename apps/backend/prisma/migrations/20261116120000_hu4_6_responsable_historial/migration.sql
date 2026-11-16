-- HU4.6: responsable de cada cambio de estado de una rendición (ADR-0006).
--
-- El DDL es el que genera Prisma para `schema.prisma`; el CHECK se agrega a mano (Prisma Schema
-- no puede representarlo, ver la cabecera del schema). Aditiva: un enum, dos columnas nullable,
-- una FK y un CHECK, todo en `HistorialEstadoRendicion`. Sin backfill: las entradas existentes
-- quedan con `registradoPorId` y `origen` en NULL, porque no se sabe quién hizo esos cambios. No
-- toca `Usuario` ni otras tablas.

-- CreateEnum
CREATE TYPE "OrigenCambioEstado" AS ENUM ('MANUAL', 'AUTOMATICO');

-- AlterTable
ALTER TABLE "HistorialEstadoRendicion" ADD COLUMN     "origen" "OrigenCambioEstado",
ADD COLUMN     "registradoPorId" UUID;

-- AddForeignKey
-- Restrict: un usuario con cambios registrados no se puede borrar (se desactiva, HU4.5).
ALTER TABLE "HistorialEstadoRendicion" ADD CONSTRAINT "HistorialEstadoRendicion_registradoPorId_fkey" FOREIGN KEY ("registradoPorId") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── CHECK (a mano) ───────────────────────────────────────────────────────────

-- Responsable y origen van juntos: los dos cargados o los dos NULL (las entradas anteriores a
-- HU4.6). No obliga a que una entrada nueva los tenga: eso lo garantiza el servicio.
ALTER TABLE "HistorialEstadoRendicion" ADD CONSTRAINT "ck_historial_responsable_con_origen" CHECK (
  ("registradoPorId" IS NULL) = ("origen" IS NULL)
);
