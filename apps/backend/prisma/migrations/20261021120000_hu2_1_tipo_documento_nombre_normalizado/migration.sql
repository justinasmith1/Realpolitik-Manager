-- ─── HU2.1: unicidad del nombre del tipo de documento sin mayúsculas ni acentos (ADR-0003) ──
--
-- Escrita a mano. `nombreNormalizado` es la clave de unicidad: la calcula
-- `normalizarNombreTipoDocumento` (@realpolitik/shared), la ÚNICA implementación de la regla.
-- Esta migración no la reimplementa: solo completa las filas que ya existen, que hasta ahora
-- únicamente puede haber cargado el seed (T2.1), y todas son texto ASCII imprimible.
--
-- Para ese texto, la regla de shared se reduce exactamente a: recortar los espacios de los bordes,
-- colapsar los internos y pasar A-Z a minúsculas. No hay acentos que quitar ni otros espacios que
-- colapsar. Es lo que hace el UPDATE de abajo; `COLLATE "C"` asegura que `lower` toque solo A-Z,
-- sea cual sea la collation de la base.
--
-- Cualquier otro dato (acentos, ñ, caracteres de control, un nombre vacío) no se adivina: la
-- migración aborta ANTES de modificar nada y hay que revisarlo a mano. Tampoco fusiona filas:
-- si dos nombres dan la misma clave, aborta y los nombra.
--
-- Todo va en UNA transacción explícita: si algo falla (una guarda, o el DROP INDEX en una base
-- que no tiene el índice esperado), PostgreSQL deshace todo y la tabla queda como estaba, sin una
-- columna a medio completar. Todas las operaciones admiten transacción (no hay CREATE INDEX
-- CONCURRENTLY ni nada que lo impida). La tabla es chica: el bloqueo exclusivo dura muy poco.
-- No se borran filas ni se tocan ids, así que los requisitos e ítems que apuntan a los tipos
-- siguen intactos.

BEGIN;

-- 1. Datos inesperados: todo nombre tiene que ser ASCII imprimible (espacio a ~) y no vacío.
DO $$
DECLARE
  inesperados TEXT;
BEGIN
  SELECT string_agg(format('%L', "nombre"), ', ' ORDER BY "nombre")
    INTO inesperados
    FROM "TipoDocumento"
   WHERE "nombre" COLLATE "C" ~ '[^ -~]'
      OR btrim("nombre") = '';
  IF inesperados IS NOT NULL THEN
    RAISE EXCEPTION 'HU2.1: hay tipos de documento cuyo nombre no es ASCII imprimible o está vacío: %. Esta migración solo calcula nombreNormalizado para nombres ASCII: corregí esos nombres a mano y volvé a ejecutarla.', inesperados;
  END IF;
END $$;

-- 2. Colisiones: dos nombres que dan la misma clave no se fusionan solos.
DO $$
DECLARE
  colisiones TEXT;
BEGIN
  SELECT string_agg(grupo, '; ' ORDER BY grupo)
    INTO colisiones
    FROM (
      SELECT string_agg(format('%L', "nombre"), ' = ' ORDER BY "nombre") AS grupo
        FROM "TipoDocumento"
       GROUP BY lower(regexp_replace(btrim("nombre"), ' {2,}', ' ', 'g') COLLATE "C")
      HAVING count(*) > 1
    ) AS repetidos;
  IF colisiones IS NOT NULL THEN
    RAISE EXCEPTION 'HU2.1: hay tipos de documento que son el mismo nombre sin distinguir mayúsculas: %. La migración no los fusiona porque requisitos y rendiciones pueden apuntar a cualquiera de ellos: resolvelo a mano y volvé a ejecutarla.', colisiones;
  END IF;
END $$;

-- 3. La columna, completada para las filas existentes.
ALTER TABLE "TipoDocumento" ADD COLUMN "nombreNormalizado" VARCHAR(100);

UPDATE "TipoDocumento"
   SET "nombreNormalizado" = lower(regexp_replace(btrim("nombre"), ' {2,}', ' ', 'g') COLLATE "C");

ALTER TABLE "TipoDocumento" ALTER COLUMN "nombreNormalizado" SET NOT NULL;

-- 4. La unicidad pasa del nombre exacto a la clave normalizada.
DROP INDEX "TipoDocumento_nombre_key";

CREATE UNIQUE INDEX "TipoDocumento_nombreNormalizado_key" ON "TipoDocumento"("nombreNormalizado");

COMMIT;
