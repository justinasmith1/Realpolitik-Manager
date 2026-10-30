import { describe, expect, it } from 'vitest';

import {
  esErrorAlmacenamiento,
  generarClaveDocumento,
  type ClaveAlmacenamiento,
} from '../almacenamiento';
import { AlmacenamientoEnMemoria } from '../memoria';

import { codigoDeError, probarContratoDeAlmacenamiento } from './contratoAlmacenamiento';

describe('AlmacenamientoEnMemoria', () => {
  probarContratoDeAlmacenamiento(() => new AlmacenamientoEnMemoria());

  const objeto = () => ({
    clave: generarClaveDocumento(),
    contenido: Buffer.from('x'),
    tipoContenido: 'image/png',
  });

  describe('fallas simuladas (para probar compensaciones)', () => {
    it('una falla en guardar es NO_DISPONIBLE, con causa, y no guarda nada', async () => {
      const almacenamiento = new AlmacenamientoEnMemoria();
      almacenamiento.fallarLaProxima('guardar');

      const intento = almacenamiento.guardar(objeto());

      await expect(intento).rejects.toSatisfy(
        (error: unknown) =>
          esErrorAlmacenamiento(error, 'NO_DISPONIBLE') && error.cause instanceof Error,
      );
      expect(almacenamiento.cantidad).toBe(0);
    });

    it('falla solo la próxima llamada: la siguiente funciona', async () => {
      const almacenamiento = new AlmacenamientoEnMemoria();
      almacenamiento.fallarLaProxima('guardar');

      await expect(almacenamiento.guardar(objeto())).rejects.toThrow();
      await almacenamiento.guardar(objeto());

      expect(almacenamiento.cantidad).toBe(1);
    });

    it.each(['obtener', 'existe', 'eliminar'] as const)(
      'simula una falla en %s',
      async (operacion) => {
        const almacenamiento = new AlmacenamientoEnMemoria();
        const guardado = objeto();
        await almacenamiento.guardar(guardado);
        almacenamiento.fallarLaProxima(operacion);

        expect(await codigoDeError(almacenamiento[operacion](guardado.clave))).toBe(
          'NO_DISPONIBLE',
        );
        expect(almacenamiento.cantidad).toBe(1);
      },
    );

    it('una clave inválida no consume la falla programada', async () => {
      const almacenamiento = new AlmacenamientoEnMemoria();
      almacenamiento.fallarLaProxima('existe');

      expect(await codigoDeError(almacenamiento.existe('x' as ClaveAlmacenamiento))).toBe(
        'CLAVE_INVALIDA',
      );
      expect(await codigoDeError(almacenamiento.existe(generarClaveDocumento()))).toBe(
        'NO_DISPONIBLE',
      );
    });
  });
});
