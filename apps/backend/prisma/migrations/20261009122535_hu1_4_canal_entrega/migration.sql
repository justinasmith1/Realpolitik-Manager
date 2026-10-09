-- CreateEnum
CREATE TYPE "CanalEntrega" AS ENUM ('CORREO', 'PORTAL_WEB', 'WHATSAPP');

-- AlterTable
ALTER TABLE "Cliente" ADD COLUMN     "canalEntrega" "CanalEntrega" NOT NULL DEFAULT 'CORREO',
ADD COLUMN     "whatsappNumero" VARCHAR(16);
