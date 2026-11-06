import type { RendicionDelMes } from '@realpolitik/shared';

import {
  claveDeTipoDeCliente,
  etiquetaDeTipoDeCliente,
  tipoDeCliente,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import {
  coincideConLaBusqueda,
  contarPorEstado,
  filtrarRendicionesDelMes,
  tiposPresentes,
} from '@/modules/rendiciones/rendicionesDelMes.filtros';

// Filtros de la pantalla Rendiciones (HU3.3), sobre el listado del mes.

let siguienteId = 0;
function fila(cambios: Partial<RendicionDelMes> = {}): RendicionDelMes {
  siguienteId += 1;
  return {
    id: `e1f2a3b4-c5d6-4789-8abc-${String(siguienteId).padStart(12, '0')}`,
    clienteId: 'a1b2c3d4-e5f6-4789-abcd-ef0123456789',
    cliente: { denominacion: 'Grupo Solano', sector: 'PRIVADO', subtipo: null },
    numeroFactura: 'B 00002-00001482',
    estado: 'EN_CURSO',
    avance: { reunidos: 1, total: 2, faltantes: 1 },
    ultimoPaso: null,
    ...cambios,
  };
}

const MUNI = {
  denominacion: 'Municipalidad de Córdoba',
  sector: 'PUBLICO',
  subtipo: 'MUNICIPAL',
} as const;
const SINDICATO = {
  denominacion: 'STM Córdoba',
  sector: 'PUBLICO',
  subtipo: 'SINDICAL_OBRA_SOCIAL',
} as const;
const SIN_FILTROS = { estado: undefined, tipo: undefined, q: undefined };

describe('tipo de cliente', () => {
  it('es el subtipo de un público; sin subtipo, o privado, el sector', () => {
    expect(claveDeTipoDeCliente({ sector: 'PUBLICO', subtipo: 'MUNICIPAL' })).toBe('MUNICIPAL');
    expect(claveDeTipoDeCliente({ sector: 'PUBLICO', subtipo: null })).toBe('PUBLICO');
    expect(claveDeTipoDeCliente({ sector: 'PRIVADO', subtipo: null })).toBe('PRIVADO');
  });

  it('la etiqueta del chip es la misma que muestra la fila', () => {
    for (const cliente of [MUNI, SINDICATO, { sector: 'PRIVADO', subtipo: null }] as const) {
      expect(etiquetaDeTipoDeCliente(claveDeTipoDeCliente(cliente))).toBe(tipoDeCliente(cliente));
    }
  });
});

describe('contarPorEstado', () => {
  it('cuenta cada estado, con cero en los que no hay', () => {
    const rendiciones = [
      fila({ estado: 'EN_CURSO' }),
      fila({ estado: 'EN_CURSO' }),
      fila({ estado: 'ENVIADA' }),
      fila({ estado: 'RECHAZADA' }),
    ];

    expect(contarPorEstado(rendiciones)).toEqual({
      EN_CURSO: 2,
      COMPLETA: 0,
      ENVIADA: 1,
      APROBADA: 0,
      RECHAZADA: 1,
    });
  });
});

describe('tiposPresentes', () => {
  it('solo los tipos del mes, sin repetir y en el orden de los chips', () => {
    const rendiciones = [
      fila(),
      fila({ cliente: SINDICATO }),
      fila({ cliente: MUNI }),
      fila({ cliente: SINDICATO }),
    ];

    expect(tiposPresentes(rendiciones)).toEqual(['MUNICIPAL', 'SINDICAL_OBRA_SOCIAL', 'PRIVADO']);
  });

  it('sin rendiciones, ninguno', () => {
    expect(tiposPresentes([])).toEqual([]);
  });
});

describe('coincideConLaBusqueda', () => {
  const muni = fila({
    cliente: MUNI,
    numeroFactura: 'B 00002-00001482',
  });

  it.each(['córdoba', 'CORDOBA', 'cordoba', 'Municipalidad  de', ' muni '])(
    'por el nombre, sin distinguir mayúsculas ni acentos: "%s"',
    (q) => {
      expect(coincideConLaBusqueda(muni, q)).toBe(true);
    },
  );

  it.each(['0000148', '00002-00001482', '0000200001482', 'B 00002-00001482', 'b00002', 'b 00002'])(
    'por la factura, con o sin guiones, espacios o la letra B: "%s"',
    (q) => {
      expect(coincideConLaBusqueda(muni, q)).toBe(true);
    },
  );

  it.each(['rosario', '00001483', 'C 00002'])('no coincide: "%s"', (q) => {
    expect(coincideConLaBusqueda(muni, q)).toBe(false);
  });

  it('sin texto, o solo espacios, coinciden todas', () => {
    expect(coincideConLaBusqueda(muni, '')).toBe(true);
    expect(coincideConLaBusqueda(muni, '   ')).toBe(true);
  });
});

describe('filtrarRendicionesDelMes', () => {
  const enCursoPrivada = fila({ estado: 'EN_CURSO' });
  const enviadaPrivada = fila({ estado: 'ENVIADA', numeroFactura: 'B 00002-00001490' });
  const enCursoMuni = fila({
    estado: 'EN_CURSO',
    cliente: MUNI,
    numeroFactura: 'B 00002-00001477',
  });
  const todas = [enCursoPrivada, enviadaPrivada, enCursoMuni];

  it('sin filtros, todas y en el mismo orden', () => {
    expect(filtrarRendicionesDelMes(todas, SIN_FILTROS)).toEqual(todas);
  });

  it('por estado', () => {
    expect(filtrarRendicionesDelMes(todas, { ...SIN_FILTROS, estado: 'EN_CURSO' })).toEqual([
      enCursoPrivada,
      enCursoMuni,
    ]);
  });

  it('estado y tipo a la vez: solo las que cumplen los dos', () => {
    expect(
      filtrarRendicionesDelMes(todas, { ...SIN_FILTROS, estado: 'EN_CURSO', tipo: 'PRIVADO' }),
    ).toEqual([enCursoPrivada]);
  });

  it('los tres a la vez', () => {
    expect(
      filtrarRendicionesDelMes(todas, { estado: 'EN_CURSO', tipo: 'PRIVADO', q: '1490' }),
    ).toEqual([]);
    expect(
      filtrarRendicionesDelMes(todas, { estado: 'ENVIADA', tipo: 'PRIVADO', q: '1490' }),
    ).toEqual([enviadaPrivada]);
  });
});
