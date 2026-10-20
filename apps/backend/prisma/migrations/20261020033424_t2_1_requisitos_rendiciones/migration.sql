-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "indicacionesArmado" VARCHAR(1000),
ADD COLUMN     "matrizConfigurada" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TipoDocumento" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(500),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TipoDocumento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequisitoCliente" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "tipoDocumentoId" UUID NOT NULL,
    "cantidad" SMALLINT NOT NULL DEFAULT 1,
    "diasAproximados" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "canalEntrega" "CanalEntrega",
    "nota" VARCHAR(500),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RequisitoCliente_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rendicion" (
    "id" UUID NOT NULL,
    "clienteId" UUID NOT NULL,
    "anio" SMALLINT NOT NULL,
    "mes" SMALLINT NOT NULL,
    "referencia" VARCHAR(100) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rendicion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemChecklist" (
    "id" UUID NOT NULL,
    "rendicionId" UUID NOT NULL,
    "requisitoClienteId" UUID NOT NULL,
    "tipoDocumentoId" UUID NOT NULL,
    "nombreTipoDocumento" VARCHAR(100) NOT NULL,
    "ordinal" SMALLINT NOT NULL,
    "totalOrdinal" SMALLINT NOT NULL,
    "diaAproximado" SMALLINT,
    "canalEntrega" "CanalEntrega" NOT NULL,
    "aplica" BOOLEAN NOT NULL DEFAULT true,
    "completado" BOOLEAN NOT NULL DEFAULT false,
    "completadoAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemChecklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TipoDocumento_nombre_key" ON "TipoDocumento"("nombre");

-- CreateIndex
CREATE UNIQUE INDEX "Rendicion_clienteId_anio_mes_referencia_key" ON "Rendicion"("clienteId", "anio", "mes", "referencia");

-- CreateIndex
CREATE UNIQUE INDEX "ItemChecklist_rendicionId_requisitoClienteId_ordinal_key" ON "ItemChecklist"("rendicionId", "requisitoClienteId", "ordinal");

-- AddForeignKey
ALTER TABLE "RequisitoCliente" ADD CONSTRAINT "RequisitoCliente_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequisitoCliente" ADD CONSTRAINT "RequisitoCliente_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rendicion" ADD CONSTRAINT "Rendicion_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChecklist" ADD CONSTRAINT "ItemChecklist_rendicionId_fkey" FOREIGN KEY ("rendicionId") REFERENCES "Rendicion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChecklist" ADD CONSTRAINT "ItemChecklist_requisitoClienteId_fkey" FOREIGN KEY ("requisitoClienteId") REFERENCES "RequisitoCliente"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemChecklist" ADD CONSTRAINT "ItemChecklist_tipoDocumentoId_fkey" FOREIGN KEY ("tipoDocumentoId") REFERENCES "TipoDocumento"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Integridad de requisitos y rendiciones (T2.1, ADR-0003) ─────────────────
--
-- Agregado a mano: Prisma Schema no puede representar CHECK ni índices parciales (están listados
-- en el bloque de comentarios de schema.prisma). Mismo criterio que la migración de integridad
-- de Cliente y Contacto: la aplicación valida primero (T2.2) y estos CHECK son la última línea
-- de defensa frente a scripts, Prisma Studio, SQL manual o un bug futuro.
--
-- Cuidado con la lógica de tres valores de SQL: un CHECK acepta TRUE y también NULL. Cada
-- condición usa `IS NULL` / `IS NOT NULL` explícitos para que ninguna rama dé NULL. Ojo en
-- particular con las listas: Prisma crea `Int[]` SIN `NOT NULL`, y `x >= ALL(arr)` da NULL si el
-- array tiene algún elemento NULL.

-- Unicidad cliente + tipo de documento solo entre requisitos activos: un requisito dado de baja
-- no impide volver a agregarlo (ver ADR-0003).
CREATE UNIQUE INDEX "uq_requisito_cliente_tipo_activo"
  ON "RequisitoCliente"("clienteId", "tipoDocumentoId")
  WHERE "isDeleted" = false;

-- Cantidad por período: al menos uno.
ALTER TABLE "RequisitoCliente" ADD CONSTRAINT "ck_requisito_cantidad_positiva" CHECK (
  "cantidad" >= 1
);

-- Días aproximados: la lista existe, y o está vacía o tiene exactamente un día por ocurrencia.
ALTER TABLE "RequisitoCliente" ADD CONSTRAINT "ck_requisito_dias_coherentes" CHECK (
  "diasAproximados" IS NOT NULL
  AND (
    cardinality("diasAproximados") = 0
    OR cardinality("diasAproximados") = "cantidad"
  )
);

-- Cada día entre 1 y 31, sin elementos NULL y en una lista de una sola dimensión. Una lista
-- vacía cumple (ALL sobre vacío es TRUE).
ALTER TABLE "RequisitoCliente" ADD CONSTRAINT "ck_requisito_dias_rango" CHECK (
  "diasAproximados" IS NOT NULL
  AND (
    cardinality("diasAproximados") = 0
    OR (
      array_ndims("diasAproximados") = 1
      AND array_position("diasAproximados", NULL) IS NULL
      AND 1 <= ALL("diasAproximados")
      AND 31 >= ALL("diasAproximados")
    )
  )
);

-- Baja lógica: la marca y la fecha van juntas.
ALTER TABLE "RequisitoCliente" ADD CONSTRAINT "ck_requisito_baja_logica" CHECK (
  ("isDeleted" = false AND "deletedAt" IS NULL)
  OR ("isDeleted" = true AND "deletedAt" IS NOT NULL)
);

-- Período: mes válido y un año razonable.
ALTER TABLE "Rendicion" ADD CONSTRAINT "ck_rendicion_mes" CHECK (
  "mes" BETWEEN 1 AND 12
  AND "anio" BETWEEN 2020 AND 2100
);

-- La referencia (factura u orden) no puede ser vacía ni solo espacios.
ALTER TABLE "Rendicion" ADD CONSTRAINT "ck_rendicion_referencia_no_vacia" CHECK (
  btrim("referencia") <> ''
);

-- Numeración del ítem dentro de su requisito: 1 de N … N de N.
ALTER TABLE "ItemChecklist" ADD CONSTRAINT "ck_item_ordinal" CHECK (
  "ordinal" >= 1
  AND "ordinal" <= "totalOrdinal"
);

-- Completado y fecha de completado van juntos.
ALTER TABLE "ItemChecklist" ADD CONSTRAINT "ck_item_completado_coherente" CHECK (
  ("completado" = false AND "completadoAt" IS NULL)
  OR ("completado" = true AND "completadoAt" IS NOT NULL)
);

-- Día aproximado opcional; si está, entre 1 y 31.
ALTER TABLE "ItemChecklist" ADD CONSTRAINT "ck_item_dia_rango" CHECK (
  "diaAproximado" IS NULL
  OR "diaAproximado" BETWEEN 1 AND 31
);
