-- Integridad de Cliente y Contacto en la base (Bloque E).
--
-- Estas reglas ya las valida la aplicación (shared/Zod y el backend), que responde 400 antes de
-- llegar acá. Los CHECK son la última línea de defensa frente a lo que no pasa por la API:
-- scripts, Prisma Studio, SQL manual, migraciones o un bug futuro. Prisma Schema no puede
-- representarlos, por eso viven solo en esta migración (ver los comentarios de schema.prisma).
--
-- Cuidado con la lógica de tres valores de SQL: un CHECK acepta TRUE y también NULL. Cada
-- condición se arma con `IS NULL` / `IS NOT NULL` explícitos para que ninguna rama pueda dar
-- NULL y dejar pasar una fila inválida (p. ej. `tipo IN (…)` con tipo NULL daría NULL).
--
-- Antes de aplicarla, verificar que no haya filas que la violen (si las hay, la migración falla
-- entera y no aplica nada).

-- Sector y subtipo: un público tiene subtipo; un privado no.
ALTER TABLE "Cliente" ADD CONSTRAINT "ck_cliente_sector_subtipo" CHECK (
  ("sector" = 'PUBLICO' AND "subtipo" IS NOT NULL)
  OR ("sector" = 'PRIVADO' AND "subtipo" IS NULL)
);

-- Canal de entrega: solo el dato mínimo que el canal necesita. NO se exige que los datos de los
-- otros canales estén vacíos (el contrato no lo pide).
ALTER TABLE "Cliente" ADD CONSTRAINT "ck_cliente_portal_requerido" CHECK (
  "canalEntrega" <> 'PORTAL_WEB'
  OR ("portalUrl" IS NOT NULL AND btrim("portalUrl") <> '')
);

ALTER TABLE "Cliente" ADD CONSTRAINT "ck_cliente_whatsapp_requerido" CHECK (
  "canalEntrega" <> 'WHATSAPP'
  OR ("whatsappNumero" IS NOT NULL AND btrim("whatsappNumero") <> '')
);

-- Periodicidad: exactamente uno de estos estados.
--   sin configurar          → las tres columnas en NULL;
--   MENSUAL / POR_CAMPANIA  → día 1..28, sin mes;
--   BIMESTRAL               → día 1..28 y mes 1..12.
ALTER TABLE "Cliente" ADD CONSTRAINT "ck_cliente_periodicidad_coherente" CHECK (
  (
    "periodicidadTipo" IS NULL
    AND "periodicidadDiaLimite" IS NULL
    AND "periodicidadMesInicioCiclo" IS NULL
  )
  OR (
    "periodicidadTipo" IS NOT NULL
    AND "periodicidadTipo" IN ('MENSUAL', 'POR_CAMPANIA')
    AND "periodicidadDiaLimite" IS NOT NULL
    AND "periodicidadDiaLimite" BETWEEN 1 AND 28
    AND "periodicidadMesInicioCiclo" IS NULL
  )
  OR (
    "periodicidadTipo" IS NOT NULL
    AND "periodicidadTipo" = 'BIMESTRAL'
    AND "periodicidadDiaLimite" IS NOT NULL
    AND "periodicidadDiaLimite" BETWEEN 1 AND 28
    AND "periodicidadMesInicioCiclo" IS NOT NULL
    AND "periodicidadMesInicioCiclo" BETWEEN 1 AND 12
  )
);

-- Baja lógica: la marca y la fecha van juntas.
ALTER TABLE "Cliente" ADD CONSTRAINT "ck_cliente_baja_logica" CHECK (
  ("isDeleted" = false AND "deletedAt" IS NULL)
  OR ("isDeleted" = true AND "deletedAt" IS NOT NULL)
);

ALTER TABLE "Contacto" ADD CONSTRAINT "ck_contacto_baja_logica" CHECK (
  ("isDeleted" = false AND "deletedAt" IS NULL)
  OR ("isDeleted" = true AND "deletedAt" IS NOT NULL)
);
