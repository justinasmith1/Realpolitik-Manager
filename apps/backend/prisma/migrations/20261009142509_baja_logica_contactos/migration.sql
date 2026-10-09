-- AlterTable
ALTER TABLE "Contacto" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "Contacto_clienteId_email_key" ON "Contacto"("clienteId", "email") WHERE "isDeleted" = false;
