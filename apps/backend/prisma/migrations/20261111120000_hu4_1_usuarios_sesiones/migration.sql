-- HU4.1: usuarios, roles y sesiones opacas (ADR-0006).
--
-- El DDL es el que genera Prisma para `schema.prisma`. Se agregan a mano los CHECK, que Prisma
-- Schema no puede representar (ver la cabecera del schema). La migración solo agrega: un enum y
-- dos tablas nuevas, sin tocar las existentes ni sus datos. No crea usuarios.

-- CreateEnum
CREATE TYPE "RolUsuario" AS ENUM ('ADMINISTRADOR', 'ADMINISTRATIVO', 'CONSULTA');

-- CreateTable
CREATE TABLE "Usuario" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "rol" "RolUsuario" NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "debeCambiarPassword" BOOLEAN NOT NULL DEFAULT true,
    "passwordActualizadaEn" TIMESTAMP(3) NOT NULL,
    "ultimoAccesoEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sesion" (
    "id" UUID NOT NULL,
    "usuarioId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "ultimaActividadEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiraEn" TIMESTAMP(3) NOT NULL,
    "revocadaEn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sesion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_email_key" ON "Usuario"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Sesion_tokenHash_key" ON "Sesion"("tokenHash");

-- CreateIndex
CREATE INDEX "Sesion_usuarioId_idx" ON "Sesion"("usuarioId");

-- AddForeignKey
ALTER TABLE "Sesion" ADD CONSTRAINT "Sesion_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── CHECK (a mano) ───────────────────────────────────────────────────────────

-- El email se guarda normalizado: así el índice único no distingue mayúsculas ni espacios en los
-- bordes. La validación completa del formato es de la aplicación; acá solo la forma x@y.
ALTER TABLE "Usuario" ADD CONSTRAINT "ck_usuario_email_normalizado" CHECK (
  "email" = lower(btrim("email"))
  AND "email" ~ '^[^@[:space:]]+@[^@[:space:]]+$'
);

ALTER TABLE "Usuario" ADD CONSTRAINT "ck_usuario_nombre_no_vacio" CHECK (
  btrim("nombre") <> ''
);

-- Solo hashes PHC de argon2id ($argon2id$v=…$m=…,t=…,p=…$sal$hash). Impide guardar por error una
-- contraseña en claro o un hash de otro algoritmo. No fija los parámetros: cambian sin migración.
ALTER TABLE "Usuario" ADD CONSTRAINT "ck_usuario_password_hash_argon2id" CHECK (
  "passwordHash" LIKE '$argon2id$%'
);

-- SHA-256 del token en hexadecimal, en minúscula (como ck_documento_sha256_formato).
ALTER TABLE "Sesion" ADD CONSTRAINT "ck_sesion_token_hash_formato" CHECK (
  "tokenHash" ~ '^[0-9a-f]{64}$'
);

-- Una sesión vence después de empezar, y no registra actividad ni revocación antes de empezar.
ALTER TABLE "Sesion" ADD CONSTRAINT "ck_sesion_fechas_coherentes" CHECK (
  "expiraEn" > "createdAt"
  AND "ultimaActividadEn" >= "createdAt"
  AND ("revocadaEn" IS NULL OR "revocadaEn" >= "createdAt")
);
