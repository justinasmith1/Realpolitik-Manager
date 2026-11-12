// Regenera src/modules/auth/listaDeContrasenasComunes.ts a partir de SecLists, de forma
// reproducible (ADR-0006 §2). No es parte del build ni del servidor: se corre a mano cuando cambia
// la política (por ejemplo, el largo mínimo, P5) o la fuente.
//
//   cd apps/backend
//   node scripts/generar-lista-contrasenas-comunes.mjs                  # descarga las fuentes fijadas
//   node scripts/generar-lista-contrasenas-comunes.mjs --fuentes <dir>  # usa copias locales
//
// Garantías:
// - Fuente fija: un commit de SecLists y dos archivos, verificados por SHA-256 antes de usarlos. Si
//   un archivo no coincide, no se escribe nada.
// - Determinista: el mismo filtro y el mismo orden siempre dan el mismo archivo.
// - Sin secretos ni datos de usuarios; solo módulos nativos de Node (18 o superior, por `fetch`).
//
// El filtro tiene que coincidir con la política (`politicaDeContrasenas.ts` y shared): el test
// `listaDeContrasenasComunes.test.ts` lo comprueba sobre el archivo generado.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMMIT = '913b327317496d062bcc7cace524aaad8a693be2';
const BASE = `https://raw.githubusercontent.com/danielmiessler/SecLists/${COMMIT}`;
const FUENTES = [
  {
    archivo: 'Pwdb_top-1000000.txt',
    ruta: 'Passwords/Common-Credentials/Pwdb_top-1000000.txt',
    sha256: 'e9a88f67aafe65496682dc374559ee714e978bee50314767494c3e37a18c9fc8',
  },
  {
    archivo: 'xato-net-10-million-passwords-1000000.txt',
    ruta: 'Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt',
    sha256: '424a3e03a17df0a2bc2b3ca749d81b04e79d59cb7aeec8876a5a3f308d0caf51',
  },
];
const LICENCIA = {
  archivo: 'LICENSE',
  ruta: 'LICENSE',
  sha256: '3dbdc93d5f8829de0941744841730a09c106d0732e5ae0e98ca1d77be7ded66c',
};

// Los mismos valores que `CONTRASENA_LARGO_MINIMO` y `CONTRASENA_LARGO_MAXIMO` de shared.
const LARGO_MINIMO = 8;
const LARGO_MAXIMO = 128;
// La misma regla que `esRepeticionTrivial` de la política: una unidad de 1 a 4 caracteres repetida.
const UNIDAD_MAXIMA = 4;

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'src', 'modules', 'auth', 'listaDeContrasenasComunes.ts');

function leerArgumentos(argv) {
  const indice = argv.indexOf('--fuentes');
  return { fuentes: indice >= 0 ? argv[indice + 1] : null };
}

async function obtener({ archivo, ruta, sha256 }, dirLocal) {
  const contenido = dirLocal
    ? readFileSync(path.join(dirLocal, archivo))
    : Buffer.from(await (await fetch(`${BASE}/${ruta}`)).arrayBuffer());
  const real = createHash('sha256').update(contenido).digest('hex');
  if (real !== sha256) {
    throw new Error(
      `${archivo}: el SHA-256 no coincide (esperado ${sha256}, recibido ${real}). No se escribe nada.`,
    );
  }
  return contenido.toString('utf8');
}

function esRepeticionTrivial(texto) {
  const puntos = [...texto];
  for (let largo = 1; largo <= UNIDAD_MAXIMA && largo * 2 <= puntos.length; largo += 1) {
    if (puntos.every((punto, i) => punto === puntos[i % largo])) return true;
  }
  return false;
}

// eslint-disable-next-line no-control-regex
const INVALIDO = /[\u0000-\u001F\u007F-\u009F]|\p{Cs}/u;

function filtrar(textos) {
  const conjunto = new Set();
  for (const texto of textos) {
    for (const linea of texto.split(/\r?\n/)) {
      const normalizada = linea.normalize('NFC').toLowerCase();
      if (!normalizada || INVALIDO.test(normalizada)) continue;
      const largo = [...normalizada].length;
      if (largo < LARGO_MINIMO || largo > LARGO_MAXIMO) continue;
      if (esRepeticionTrivial(normalizada)) continue;
      conjunto.add(normalizada);
    }
  }
  return [...conjunto].sort();
}

function modulo(entradas, licencia) {
  const textoLicencia = licencia
    .trim()
    .split(/\r?\n/)
    .map((linea) => `// ${linea}`.trimEnd())
    .join('\n');
  return `// Contraseñas comunes de ${LARGO_MINIMO} o más caracteres, para la lista de bloqueo de la política de
// contraseñas (ADR-0006 §2). ARCHIVO GENERADO por scripts/generar-lista-contrasenas-comunes.mjs:
// no se edita a mano.
//
// Qué es y qué no es:
// - Son las entradas de dos listas públicas de frecuencia, "el millón de contraseñas más usadas"
//   según filtraciones, que alcanzan el largo mínimo propuesto. Bloquea las contraseñas largas más
//   repetidas (secuencias, teclados, frases y repeticiones obvias).
// - NO detecta todas las contraseñas comprometidas: las bases completas de filtraciones tienen
//   cientos de millones de entradas. Es una base local y sin servicios externos; la consulta a un
//   servicio de contraseñas comprometidas queda como evolución (ADR-0006).
// - Son datos públicos, no contraseñas de usuarios de Realpolitik.
//
// Origen: SecLists (https://github.com/danielmiessler/SecLists), commit ${COMMIT},
${FUENTES.map((f) => `//   ${f.ruta} (SHA-256 ${f.sha256})`).join('\n')}
// Filtro, en este orden: NFC; minúsculas; sin caracteres de control ni sustitutos sueltos; de ${LARGO_MINIMO} a
//   ${LARGO_MAXIMO} puntos de código; sin las repeticiones triviales que ya rechaza la política (una unidad de 1
//   a ${UNIDAD_MAXIMA} caracteres repetida); sin repetidas; orden de código. Resultado: ${entradas.length} entradas.
// Para regenerarla: \`node scripts/generar-lista-contrasenas-comunes.mjs\` (ver el script). El test
//   \`listaDeContrasenasComunes.test.ts\` comprueba que el archivo cumple el filtro.
//
// Licencia de SecLists, que se conserva con los datos derivados:
//
${textoLicencia}

/** Entradas ya normalizadas (NFC y minúsculas). Se cargan una vez en un \`Set\`. */
export const CONTRASENAS_COMUNES: readonly string[] = [
${entradas.map((entrada) => `  ${JSON.stringify(entrada)},`).join('\n')}
];
`;
}

const { fuentes } = leerArgumentos(process.argv.slice(2));
try {
  const textos = await Promise.all(FUENTES.map((fuente) => obtener(fuente, fuentes)));
  const licencia = await obtener(LICENCIA, fuentes);
  const entradas = filtrar(textos);
  writeFileSync(SALIDA, modulo(entradas, licencia), 'utf8');
  console.log(
    `Escrito ${path.relative(RAIZ, SALIDA)}: ${entradas.length} entradas. Formateá con Prettier antes de versionar.`,
  );
} catch (error) {
  console.error(`ERROR  ${error.message}`);
  process.exit(1);
}
