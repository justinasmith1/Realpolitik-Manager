-- ─── HU2.9: emisor habitual del cliente ────────────────────────────────────────────────────
--
-- Escrita a mano. Una columna opcional y sin valor por defecto: las filas existentes quedan en
-- NULL (emisor pendiente de asignar), así que no hace falta completar nada. Los dos valores
-- son códigos de dominio; los textos visibles viven en el frontend.

-- CreateEnum
CREATE TYPE "Emisor" AS ENUM ('PERSONA_FISICA', 'SOCIEDAD');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "emisor" "Emisor";
