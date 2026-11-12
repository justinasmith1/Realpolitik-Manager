import {
  CONTRASENA_LARGO_MAXIMO,
  CONTRASENA_LARGO_MINIMO,
  MENSAJE_CONTRASENA_PREVISIBLE,
} from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

import {
  esDerivadoDelContexto,
  esRepeticionTrivial,
  evaluarContrasenaNueva,
  palabrasDelContexto,
} from '../politicaDeContrasenas';

const PERSONA = { email: 'mariana.gomez@ejemplo.example', nombre: 'Mariana Gómez' };

describe('evaluarContrasenaNueva', () => {
  describe('acepta contraseñas largas y poco previsibles', () => {
    it.each([
      ['una frase con espacios', 'el tren de las siete sale tarde'],
      ['con acentos y eñes', 'la cigüeña cruzó el río en canoa'],
      ['con emojis', 'mi 🐢 se llama Ramón y come 🍓'],
      ['sin mayúsculas, números ni símbolos', 'hoja verde sobre mesa de pino'],
      ['exactamente el mínimo', 'trébol-kayak-81'],
      ['exactamente el máximo', `${'kayak 81 v'.repeat(12)}trébolxy`],
      ['con pocos caracteres distintos pero sin repetir una unidad', 'aabbaabbbaabbab'],
    ])('%s', (_caso, contrasena) => {
      expect(evaluarContrasenaNueva(contrasena, PERSONA)).toEqual({ aceptada: true });
    });
  });

  describe('caracteres y largo (las mismas reglas que shared)', () => {
    it.each([
      ['vacía', '', 'MUY_CORTA'],
      ['un carácter menos que el mínimo', 'trébol-kayak-8', 'MUY_CORTA'],
      ['un carácter más que el máximo', 'q'.repeat(CONTRASENA_LARGO_MAXIMO + 1), 'MUY_LARGA'],
      ['con salto de línea', 'el tren de las siete\nsale tarde', 'CARACTERES_INVALIDOS'],
      ['con un sustituto suelto', 'el tren de las siete \uD83D sale', 'CARACTERES_INVALIDOS'],
    ])('rechaza una contraseña %s', (_caso, contrasena, motivo) => {
      expect(evaluarContrasenaNueva(contrasena, PERSONA)).toMatchObject({
        aceptada: false,
        motivo,
      });
    });

    it(`los espacios cuentan: ${CONTRASENA_LARGO_MINIMO - 2} caracteres con un espacio en cada borde alcanzan`, () => {
      expect(
        evaluarContrasenaNueva(` ${'kayaktrébol81x'.slice(0, CONTRASENA_LARGO_MINIMO - 2)} `),
      ).toEqual({
        aceptada: true,
      });
    });
  });

  describe('lista de contraseñas comunes', () => {
    it.each([
      ['secuencia numérica', '123456789012345'],
      ['fila del teclado', 'qwertyuiopasdfgh'],
      ['palabra repetida', 'passwordpassword'],
      ['en mayúsculas (la lista compara en minúsculas)', 'QWERTYUIOPASDFGH'],
      [
        'pocos caracteres distintos, agregada al cambiar la regla de repetición',
        '1111222233334444',
      ],
    ])('%s', (_caso, contrasena) => {
      expect(evaluarContrasenaNueva(contrasena, PERSONA)).toEqual({
        aceptada: false,
        motivo: 'PREVISIBLE',
        regla: 'LISTA_COMUN',
        mensaje: MENSAJE_CONTRASENA_PREVISIBLE,
      });
    });
  });

  describe('contexto: se compara la contraseña entera, no fragmentos', () => {
    it.each([
      ['el nombre de pila con números y símbolos', 'Mariana2026!!!!!'],
      ['el apellido con acento y números', 'Gómez 1990 #####'],
      ['el nombre completo', 'MarianaGómez2026'],
      ['el nombre completo al revés', 'gómez.mariana.1990'],
      ['la parte local del email', 'mariana.gomez 2026'],
      ['una parte del email repetida', 'gomez-gomez-gomez-1'],
      ['el nombre del servicio con números', 'Realpolitik2026!!'],
      ['el nombre del servicio completo', 'realpolitik manager 1'],
    ])('rechaza %s', (_caso, contrasena) => {
      expect(evaluarContrasenaNueva(contrasena, PERSONA)).toMatchObject({
        aceptada: false,
        motivo: 'PREVISIBLE',
        regla: 'CONTEXTO',
      });
    });

    // Falsos positivos que producía la regla anterior (rechazaba si la contraseña CONTENÍA el dato).
    it.each([
      [
        'una frase con el nombre de la persona',
        { email: 'rosa.flores@ejemplo.example', nombre: 'Rosa Flores' },
        'la rosa del jardín es azul',
      ],
      [
        'un email genérico cuya parte local es una palabra común',
        { email: 'info@ejemplo.example', nombre: 'Equipo Contable' },
        'info sobre el balance anual',
      ],
      ['una frase que menciona el servicio', PERSONA, 'mi clave de Realpolitik es larga'],
      ['una frase que contiene el nombre completo', PERSONA, 'soy mariana gómez y tomo mate'],
      [
        'un apellido que es parte de otra palabra',
        { nombre: 'Ana Paz' },
        'banana y paz en la montaña',
      ],
    ])('acepta %s', (_caso, contexto, contrasena) => {
      expect(evaluarContrasenaNueva(contrasena, contexto)).toEqual({ aceptada: true });
    });

    it('sin contexto, el nombre del servicio igual se compara', () => {
      expect(evaluarContrasenaNueva('realpolitik-2026-ok!')).toMatchObject({ aceptada: true });
      expect(evaluarContrasenaNueva('realpolitik-2026-!!')).toMatchObject({ regla: 'CONTEXTO' });
    });
  });

  describe('repetición trivial', () => {
    it.each([
      ['un solo carácter', 'z'.repeat(20)],
      ['dos caracteres alternados, con la última unidad incompleta', '9' + '19'.repeat(9)],
      ['una unidad de cuatro', 'abcd'.repeat(5)],
      ['una unidad con espacio', 'ab '.repeat(6)],
      ['mayúsculas y minúsculas de la misma unidad', 'AbAbabABabABabab'],
    ])('rechaza %s', (_caso, contrasena) => {
      expect(evaluarContrasenaNueva(contrasena)).toMatchObject({
        aceptada: false,
        motivo: 'PREVISIBLE',
        regla: 'REPETICION_TRIVIAL',
      });
    });

    it('una unidad de cinco caracteres ya no es trivial por esta regla', () => {
      expect(esRepeticionTrivial('abcdx'.repeat(3))).toBe(false);
      expect(evaluarContrasenaNueva('abcdx'.repeat(3))).toEqual({ aceptada: true });
    });

    it('pocos caracteres distintos sin una unidad repetida no es repetición', () => {
      expect(esRepeticionTrivial('aabbaabbbaabbab')).toBe(false);
    });
  });

  it('ningún resultado incluye la contraseña', () => {
    for (const contrasena of [
      'secreta-1',
      'passwordpassword',
      'z'.repeat(20),
      'Mariana2026!!!!!',
    ]) {
      expect(JSON.stringify(evaluarContrasenaNueva(contrasena, PERSONA))).not.toContain(contrasena);
    }
  });
});

describe('palabrasDelContexto', () => {
  it('reúne el servicio, el email y el nombre, reducidos a letras', () => {
    expect([...palabrasDelContexto(PERSONA)].sort()).toEqual(
      [
        'realpolitik',
        'realpolitikmanager',
        'marianagomez',
        'mariana',
        'gomez',
        'marianagómez',
        'gómezmariana',
        'gómez',
      ].sort(),
    );
  });

  it('descarta las partes de una sola letra y los vacíos', () => {
    expect(palabrasDelContexto({ email: 'j.p@ejemplo.example', nombre: '  ' })).toEqual(
      new Set(['realpolitik', 'realpolitikmanager', 'jp']),
    );
  });
});

describe('esDerivadoDelContexto', () => {
  it('una contraseña sin letras nunca es un derivado del contexto', () => {
    expect(esDerivadoDelContexto('2026 1990 ### !!', PERSONA)).toBe(false);
  });

  it('las letras tienen que ser exactamente la palabra o su repetición', () => {
    expect(esDerivadoDelContexto('mariana mariana', PERSONA)).toBe(true);
    expect(esDerivadoDelContexto('mariana mariano', PERSONA)).toBe(false);
  });
});
