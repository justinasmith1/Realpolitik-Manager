-- HU3.4 (deuda técnica): índice para GET /rendiciones/atrasadas (ADR-0005, punto 8). La consulta
-- filtra por isDeleted = false, estado IN (EN_CURSO, COMPLETA) y un período hasta el límite
-- (anio < X, o anio = X y mes <= Y). Las columnas van en ese orden: dos igualdades y el rango.

-- CreateIndex
CREATE INDEX "Rendicion_isDeleted_estado_anio_mes_idx" ON "Rendicion"("isDeleted", "estado", "anio", "mes");
