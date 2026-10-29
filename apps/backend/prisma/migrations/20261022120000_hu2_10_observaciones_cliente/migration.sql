-- ─── HU2.10: observaciones internas en la ficha del cliente ────────────────────────────────
--
-- Escrita a mano. Una columna opcional y sin valor por defecto: las filas existentes quedan en
-- NULL (sin observaciones), así que no hace falta completar nada. El largo y la normalización del
-- texto (recortado, vacío = NULL) los resuelve `ObservacionesClienteSchema` (@realpolitik/shared).

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "observaciones" VARCHAR(1000);
