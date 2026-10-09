-- CreateEnum
CREATE TYPE "PeriodicidadTipo" AS ENUM ('MENSUAL', 'BIMESTRAL', 'POR_CAMPANIA');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "periodicidadDiaLimite" SMALLINT,
ADD COLUMN     "periodicidadMesInicioCiclo" SMALLINT,
ADD COLUMN     "periodicidadTipo" "PeriodicidadTipo";

