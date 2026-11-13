-- HU3.10: cobro informado por el cliente.
--
-- Es una marca de la rendición, no un estado: no va en EstadoRendicion ni en el historial. La
-- fecha es el día en que el cliente avisó que pagó; la nota es opcional. Aditiva: las rendiciones
-- existentes quedan con las dos columnas en NULL. Sin índice ni CHECK de fecha futura o de estado:
-- los decide el servicio.

ALTER TABLE "Rendicion"
  ADD COLUMN "cobroFecha" DATE,
  ADD COLUMN "cobroNota" VARCHAR(300);

ALTER TABLE "Rendicion"
  ADD CONSTRAINT "ck_rendicion_cobro_nota_con_fecha"
    CHECK ("cobroNota" IS NULL OR "cobroFecha" IS NOT NULL),
  ADD CONSTRAINT "ck_rendicion_cobro_nota_no_vacia"
    CHECK ("cobroNota" IS NULL OR btrim("cobroNota") <> '');
