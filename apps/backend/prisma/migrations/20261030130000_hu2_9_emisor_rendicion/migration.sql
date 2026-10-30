-- ─── HU2.9: emisor de cada rendición y unicidad del número de factura por emisor ───────────
--
-- Escrita a mano: Prisma no declara índices parciales. Cada emisor tiene su propia numeración,
-- así que el número de factura no se repite para el mismo emisor entre las rendiciones activas,
-- aunque sean de clientes distintos (antes era único por cliente).
--
-- Las rendiciones existentes quedan con `emisor` NULL: no hay un emisor que copiar (el del
-- cliente nació vacío en la migración anterior) y adivinarlo sería inventar un dato fiscal.
-- Para ellas sigue valiendo la regla vieja, con un segundo índice parcial.
--
-- Esta migración no puede abortar por datos existentes: la columna nueva es NULL en todas las
-- filas, el índice `_sin_emisor` cubre exactamente las mismas filas y columnas que el anterior
-- (que ya las garantizaba únicas) y el índice `emisor_factura` empieza sin ninguna fila que lo
-- cubra.

-- AlterTable: sin valor por defecto, las filas existentes quedan en NULL.
ALTER TABLE "Rendicion" ADD COLUMN "emisor" "Emisor";

-- Se reemplaza el índice anterior: único (clienteId, numeroFactura) entre las rendiciones
-- activas ("isDeleted" = false; una anulada libera el número).
DROP INDEX "uq_rendicion_factura_activa";

-- Sin emisor (las rendiciones anteriores a HU2.9): la regla de antes, por cliente.
CREATE UNIQUE INDEX "uq_rendicion_factura_activa_sin_emisor"
  ON "Rendicion"("clienteId", "numeroFactura")
  WHERE "isDeleted" = false AND "emisor" IS NULL;

-- Con emisor: único por (emisor, numeroFactura) entre las activas, de cualquier cliente.
CREATE UNIQUE INDEX "uq_rendicion_emisor_factura_activa"
  ON "Rendicion"("emisor", "numeroFactura")
  WHERE "isDeleted" = false AND "emisor" IS NOT NULL;
