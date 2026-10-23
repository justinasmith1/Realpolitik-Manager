import type { RequisitoCliente } from '@realpolitik/shared';

import {
  cambiosDeRequisito,
  cuerpoDeAlta,
  diasTrasCambiarCantidad,
  hayCambios,
  indicarDias,
  incompatibilidadDeDias,
  mensajeDeDia,
  quitarDiasSobrantes,
  requisitoAValoresForm,
  validarRequisito,
  valoresEquivalentes,
  valoresInicialesAlta,
  type RequisitoFormValues,
} from '@/modules/clientes/components/requisitoForm.validation';

const TIPO = '33333333-3333-4333-a333-333333333333';
const CLIENTE = '11111111-1111-4111-a111-111111111111';
const REQ = '55555555-5555-4555-a555-555555555555';

const LISTA_A_MEDIAS = 'Completá cada día o limpiá todos. Una lista a medias no se guarda.';
const DIA_VACIO = 'Completá este día.';

function requisito(parcial: Partial<RequisitoCliente> = {}): RequisitoCliente {
  return {
    id: REQ,
    clienteId: CLIENTE,
    tipoDocumento: { id: TIPO, nombre: 'Acta', activo: true },
    cantidad: 3,
    diasAproximados: [1, 8, 15],
    canalEntrega: null,
    nota: null,
    creadoEn: new Date('2026-10-08T12:00:00.000Z'),
    actualizadoEn: new Date('2026-10-08T12:00:00.000Z'),
    ...parcial,
  };
}

function alta(parcial: Partial<RequisitoFormValues> = {}): RequisitoFormValues {
  return { ...valoresInicialesAlta, tipoDocumentoId: TIPO, ...parcial };
}

describe('cantidad', () => {
  it('acepta un entero entre 1 y 100 y rechaza vacío, texto, cero y el tope', () => {
    expect(validarRequisito(alta({ cantidad: '1' }), true).ok).toBe(true);
    expect(validarRequisito(alta({ cantidad: '100' }), true).ok).toBe(true);

    const vacia = validarRequisito(alta({ cantidad: '  ' }), true);
    const texto = validarRequisito(alta({ cantidad: '3a' }), true);
    const cero = validarRequisito(alta({ cantidad: '0' }), true);
    const tope = validarRequisito(alta({ cantidad: '101' }), true);
    expect(vacia.ok).toBe(false);
    expect(texto.ok).toBe(false);
    expect(cero.ok).toBe(false);
    expect(tope.ok).toBe(false);
    if (!vacia.ok) expect(vacia.errores.cantidad?.message).toBe('Ingresá la cantidad.');
    if (!texto.ok) expect(texto.errores.cantidad?.message).toContain('entre 1 y 100');
    if (!cero.ok) expect(cero.errores.cantidad?.message).toBe('La cantidad debe ser al menos 1.');
    if (!tope.ok) expect(tope.errores.cantidad?.message).toBe('La cantidad no puede superar 100.');
  });
});

describe('días', () => {
  it('una lista vacía es válida y no se marca al empezar a indicarla', () => {
    const resultado = validarRequisito(alta({ cantidad: '2', dias: [] }), true);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.datos.diasAproximados).toEqual([]);
    expect(incompatibilidadDeDias({ cantidad: '2', dias: ['', ''] }, false)).toBeNull();
    expect(incompatibilidadDeDias({ cantidad: '2', dias: ['', ''] }, true)).toBe(LISTA_A_MEDIAS);
  });

  it('exige un día por documento, admite repetidos y los deja ordenados', () => {
    const resultado = validarRequisito(alta({ cantidad: '3', dias: ['15', '1', '15'] }), true);
    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.datos.diasAproximados).toEqual([1, 15, 15]);
  });

  it('una lista a medias no se manda, aunque descartar los vacíos la dejaría válida', () => {
    const resultado = validarRequisito(alta({ cantidad: '1', dias: ['5', ''] }), true);
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) {
      expect(resultado.errores.dias?.message).toContain('1 día aproximado');
    }

    const aMedias = validarRequisito(alta({ cantidad: '2', dias: ['8', ''] }), true);
    expect(aMedias.ok).toBe(false);
    if (!aMedias.ok) {
      const dias = aMedias.errores.dias as { message?: string; 1?: { message?: string } };
      expect(dias.message).toBe(LISTA_A_MEDIAS);
      expect(dias[1]?.message).toBe(DIA_VACIO);
    }
  });

  it('un día fuera de rango se marca en su casillero y el vacío no es un error de rango', () => {
    expect(mensajeDeDia('')).toBeNull();
    expect(mensajeDeDia('0')).toBe('Cada día aproximado debe ser un número entero entre 1 y 31.');
    expect(mensajeDeDia('32')).toBe('Cada día aproximado debe ser un número entero entre 1 y 31.');
    expect(mensajeDeDia('15')).toBeNull();
  });

  it('bajar la cantidad no borra días; quitarlos es explícito', () => {
    const dias = ['15', '1', '8'];
    expect(diasTrasCambiarCantidad(dias, '1')).toEqual(dias);
    expect(quitarDiasSobrantes(dias, '1')).toEqual(['15']);
    expect(indicarDias('2')).toEqual(['', '']);
    expect(diasTrasCambiarCantidad(['4'], '3')).toEqual(['4', '', '']);
    expect(diasTrasCambiarCantidad([], '3')).toEqual([]);
  });
});

describe('nota y canal', () => {
  it('la nota vacía viaja como null y rechaza el largo y los caracteres de control', () => {
    const vacia = validarRequisito(alta({ nota: '   ' }), true);
    expect(vacia.ok).toBe(true);
    if (vacia.ok) expect(vacia.datos.nota).toBeNull();

    const larga = validarRequisito(alta({ nota: 'a'.repeat(501) }), true);
    const salto = validarRequisito(alta({ nota: 'linea\nuna' }), true);
    expect(larga.ok).toBe(false);
    expect(salto.ok).toBe(false);
    if (!larga.ok) {
      expect(larga.errores.nota?.message).toBe('La nota no puede superar los 500 caracteres.');
    }
    if (!salto.ok) {
      expect(salto.errores.nota?.message).toBe('La nota no puede contener caracteres de control.');
    }
  });

  it('el canal vacío es el del cliente y uno propio se conserva', () => {
    const heredado = validarRequisito(alta({ canal: '' }), true);
    const propio = validarRequisito(alta({ canal: 'PORTAL_WEB' }), true);
    expect(heredado.ok && heredado.datos.canalEntrega).toBeNull();
    expect(propio.ok && propio.datos.canalEntrega).toBe('PORTAL_WEB');
  });
});

describe('alta y edición parcial', () => {
  it('el alta manda el cuerpo normalizado, con null donde no hay canal ni nota', () => {
    const resultado = validarRequisito(alta({ cantidad: '1', dias: [], nota: '  Aviso  ' }), true);
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(cuerpoDeAlta(resultado.datos)).toEqual({
      tipoDocumentoId: TIPO,
      cantidad: 1,
      diasAproximados: [],
      canalEntrega: null,
      nota: 'Aviso',
    });
  });

  it('sin tipo en el alta no valida; en la edición no vuelve a pedir que se elija', () => {
    const sinTipo = validarRequisito(alta({ tipoDocumentoId: '' }), true);
    expect(sinTipo.ok).toBe(false);
    if (!sinTipo.ok) {
      expect(sinTipo.errores.tipoDocumentoId?.message).toBe('Elegí el tipo de documento.');
    }

    const edicion = validarRequisito(requisitoAValoresForm(requisito()), false);
    expect(edicion.ok).toBe(true);
    if (!edicion.ok) return;
    expect(edicion.datos.tipoDocumentoId).toBe(TIPO);
  });

  it('el PATCH lleva solo lo cambiado, y un pedido vacío no se arma', () => {
    const guardado = requisito({ nota: 'Antes', canalEntrega: 'WHATSAPP' });
    const igual = validarRequisito(requisitoAValoresForm(guardado), false);
    expect(igual.ok).toBe(true);
    if (!igual.ok) return;
    expect(cambiosDeRequisito(igual.datos, guardado)).toEqual({});
    expect(hayCambios({})).toBe(false);

    const soloNota = validarRequisito({ ...requisitoAValoresForm(guardado), nota: '' }, false);
    expect(soloNota.ok).toBe(true);
    if (soloNota.ok) expect(cambiosDeRequisito(soloNota.datos, guardado)).toEqual({ nota: null });

    const soloCanal = validarRequisito({ ...requisitoAValoresForm(guardado), canal: '' }, false);
    expect(soloCanal.ok).toBe(true);
    if (soloCanal.ok) {
      expect(cambiosDeRequisito(soloCanal.datos, guardado)).toEqual({ canalEntrega: null });
    }
  });

  it('reordenar los días no es un cambio, aunque estén desordenados en lo guardado', () => {
    const guardado = requisito({ diasAproximados: [15, 1, 8] });
    const valores = requisitoAValoresForm(guardado);
    expect(valoresEquivalentes(valores, { ...valores, dias: ['1', '8', '15'] })).toBe(true);
    const normalizado = validarRequisito(valores, false);
    expect(normalizado.ok).toBe(true);
    if (normalizado.ok) expect(cambiosDeRequisito(normalizado.datos, guardado)).toEqual({});
  });
});
