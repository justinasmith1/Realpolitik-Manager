-- HU3.1: estado de cada rendición (en qué paso está) y su historial de cambios (ADR-0005).
--
-- El DDL es el que genera Prisma para `schema.prisma`. Se agrega a mano el relleno: todas las
-- rendiciones existentes, también las anuladas, quedan EN_CURSO (el default de la columna) y con
-- una entrada inicial de historial (null → EN_CURSO) fechada en su `createdAt`. La anulación
-- (`isDeleted`) es aparte del estado y no se toca.

-- CreateEnum
CREATE TYPE "EstadoRendicion" AS ENUM ('EN_CURSO', 'COMPLETA', 'ENVIADA', 'APROBADA', 'RECHAZADA');

-- AlterTable
ALTER TABLE "Rendicion" ADD COLUMN     "estado" "EstadoRendicion" NOT NULL DEFAULT 'EN_CURSO';

-- CreateTable
CREATE TABLE "HistorialEstadoRendicion" (
    "id" UUID NOT NULL,
    "rendicionId" UUID NOT NULL,
    "estadoAnterior" "EstadoRendicion",
    "estadoNuevo" "EstadoRendicion" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "motivo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistorialEstadoRendicion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HistorialEstadoRendicion_rendicionId_fecha_idx" ON "HistorialEstadoRendicion"("rendicionId", "fecha");

-- AddForeignKey
ALTER TABLE "HistorialEstadoRendicion" ADD CONSTRAINT "HistorialEstadoRendicion_rendicionId_fkey" FOREIGN KEY ("rendicionId") REFERENCES "Rendicion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Relleno: la entrada inicial de cada rendición existente. `gen_random_uuid()` es nativa desde
-- PostgreSQL 13 (el proyecto usa 16); Prisma genera los ids en la aplicación, así que acá se usa
-- la de la base.
INSERT INTO "HistorialEstadoRendicion" ("id", "rendicionId", "estadoAnterior", "estadoNuevo", "fecha")
SELECT gen_random_uuid(), "id", NULL, 'EN_CURSO', "createdAt"
FROM "Rendicion";
