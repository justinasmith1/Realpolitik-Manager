import { mesActual } from '@realpolitik/shared';
import { describe, expect, it } from 'vitest';

import {
  abrirRendicionResolver,
  type AbrirRendicionFormValues,
} from '@/modules/rendiciones/components/abrirRendicionForm.validation';
import { MENSAJE_EMISOR_OBLIGATORIO } from '@/modules/rendiciones/rendiciones.etiquetas';

// El resolver valida con `AbrirRendicionFormSchema` de shared: el emisor es obligatorio en el
// formulario, aunque en el pedido sea opcional.

const { anio, mes } = mesActual(new Date());
const VALORES: AbrirRendicionFormValues = {
  mes: String(mes),
  anio: String(anio),
  emisor: 'SOCIEDAD',
  numeroFactura: 'b 2-1482',
};
const sinContexto = {
  criteriaMode: 'firstError',
  fields: {},
  shouldUseNativeValidation: false,
} as const;

describe('abrirRendicionResolver', () => {
  it('sin emisor, marca el campo con el mismo mensaje de siempre', async () => {
    const resultado = await abrirRendicionResolver(
      { ...VALORES, emisor: '' },
      undefined,
      sinContexto,
    );

    expect(resultado.errors.emisor?.message).toBe(MENSAJE_EMISOR_OBLIGATORIO);
    expect(MENSAJE_EMISOR_OBLIGATORIO).toBe('Elegí el emisor de la factura.');
    expect(resultado.values).toEqual({});
  });

  it('sin emisor y con una factura inválida, marca los dos campos a la vez', async () => {
    const resultado = await abrirRendicionResolver(
      { ...VALORES, emisor: '', numeroFactura: 'FC-1' },
      undefined,
      sinContexto,
    );

    expect(Object.keys(resultado.errors).sort()).toEqual(['emisor', 'numeroFactura']);
  });

  it('con todo válido, entrega los datos normalizados con el emisor', async () => {
    const resultado = await abrirRendicionResolver(VALORES, undefined, sinContexto);

    expect(resultado.errors).toEqual({});
    expect(resultado.values).toEqual({
      anio,
      mes,
      numeroFactura: 'B 00002-00001482',
      emisor: 'SOCIEDAD',
    });
  });
});
