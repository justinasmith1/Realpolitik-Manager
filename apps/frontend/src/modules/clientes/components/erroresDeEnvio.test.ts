import { erroresParaElFormulario } from '@/modules/clientes/components/erroresDeEnvio';

const INESPERADO = 'No pudimos guardar los cambios. Probá de nuevo en unos segundos.';

const invalidos = (...detalles: [campo: string, mensaje: string | null][]) =>
  erroresParaElFormulario(
    {
      tipo: 'datos-invalidos',
      detalles: detalles.map(([campo, mensaje]) => ({ campo, mensaje })),
    },
    INESPERADO,
  );

describe('erroresParaElFormulario: datos inválidos del servidor', () => {
  it.each([
    ['canalEntrega', 'canalEntrega'],
    ['portalUrl', 'portalUrl'],
    ['whatsappNumero', 'whatsappNumero'],
    ['emailContacto', 'emailContacto'],
    ['razonSocial', 'razonSocial'],
    ['denominacion', 'denominacion'],
    ['cuit', 'cuit'],
    ['ivaCondicion', 'ivaCondicion'],
    ['sector', 'sector'],
    ['subtipo', 'subtipo'],
    ['periodicidad', 'periodicidadTipo'],
    ['periodicidad.tipo', 'periodicidadTipo'],
    ['periodicidad.diaLimite', 'periodicidadDiaLimite'],
    ['periodicidad.mesInicioCiclo', 'periodicidadMesInicioCiclo'],
  ])('el error de "%s" va al campo "%s" con el mensaje del servidor', (campoApi, campoForm) => {
    const errores = invalidos([campoApi, 'Mensaje del servidor.']);

    expect(errores.campos).toEqual({ [campoForm]: 'Mensaje del servidor.' });
    expect(errores.general).toBe('Algunos datos no son válidos. Revisá los campos marcados.');
  });

  it('muestra el texto que el servidor da para portalUrl, canal y WhatsApp', () => {
    const errores = invalidos(
      ['portalUrl', 'La URL del portal no puede incluir usuario ni contraseña.'],
      ['canalEntrega', 'Si el canal de entrega es Portal web, ingresá la URL del portal.'],
      ['whatsappNumero', 'Para cargar el número, el canal tiene que ser WhatsApp.'],
    );

    expect(errores.campos).toEqual({
      portalUrl: 'La URL del portal no puede incluir usuario ni contraseña.',
      canalEntrega: 'Si el canal de entrega es Portal web, ingresá la URL del portal.',
      whatsappNumero: 'Para cargar el número, el canal tiene que ser WhatsApp.',
    });
  });

  it('muestra el texto del servidor para sector y subtipo', () => {
    const errores = invalidos(['subtipo', 'Los clientes privados no tienen subtipo.']);

    expect(errores.campos).toEqual({ subtipo: 'Los clientes privados no tienen subtipo.' });
  });

  it.each([
    'Required',
    'Expected string, received number',
    'Invalid enum value. Expected a | b, received c',
    'Invalid input',
    'String must contain at most 5 character(s)',
    'Number must be less than or equal to 28',
    'Unrecognized key(s) in object: x',
  ])('no muestra el mensaje por defecto de Zod en inglés (%s)', (mensaje) => {
    const errores = invalidos(['cuit', mensaje]);

    expect(errores.campos).toEqual({ cuit: 'Revisá este dato.' });
  });

  it('sin mensaje del servidor, usa el aviso genérico del campo', () => {
    expect(invalidos(['portalUrl', null]).campos).toEqual({ portalUrl: 'Revisá este dato.' });
    expect(invalidos(['portalUrl', '   ']).campos).toEqual({ portalUrl: 'Revisá este dato.' });
  });

  it('con varios errores en un campo, conserva el primero', () => {
    const errores = invalidos(['portalUrl', 'Primero.'], ['portalUrl', 'Segundo.']);

    expect(errores.campos).toEqual({ portalUrl: 'Primero.' });
  });

  it('los datos que el formulario no tiene van al aviso general, con el texto del servidor', () => {
    const telefono = invalidos(['telefono', 'El teléfono no tiene un formato válido.']);
    expect(telefono.campos).toEqual({});
    expect(telefono.general).toBe('El teléfono no tiene un formato válido.');

    const adicionales = invalidos(['emailsAdicionales.1', 'Este email adicional está repetido.']);
    expect(adicionales.campos).toEqual({});
    expect(adicionales.general).toBe('Este email adicional está repetido.');
  });

  it('junta los campos marcados con el aviso de lo que no tiene campo', () => {
    const errores = invalidos(
      ['portalUrl', 'La URL del portal no puede incluir usuario ni contraseña.'],
      ['telefono', 'El teléfono no tiene un formato válido.'],
    );

    expect(errores.campos).toEqual({
      portalUrl: 'La URL del portal no puede incluir usuario ni contraseña.',
    });
    expect(errores.general).toBe(
      'Algunos datos no son válidos. Revisá los campos marcados. El teléfono no tiene un formato válido.',
    );
  });

  it('un dato sin campo y sin texto útil usa un aviso general, no uno que mande a campos marcados', () => {
    const errores = invalidos(['emailsAdicionales', 'Required'], ['campoDesconocido', null]);

    expect(errores.campos).toEqual({});
    expect(errores.general).toBe('Algunos datos no son válidos. Revisá los datos ingresados.');
  });

  it('un 400 sin detalles usa el aviso general', () => {
    const errores = invalidos();

    expect(errores.campos).toEqual({});
    expect(errores.general).toBe('Algunos datos no son válidos. Revisá los datos ingresados.');
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'no confunde "%s" con un campo del formulario',
    (campo) => {
      expect(invalidos([campo, 'Mensaje.']).campos).toEqual({});
    },
  );
});

describe('erroresParaElFormulario: otros fallos', () => {
  it('un CUIT duplicado marca el CUIT con el cliente que lo tiene', () => {
    const errores = erroresParaElFormulario(
      {
        tipo: 'cuit-duplicado',
        clienteExistente: { id: 'x', razonSocial: 'Cliente S.A.', estado: 'INACTIVO' },
      },
      INESPERADO,
    );

    expect(errores).toEqual({
      campos: { cuit: 'Ya existe un cliente registrado con este CUIT: Cliente S.A. (inactivo).' },
    });
  });

  it('un fallo inesperado da el mensaje que se le pasó', () => {
    expect(erroresParaElFormulario({ tipo: 'inesperado' }, INESPERADO)).toEqual({
      general: INESPERADO,
    });
  });
});
