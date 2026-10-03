-- CreateEnum
CREATE TYPE "Sector" AS ENUM ('PUBLICO', 'PRIVADO');

-- CreateEnum
CREATE TYPE "SubtipoPublico" AS ENUM ('MUNICIPAL', 'PROVINCIAL_ORGANISMO', 'SINDICAL_OBRA_SOCIAL');

-- CreateEnum
CREATE TYPE "IvaCondicion" AS ENUM ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL', 'NO_CATEGORIZADO');

-- CreateEnum
CREATE TYPE "ClienteEstado" AS ENUM ('ACTIVO', 'INACTIVO', 'SUSPENDIDO');

-- CreateTable
CREATE TABLE "Cliente" (
    "id" UUID NOT NULL,
    "razonSocial" VARCHAR(150) NOT NULL,
    "denominacion" VARCHAR(60) NOT NULL,
    "cuit" VARCHAR(13) NOT NULL,
    "ivaCondicion" "IvaCondicion" NOT NULL,
    "emailContacto" VARCHAR(254) NOT NULL,
    "emailsAdicionales" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "telefono" VARCHAR(25),
    "portalUrl" VARCHAR(500),
    "sector" "Sector" NOT NULL,
    "subtipo" "SubtipoPublico",
    "estado" "ClienteEstado" NOT NULL DEFAULT 'ACTIVO',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cliente_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Cliente_cuit_key" ON "Cliente"("cuit");
