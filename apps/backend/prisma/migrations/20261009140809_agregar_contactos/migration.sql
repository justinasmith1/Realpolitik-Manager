-- CreateTable
CREATE TABLE "Contacto" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(150) NOT NULL,
    "area" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "recibeRendiciones" BOOLEAN NOT NULL DEFAULT false,
    "clienteId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contacto_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Contacto" ADD CONSTRAINT "Contacto_clienteId_fkey" FOREIGN KEY ("clienteId") REFERENCES "Cliente"("id") ON DELETE CASCADE ON UPDATE CASCADE;
