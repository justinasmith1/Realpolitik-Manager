import { describe, expect, it } from 'vitest';

import { canalDeSeleccion, destinatariosDeCorreo, motivoNoEnviable } from './envio.js';

describe('canalDeSeleccion', () => {
  it('sin ítems, la selección está vacía', () => {
    expect(canalDeSeleccion([])).toEqual({ tipo: 'vacia' });
  });

  it('todos por el mismo canal: ese canal', () => {
    expect(
      canalDeSeleccion([{ canalEntrega: 'PORTAL_WEB' }, { canalEntrega: 'PORTAL_WEB' }]),
    ).toEqual({ tipo: 'un-canal', canal: 'PORTAL_WEB' });
  });

  it('canales distintos: mezclados, cada uno una vez y en el orden del enum', () => {
    expect(
      canalDeSeleccion([
        { canalEntrega: 'WHATSAPP' },
        { canalEntrega: 'CORREO' },
        { canalEntrega: 'WHATSAPP' },
      ]),
    ).toEqual({ tipo: 'mezclados', canales: ['CORREO', 'WHATSAPP'] });
  });

  it('no muta lo que recibe', () => {
    const items = [{ canalEntrega: 'WHATSAPP' as const }, { canalEntrega: 'CORREO' as const }];
    canalDeSeleccion(items);
    expect(items).toEqual([{ canalEntrega: 'WHATSAPP' }, { canalEntrega: 'CORREO' }]);
  });
});

describe('destinatariosDeCorreo', () => {
  const cliente = {
    emailContacto: 'rendiciones@cliente.example',
    emailsAdicionales: ['tesoreria@cliente.example'],
  };
  const contacto = (email: string, recibeRendiciones: boolean, nombre = 'Ana') => ({
    nombre,
    area: 'Compras',
    email,
    recibeRendiciones,
  });

  it('el email del cliente, los adicionales y los contactos que reciben rendiciones, en ese orden', () => {
    expect(destinatariosDeCorreo(cliente, [contacto('ana@cliente.example', true)])).toEqual([
      { email: 'rendiciones@cliente.example', nombre: null, area: null },
      { email: 'tesoreria@cliente.example', nombre: null, area: null },
      { email: 'ana@cliente.example', nombre: 'Ana', area: 'Compras' },
    ]);
  });

  it('los contactos que no reciben rendiciones no entran', () => {
    expect(
      destinatariosDeCorreo(cliente, [contacto('beto@cliente.example', false, 'Beto')]).map(
        (d) => d.email,
      ),
    ).toEqual(['rendiciones@cliente.example', 'tesoreria@cliente.example']);
  });

  it('sin repetidos, sin distinguir mayúsculas; un contacto con el email del cliente le pone nombre', () => {
    expect(
      destinatariosDeCorreo(
        { emailContacto: 'Rendiciones@Cliente.example', emailsAdicionales: [] },
        [contacto('rendiciones@cliente.example', true)],
      ),
    ).toEqual([{ email: 'Rendiciones@Cliente.example', nombre: 'Ana', area: 'Compras' }]);
  });
});

describe('motivoNoEnviable', () => {
  const documento = {
    aplicacionId: 'b1c2d3e4-f5a6-4789-8abc-000000000001',
    documentoId: 'b1c2d3e4-f5a6-4789-8abc-000000000002',
    nombreOriginal: 'print.pdf',
    tipoContenido: 'application/pdf',
    tamanioBytes: 10,
    aplicadaEn: new Date('2026-10-01T12:00:00.000Z'),
  };

  it('un ítem completado con documento vigente se puede enviar', () => {
    expect(motivoNoEnviable({ completado: true, documento })).toBeNull();
  });

  it('un ítem pendiente no se puede enviar', () => {
    expect(motivoNoEnviable({ completado: false, documento: null })).toBe('ITEM_PENDIENTE');
  });

  it('no alcanza con completado: sin documento vigente (o sin saberlo) no se envía', () => {
    expect(motivoNoEnviable({ completado: true, documento: null })).toBe(
      'ITEM_SIN_DOCUMENTO_VIGENTE',
    );
    expect(motivoNoEnviable({ completado: true })).toBe('ITEM_SIN_DOCUMENTO_VIGENTE');
  });
});
