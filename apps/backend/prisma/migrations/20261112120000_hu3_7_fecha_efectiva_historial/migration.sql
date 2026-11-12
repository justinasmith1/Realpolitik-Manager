-- HU3.7: fecha efectiva de un cambio de estado (la fecha de envío elegida al marcar una rendición
-- como Enviada, que puede ser anterior al registro). Aditiva: las entradas existentes quedan en NULL.
ALTER TABLE "HistorialEstadoRendicion" ADD COLUMN "fechaEfectiva" DATE;
