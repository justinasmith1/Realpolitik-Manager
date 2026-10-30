-- ─── HU2.8: documentos cargados una vez y aplicados a ítems de rendiciones (ADR-0004) ─────────
--
-- Aditiva: crea dos tablas nuevas y un índice único sobre "ItemChecklist". No borra ni cambia
-- columnas, filas ni restricciones existentes, y no completa datos (las tablas nacen vacías).
--
-- La primera parte la generó `prisma migrate diff` entre el schema anterior y el nuevo. La
-- segunda, la integridad, está escrita a mano: Prisma Schema no puede representar CHECK ni
-- índices parciales (están listados en el bloque de comentarios de schema.prisma).
--
-- Todo va en UNA transacción explícita: si algo falla, no queda una tabla sin sus restricciones.
-- Ninguna operación lo impide (no hay CREATE INDEX CONCURRENTLY). El índice nuevo de
-- "ItemChecklist" bloquea las escrituras de esa tabla mientras se crea; la tabla es chica.
--
-- Historial protegido: las FK nuevas son RESTRICT. Un ítem con aplicaciones no se puede borrar
-- físicamente, así que el CASCADE existente de "ItemChecklist" → "Rendicion" tampoco puede
-- borrar una rendición con documentos aplicados: el RESTRICT de la aplicación lo frena. La
-- anulación de rendiciones es una baja lógica y no toca nada de esto.

BEGIN;

-- CreateTable
CREATE TABLE "Documento" (
    "id" UUID NOT NULL,
    "tipoDocumentoId" UUID NOT NULL,
    "anio" SMALLINT NOT NULL,
    "mes" SMALLINT NOT NULL,
    "nombreOriginal" VARCHAR(255) NOT NULL,
    "tipoContenido" VARCHAR(255) NOT NULL,
    "tamanioBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "claveAlmacenamiento" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AplicacionDocumento" (
    "id" UUID NOT NULL,
    "documentoId" UUID NOT NULL,
    "itemChecklistId" UUID NOT NULL,
    "tipoDocumentoId" UUID NOT NULL,
    "aplicadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reemplazadaEn" TIMESTAMP(3),
    "reemplazaAId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AplicacionDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Documento_claveAlmacenamiento_key" ON "Documento"("claveAlmacenamiento");

-- CreateIndex
CREATE INDEX "Documento_anio_mes_tipoDocumentoId_idx" ON "Documento"("anio", "mes", "tipoDocumentoId");

-- CreateIndex
CREATE INDEX "Documento_sha256_idx" ON "Documento"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "Documento_id_tipoDocumentoId_key" ON "Documento"("id", "tipoDocumentoId");

-- CreateIndex
CREATE UNIQUE INDEX "AplicacionDocumento_reemplazaAId_key" ON "AplicacionDocumento"("reemplazaAId");

-- CreateIndex
CREATE INDEX "AplicacionDocumento_documentoId_idx" ON "AplicacionDocumento"("documentoId");

-- CreateIndex
CREATE INDEX "AplicacionDocumento_itemChecklistId_idx" ON "AplicacionDocumento"("itemChecklistId");

-- CreateIndex
CREATE UNIQUE INDEX "AplicacionDocumento_id_itemChecklistId_key" ON "AplicacionDocumento"("id", "itemChecklistId");

-- CreateIndex
CREATE UNIQUE INDEX "AplicacionDocumento_reemplazaAId_itemChecklistId_key" ON "AplicacionDocumento"("reemplazaAId", "itemChecklistId");

-- CreateIndex
CREATE UNIQUE INDEX "ItemChecklist_id_tipoDocumentoId_key" ON "ItemChecklist"("id", "tipoDocumentoId");

-- AddForeignKey
ALTER TABLE "Documento" ADD CONSTRAINT "Documento_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionDocumento" ADD CONSTRAINT "AplicacionDocumento_documentoId_tipoDocumentoId_fkey" FOREIGN KEY ("documentoId", "tipoDocumentoId") REFERENCES "Documento"("id", "tipoDocumentoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionDocumento" ADD CONSTRAINT "AplicacionDocumento_itemChecklistId_tipoDocumentoId_fkey" FOREIGN KEY ("itemChecklistId", "tipoDocumentoId") REFERENCES "ItemChecklist"("id", "tipoDocumentoId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AplicacionDocumento" ADD CONSTRAINT "AplicacionDocumento_reemplazaAId_itemChecklistId_fkey" FOREIGN KEY ("reemplazaAId", "itemChecklistId") REFERENCES "AplicacionDocumento"("id", "itemChecklistId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integridad de documentos y aplicaciones (HU2.8, ADR-0004) ───────────────
--
-- Agregado a mano. Mismo criterio que las migraciones de integridad anteriores: la aplicación
-- valida primero (@realpolitik/shared y el backend) y esto es la última línea de defensa frente a
-- scripts, Prisma Studio, SQL manual o un bug futuro. Todas las columnas que se comparan son
-- NOT NULL salvo las que se tratan con IS NULL explícito: ninguna condición puede dar NULL.
--
-- Tipo del documento = tipo del ítem: lo garantizan las dos FK compuestas de arriba, que
-- comparten la columna "AplicacionDocumento"."tipoDocumentoId". Si alguien cambiara el tipo de un
-- ítem con aplicaciones, el ON UPDATE CASCADE lo llevaría a la aplicación y ahí lo rechazaría la
-- FK hacia "Documento" (que conserva el tipo anterior).
--
-- Un reemplazo encadena aplicaciones del MISMO ítem: lo garantiza la FK compuesta
-- ("reemplazaAId", "itemChecklistId"). Con "reemplazaAId" NULL (la primera aplicación de un ítem)
-- la FK no se evalúa (MATCH SIMPLE), que es lo esperado.
--
-- El período del documento = el de la rendición NO se garantiza acá: lo valida el servicio
-- (ADR-0004, "Integridad"). Tampoco las reglas que cruzan filas: que la aplicación reemplazada
-- tenga "reemplazadaEn", o que la nueva se aplique después.

-- Una sola aplicación vigente por ítem. Las reemplazadas (con "reemplazadaEn") quedan como
-- historial y no cuentan. Un mismo documento sí puede estar vigente en muchos ítems.
CREATE UNIQUE INDEX "uq_aplicacion_documento_item_vigente"
  ON "AplicacionDocumento"("itemChecklistId")
  WHERE "reemplazadaEn" IS NULL;

-- Período: el mismo rango que la rendición (ck_rendicion_mes).
ALTER TABLE "Documento" ADD CONSTRAINT "ck_documento_mes" CHECK (
  "mes" BETWEEN 1 AND 12
  AND "anio" BETWEEN 2020 AND 2100
);

-- Un archivo vacío no es un documento. El tope (10 MB) es de shared: cambiarlo no exige migración.
ALTER TABLE "Documento" ADD CONSTRAINT "ck_documento_tamanio_positivo" CHECK (
  "tamanioBytes" > 0
);

-- SHA-256 en hexadecimal, en minúscula. En CHAR(64) un valor más corto se completaría con
-- espacios, pero al compararlo con una expresión regular esos espacios se descartan: no pasa.
ALTER TABLE "Documento" ADD CONSTRAINT "ck_documento_sha256_formato" CHECK (
  "sha256" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "Documento" ADD CONSTRAINT "ck_documento_nombre_original_no_vacio" CHECK (
  btrim("nombreOriginal") <> ''
);

-- Forma de un MIME (tipo/subtipo con los caracteres de RFC 6838), en minúscula. Qué formatos se
-- admiten lo decide shared (FORMATOS_DE_DOCUMENTO): sumar uno no exige migración.
ALTER TABLE "Documento" ADD CONSTRAINT "ck_documento_tipo_contenido_formato" CHECK (
  "tipoContenido" ~ '^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$'
);

ALTER TABLE "Documento" ADD CONSTRAINT "ck_documento_clave_no_vacia" CHECK (
  btrim("claveAlmacenamiento") <> ''
);

-- Una aplicación deja de estar vigente después (o en el mismo instante) de aplicarse.
ALTER TABLE "AplicacionDocumento" ADD CONSTRAINT "ck_aplicacion_fechas_coherentes" CHECK (
  "reemplazadaEn" IS NULL
  OR "reemplazadaEn" >= "aplicadaEn"
);

-- Una aplicación no se reemplaza a sí misma. Que reemplace a una sola, y que cada una sea
-- reemplazada una sola vez, lo da el índice único de "reemplazaAId".
ALTER TABLE "AplicacionDocumento" ADD CONSTRAINT "ck_aplicacion_no_se_reemplaza_a_si_misma" CHECK (
  "reemplazaAId" IS NULL
  OR "reemplazaAId" <> "id"
);

COMMIT;
