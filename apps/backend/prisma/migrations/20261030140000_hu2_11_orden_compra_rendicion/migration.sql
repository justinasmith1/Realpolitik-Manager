-- HU2.11: orden de compra (OC) de cada rendición.
--
-- Los tres datos son opcionales y pertenecen a la rendición, no al cliente. No hay unicidad: el
-- mismo número se repite en otros meses, en otras facturas y entre clientes (cada organismo
-- numera sus OC). Las rendiciones existentes quedan con los tres campos NULL.

ALTER TABLE "Rendicion"
  ADD COLUMN "numeroOc" VARCHAR(100),
  ADD COLUMN "montoMensual" DECIMAL(14,2),
  ADD COLUMN "montoTotal" DECIMAL(14,2);

ALTER TABLE "Rendicion"
  ADD CONSTRAINT "ck_rendicion_numero_oc_no_vacio"
    CHECK ("numeroOc" IS NULL OR btrim("numeroOc") <> ''),
  ADD CONSTRAINT "ck_rendicion_montos_oc_no_negativos"
    CHECK (("montoMensual" IS NULL OR "montoMensual" >= 0)
       AND ("montoTotal" IS NULL OR "montoTotal" >= 0));

-- Última OC de un cliente (GET /clientes/:id/ultima-oc).
CREATE INDEX "Rendicion_clienteId_numeroOc_idx" ON "Rendicion"("clienteId", "numeroOc");

