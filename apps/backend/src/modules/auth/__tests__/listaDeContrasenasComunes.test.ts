// El archivo generado cumple el filtro que declara su cabecera y que aplica el script
// `scripts/generar-lista-contrasenas-comunes.mjs`, así una regeneración que no lo respete se detecta.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CONTRASENA_LARGO_MAXIMO, CONTRASENA_LARGO_MINIMO } from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

import { CONTRASENAS_COMUNES } from '../listaDeContrasenasComunes';
import { esRepeticionTrivial } from '../politicaDeContrasenas';

const ARCHIVO = fileURLToPath(new URL('../listaDeContrasenasComunes.ts', import.meta.url));
const SCRIPT = fileURLToPath(
  new URL('../../../../scripts/generar-lista-contrasenas-comunes.mjs', import.meta.url),
);

describe('listaDeContrasenasComunes', () => {
  it('declara su origen verificable, su licencia y la cantidad real de entradas', () => {
    const fuente = readFileSync(ARCHIVO, 'utf8');

    expect(fuente).toContain('https://github.com/danielmiessler/SecLists');
    expect(fuente).toMatch(/commit [0-9a-f]{40}/);
    expect(fuente.match(/SHA-256 [0-9a-f]{64}/g)).toHaveLength(2);
    expect(fuente).toContain('scripts/generar-lista-contrasenas-comunes.mjs');
    expect(fuente).toContain('MIT License');
    expect(fuente).toContain(`Resultado: ${CONTRASENAS_COMUNES.length} entradas.`);
  });

  it('el script usa los mismos largos que la política de shared', () => {
    const script = readFileSync(SCRIPT, 'utf8');

    expect(script).toContain(`const LARGO_MINIMO = ${CONTRASENA_LARGO_MINIMO};`);
    expect(script).toContain(`const LARGO_MAXIMO = ${CONTRASENA_LARGO_MAXIMO};`);
  });

  it('cada entrada está normalizada, en el rango de largo y no es una repetición trivial', () => {
    const problemas = CONTRASENAS_COMUNES.filter((entrada) => {
      const largo = [...entrada].length;
      return (
        entrada !== entrada.normalize('NFC').toLowerCase() ||
        largo < CONTRASENA_LARGO_MINIMO ||
        largo > CONTRASENA_LARGO_MAXIMO ||
        esRepeticionTrivial(entrada) ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001F\u007F-\u009F]|\p{Cs}/u.test(entrada)
      );
    });

    expect(problemas).toEqual([]);
  });

  it('está ordenada y sin repetidas', () => {
    const ordenada = [...new Set(CONTRASENAS_COMUNES)].sort();

    expect(CONTRASENAS_COMUNES).toEqual(ordenada);
  });
});
