import { describe, expect, it } from 'vitest';

import {
  calcularFaltantes,
  ChecklistError,
  compararItemsDeChecklist,
  esChecklistError,
  generarChecklist,
  type RequisitoDeMatriz,
} from './checklist.js';

// Ids fijos y ordenables, para poder probar el desempate por id.
const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';
const ID_C = '00000000-0000-4000-8000-00000000000c';
const TIPO_1 = '10000000-0000-4000-8000-000000000001';
const TIPO_2 = '10000000-0000-4000-8000-000000000002';
const TIPO_3 = '10000000-0000-4000-8000-000000000003';

function requisito(parcial: Partial<RequisitoDeMatriz> = {}): RequisitoDeMatriz {
  return {
    id: ID_A,
    tipoDocumentoId: TIPO_1,
    nombreTipoDocumento: 'Factura',
    cantidad: 1,
    diasAproximados: [],
    canalEntrega: null,
    isDeleted: false,
    ...parcial,
  };
}

const clienteCorreo = { canalEntrega: 'CORREO' } as const;

/** Congela la matriz en profundidad: cualquier mutación lanza un error. */
function congelar<T>(valor: T): T {
  if (typeof valor === 'object' && valor !== null) {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}

function codigoDelError(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return esChecklistError(e) ? e.codigo : 'NO_ES_CHECKLIST_ERROR';
  }
  return undefined;
}

describe('generarChecklist', () => {
  describe('flujo feliz', () => {
    it('genera un ítem por unidad de cantidad con todos los campos del snapshot', () => {
      const matriz = [
        requisito({ id: ID_A, nombreTipoDocumento: 'Factura', cantidad: 1 }),
        requisito({
          id: ID_B,
          tipoDocumentoId: TIPO_2,
          nombreTipoDocumento: 'Print',
          cantidad: 3,
          diasAproximados: [1, 10, 20],
          canalEntrega: 'PORTAL_WEB',
        }),
      ];

      expect(generarChecklist(matriz, clienteCorreo)).toEqual([
        {
          requisitoClienteId: ID_A,
          tipoDocumentoId: TIPO_1,
          nombreTipoDocumento: 'Factura',
          ordinal: 1,
          totalOrdinal: 1,
          diaAproximado: null,
          canalEntrega: 'CORREO',
        },
        {
          requisitoClienteId: ID_B,
          tipoDocumentoId: TIPO_2,
          nombreTipoDocumento: 'Print',
          ordinal: 1,
          totalOrdinal: 3,
          diaAproximado: 1,
          canalEntrega: 'PORTAL_WEB',
        },
        {
          requisitoClienteId: ID_B,
          tipoDocumentoId: TIPO_2,
          nombreTipoDocumento: 'Print',
          ordinal: 2,
          totalOrdinal: 3,
          diaAproximado: 10,
          canalEntrega: 'PORTAL_WEB',
        },
        {
          requisitoClienteId: ID_B,
          tipoDocumentoId: TIPO_2,
          nombreTipoDocumento: 'Print',
          ordinal: 3,
          totalOrdinal: 3,
          diaAproximado: 20,
          canalEntrega: 'PORTAL_WEB',
        },
      ]);
    });

    it('funciona con UN solo requisito (así lo usa agregar un requisito a una rendición abierta)', () => {
      const items = generarChecklist([requisito({ cantidad: 2 })], clienteCorreo);
      expect(items).toHaveLength(2);
      expect(items.map((i) => [i.ordinal, i.totalOrdinal])).toEqual([
        [1, 2],
        [2, 2],
      ]);
    });
  });

  describe('matriz sin requisitos activos', () => {
    it('una matriz vacía lanza MATRIZ_VACIA', () => {
      expect(codigoDelError(() => generarChecklist([], clienteCorreo))).toBe('MATRIZ_VACIA');
    });

    it('una matriz con solo requisitos dados de baja también', () => {
      const matriz = [requisito({ isDeleted: true }), requisito({ id: ID_B, isDeleted: true })];
      expect(codigoDelError(() => generarChecklist(matriz, clienteCorreo))).toBe('MATRIZ_VACIA');
    });

    it('el error tiene un mensaje en español', () => {
      expect(() => generarChecklist([], clienteCorreo)).toThrow(
        'El cliente no tiene requisitos activos: configurá su matriz antes de abrir una rendición.',
      );
    });
  });

  describe('qué requisitos entran', () => {
    it('un requisito activo entra aunque su tipo de documento esté desactivado', () => {
      // La matriz no lleva si el tipo está activo: no es un dato que importe al generar.
      const conTipoInactivo = { ...requisito(), tipoActivo: false };
      const items = generarChecklist([conTipoInactivo], clienteCorreo);
      expect(items).toHaveLength(1);
      expect(items[0]?.nombreTipoDocumento).toBe('Factura');
    });

    it('un requisito dado de baja no entra, y los demás sí', () => {
      const matriz = [
        requisito({ id: ID_A, nombreTipoDocumento: 'Factura' }),
        requisito({ id: ID_B, nombreTipoDocumento: 'Print', cantidad: 4, isDeleted: true }),
      ];
      const items = generarChecklist(matriz, clienteCorreo);
      expect(items.map((i) => i.requisitoClienteId)).toEqual([ID_A]);
    });

    it('un requisito dado de baja con datos incoherentes no hace fallar', () => {
      const matriz = [
        requisito({ id: ID_A }),
        requisito({ id: ID_B, cantidad: 0, diasAproximados: [1, 2], isDeleted: true }),
      ];
      expect(() => generarChecklist(matriz, clienteCorreo)).not.toThrow();
    });
  });

  describe('cantidad y días', () => {
    it('cantidad > 1 sin días: todos los ítems con diaAproximado null', () => {
      const items = generarChecklist([requisito({ cantidad: 5 })], clienteCorreo);
      expect(items.map((i) => i.ordinal)).toEqual([1, 2, 3, 4, 5]);
      expect(items.every((i) => i.totalOrdinal === 5)).toBe(true);
      expect(items.every((i) => i.diaAproximado === null)).toBe(true);
    });

    it('cantidad > 1 con días: el ítem N toma el día N', () => {
      const items = generarChecklist(
        [requisito({ cantidad: 5, diasAproximados: [1, 8, 15, 22, 31] })],
        clienteCorreo,
      );
      expect(items.map((i) => i.diaAproximado)).toEqual([1, 8, 15, 22, 31]);
    });

    it('con días repetidos, cada ocurrencia conserva el suyo', () => {
      const items = generarChecklist(
        [requisito({ cantidad: 3, diasAproximados: [1, 15, 15] })],
        clienteCorreo,
      );
      expect(items.map((i) => i.diaAproximado)).toEqual([1, 15, 15]);
    });

    it('toma los días tal como están guardados: no los reordena', () => {
      const items = generarChecklist(
        [requisito({ cantidad: 2, diasAproximados: [20, 1] })],
        clienteCorreo,
      );
      expect(items.map((i) => i.diaAproximado)).toEqual([20, 1]);
    });
  });

  describe('canal efectivo', () => {
    it('sin override usa el canal del cliente', () => {
      const items = generarChecklist([requisito({ canalEntrega: null })], {
        canalEntrega: 'WHATSAPP',
      });
      expect(items[0]?.canalEntrega).toBe('WHATSAPP');
    });

    it('con override usa el del requisito', () => {
      const items = generarChecklist([requisito({ canalEntrega: 'PORTAL_WEB' })], {
        canalEntrega: 'WHATSAPP',
      });
      expect(items[0]?.canalEntrega).toBe('PORTAL_WEB');
    });

    it('cada requisito resuelve su canal por separado', () => {
      const matriz = [
        requisito({ id: ID_A, nombreTipoDocumento: 'Factura', canalEntrega: null }),
        requisito({ id: ID_B, nombreTipoDocumento: 'Print', canalEntrega: 'CORREO' }),
      ];
      const items = generarChecklist(matriz, { canalEntrega: 'PORTAL_WEB' });
      expect(items.map((i) => i.canalEntrega)).toEqual(['PORTAL_WEB', 'CORREO']);
    });
  });

  describe('snapshot', () => {
    it('copia el nombre del tipo y no copia nota, descripción ni datos del cliente', () => {
      const conExtras = {
        ...requisito({ nombreTipoDocumento: 'Constancia ARCA' }),
        nota: 'Una nota',
        descripcionTipo: 'Una descripción',
      };
      const [item] = generarChecklist([conExtras], {
        canalEntrega: 'CORREO',
        ...{ razonSocial: 'Cliente Ficticio SA' },
      });
      expect(item?.nombreTipoDocumento).toBe('Constancia ARCA');
      expect(Object.keys(item ?? {}).sort()).toEqual([
        'canalEntrega',
        'diaAproximado',
        'nombreTipoDocumento',
        'ordinal',
        'requisitoClienteId',
        'tipoDocumentoId',
        'totalOrdinal',
      ]);
    });
  });

  describe('orden de salida', () => {
    it('por nombre del tipo en español y por ordinal', () => {
      const matriz = [
        requisito({ id: ID_A, nombreTipoDocumento: 'Zeta', cantidad: 2 }),
        requisito({ id: ID_B, nombreTipoDocumento: 'Álbum' }),
        requisito({ id: ID_C, nombreTipoDocumento: 'Banco', cantidad: 2 }),
      ];
      const items = generarChecklist(matriz, clienteCorreo);
      expect(items.map((i) => `${i.nombreTipoDocumento} ${i.ordinal}`)).toEqual([
        'Álbum 1',
        'Banco 1',
        'Banco 2',
        'Zeta 1',
        'Zeta 2',
      ]);
    });

    it('con el mismo nombre, desempata por id del requisito', () => {
      const matriz = [
        requisito({ id: ID_C, tipoDocumentoId: TIPO_3, nombreTipoDocumento: 'Print' }),
        requisito({ id: ID_A, tipoDocumentoId: TIPO_1, nombreTipoDocumento: 'Print' }),
        requisito({ id: ID_B, tipoDocumentoId: TIPO_2, nombreTipoDocumento: 'Print' }),
      ];
      const items = generarChecklist(matriz, clienteCorreo);
      expect(items.map((i) => i.requisitoClienteId)).toEqual([ID_A, ID_B, ID_C]);
    });

    it('no depende del orden en que llega la matriz', () => {
      const matriz = [
        requisito({ id: ID_A, nombreTipoDocumento: 'Zeta' }),
        requisito({ id: ID_B, nombreTipoDocumento: 'Álbum', cantidad: 2 }),
        requisito({ id: ID_C, nombreTipoDocumento: 'Banco' }),
      ];
      expect(generarChecklist([...matriz].reverse(), clienteCorreo)).toEqual(
        generarChecklist(matriz, clienteCorreo),
      );
    });

    it('es determinista: la misma entrada da la misma salida', () => {
      const matriz = [requisito({ cantidad: 3, diasAproximados: [1, 2, 3] })];
      expect(generarChecklist(matriz, clienteCorreo)).toEqual(
        generarChecklist(matriz, clienteCorreo),
      );
    });
  });

  describe('no muta lo que recibe', () => {
    it('ni la matriz ni sus requisitos ni sus días', () => {
      const matriz = congelar([
        requisito({ id: ID_B, nombreTipoDocumento: 'Zeta', cantidad: 2, diasAproximados: [9, 3] }),
        requisito({ id: ID_A, nombreTipoDocumento: 'Álbum' }),
        requisito({ id: ID_C, isDeleted: true }),
      ]);
      const copia = structuredClone(matriz);
      expect(() =>
        generarChecklist(matriz, congelar({ canalEntrega: 'CORREO' as const })),
      ).not.toThrow();
      expect(matriz).toEqual(copia);
    });
  });

  describe('errores defensivos', () => {
    it.each([0, -1, 1.5, NaN, Infinity])('cantidad %j lanza CANTIDAD_INVALIDA', (cantidad) => {
      expect(codigoDelError(() => generarChecklist([requisito({ cantidad })], clienteCorreo))).toBe(
        'CANTIDAD_INVALIDA',
      );
    });

    it.each<[number, number[]]>([
      [3, [1, 2]],
      [1, [1, 2]],
      [2, [5]],
    ])('cantidad %i con días %j lanza DIAS_INCOHERENTES', (cantidad, diasAproximados) => {
      expect(
        codigoDelError(() =>
          generarChecklist([requisito({ cantidad, diasAproximados })], clienteCorreo),
        ),
      ).toBe('DIAS_INCOHERENTES');
    });

    it('un requisito inválido hace fallar todo, aunque los demás estén bien', () => {
      const matriz = [requisito({ id: ID_A }), requisito({ id: ID_B, cantidad: 0 })];
      expect(codigoDelError(() => generarChecklist(matriz, clienteCorreo))).toBe(
        'CANTIDAD_INVALIDA',
      );
    });

    it('el mensaje nombra el tipo de documento', () => {
      expect(() =>
        generarChecklist(
          [requisito({ nombreTipoDocumento: 'Print', cantidad: 3, diasAproximados: [1] })],
          clienteCorreo,
        ),
      ).toThrow(/Print/);
    });
  });
});

describe('ChecklistError', () => {
  it('es un Error con nombre, código y mensaje', () => {
    const e = new ChecklistError('MATRIZ_VACIA', 'Mensaje de prueba');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ChecklistError');
    expect(e.codigo).toBe('MATRIZ_VACIA');
    expect(e.message).toBe('Mensaje de prueba');
  });
});

describe('esChecklistError', () => {
  it('reconoce un ChecklistError', () => {
    expect(esChecklistError(new ChecklistError('CANTIDAD_INVALIDA', 'x'))).toBe(true);
  });

  it('reconoce uno que vino de otra copia del paquete (sin instanceof)', () => {
    const deOtraCopia = Object.assign(new Error('x'), {
      name: 'ChecklistError',
      codigo: 'DIAS_INCOHERENTES',
    });
    expect(deOtraCopia instanceof ChecklistError).toBe(false);
    expect(esChecklistError(deOtraCopia)).toBe(true);
  });

  it.each([
    ['un Error común', new Error('x')],
    ['null', null],
    ['undefined', undefined],
    ['un texto', 'MATRIZ_VACIA'],
    ['un objeto con el código pero sin el nombre', { codigo: 'MATRIZ_VACIA' }],
    ['un objeto con el nombre pero sin código', { name: 'ChecklistError' }],
    ['un código desconocido', { name: 'ChecklistError', codigo: 'OTRO' }],
  ])('rechaza %s', (_descripcion, valor) => {
    expect(esChecklistError(valor)).toBe(false);
  });

  it('estrecha el tipo para leer el código', () => {
    const e: unknown = new ChecklistError('MATRIZ_VACIA', 'x');
    if (esChecklistError(e)) {
      const codigo: 'MATRIZ_VACIA' | 'CANTIDAD_INVALIDA' | 'DIAS_INCOHERENTES' = e.codigo;
      expect(codigo).toBe('MATRIZ_VACIA');
    }
  });
});

describe('calcularFaltantes', () => {
  const item = (id: string, completado: boolean) => ({ id, completado });

  it('una lista vacía: todo en cero', () => {
    expect(calcularFaltantes([])).toEqual({ totalItems: 0, completados: 0, faltantes: [] });
  });

  it('todos completos: no falta ninguno', () => {
    const items = [item('a', true), item('b', true)];
    expect(calcularFaltantes(items)).toEqual({ totalItems: 2, completados: 2, faltantes: [] });
  });

  it('ninguno completo: faltan todos', () => {
    const items = [item('a', false), item('b', false)];
    const r = calcularFaltantes(items);
    expect(r.totalItems).toBe(2);
    expect(r.completados).toBe(0);
    expect(r.faltantes).toEqual(items);
  });

  it('mezcla: cuenta los completados y devuelve los faltantes en el mismo orden', () => {
    const items = [item('a', false), item('b', true), item('c', false), item('d', true)];
    const r = calcularFaltantes(items);
    expect(r.totalItems).toBe(4);
    expect(r.completados).toBe(2);
    expect(r.faltantes.map((i) => i.id)).toEqual(['a', 'c']);
  });

  it('conserva el tipo y las referencias de los ítems', () => {
    const a = { id: 'a', completado: false, nombreTipoDocumento: 'Print' };
    const r = calcularFaltantes([a]);
    expect(r.faltantes[0]).toBe(a);
    expect(r.faltantes[0]?.nombreTipoDocumento).toBe('Print');
  });

  it('no muta la entrada', () => {
    const items = congelar([item('a', false), item('b', true)]);
    const copia = structuredClone(items);
    expect(() => calcularFaltantes(items)).not.toThrow();
    expect(items).toEqual(copia);
  });
});

describe('compararItemsDeChecklist', () => {
  const posicion = (nombreTipoDocumento: string, requisitoClienteId = ID_A, ordinal = 1) => ({
    nombreTipoDocumento,
    requisitoClienteId,
    ordinal,
  });

  it('ordena por nombre en español, sin que mayúsculas ni acentos rompan el orden alfabético', () => {
    const nombres = ['Zeta', 'arco', 'Árbol', 'alfa'].map((nombre) => posicion(nombre));

    expect([...nombres].sort(compararItemsDeChecklist).map((p) => p.nombreTipoDocumento)).toEqual([
      'alfa',
      'Árbol',
      'arco',
      'Zeta',
    ]);
  });

  it('con el mismo nombre desempata por id del requisito y después por ordinal', () => {
    const items = [
      posicion('Print', ID_B, 1),
      posicion('Print', ID_A, 2),
      posicion('Print', ID_A, 1),
    ];

    expect(
      [...items].sort(compararItemsDeChecklist).map((p) => [p.requisitoClienteId, p.ordinal]),
    ).toEqual([
      [ID_A, 1],
      [ID_A, 2],
      [ID_B, 1],
    ]);
  });

  it('es el orden de generarChecklist: ordenar su salida no la cambia', () => {
    const items = generarChecklist(
      [
        requisito({ id: ID_C, tipoDocumentoId: TIPO_1, nombreTipoDocumento: 'Zeta', cantidad: 2 }),
        requisito({ id: ID_B, tipoDocumentoId: TIPO_2, nombreTipoDocumento: 'arco' }),
        requisito({ id: ID_A, tipoDocumentoId: TIPO_3, nombreTipoDocumento: 'Árbol', cantidad: 3 }),
      ],
      clienteCorreo,
    );

    expect([...items].sort(compararItemsDeChecklist)).toEqual(items);
    expect(items.map((item) => item.nombreTipoDocumento)).toEqual([
      'Árbol',
      'Árbol',
      'Árbol',
      'arco',
      'Zeta',
      'Zeta',
    ]);
  });
});
