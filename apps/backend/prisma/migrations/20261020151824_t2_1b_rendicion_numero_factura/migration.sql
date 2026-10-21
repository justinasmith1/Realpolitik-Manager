-- ─── T2.1b: la rendición se identifica por el número de factura (ADR-0003) ───────
--
-- Escrita a mano. Prisma propone DROP COLUMN "referencia" + ADD COLUMN "numeroFactura", que
-- perdería los datos; se usa RENAME COLUMN, que los conserva. PostgreSQL guarda el CHECK y el
-- índice por número de columna, así que al renombrar siguen apuntando a la misma columna.

-- La columna pasa a llamarse numeroFactura. Mismo tipo (VARCHAR(100)) y mismos datos.
ALTER TABLE "Rendicion" RENAME COLUMN "referencia" TO "numeroFactura";

-- Unicidad: un número de factura en una sola rendición activa del cliente, en cualquier período
-- (antes era por cliente + año + mes + referencia). Una rendición anulada no impide reusarlo.
DROP INDEX "uq_rendicion_periodo_activa";

CREATE UNIQUE INDEX "uq_rendicion_factura_activa"
  ON "Rendicion"("clienteId", "numeroFactura")
  WHERE "isDeleted" = false;

-- Mismo CHECK (btrim(numeroFactura) <> ''), con el nombre alineado a la columna nueva.
ALTER TABLE "Rendicion"
  RENAME CONSTRAINT "ck_rendicion_referencia_no_vacia" TO "ck_rendicion_numero_factura_no_vacio";
