import {
  erroresParaElFormulario,
  mensajeClienteNoActivo,
  mensajeDuplicado,
  mensajeFalloBaja,
  MENSAJE_NO_EXISTE,
} from '@/modules/clientes/components/erroresDeRequisito';

const INESPERADO = 'No pudimos guardar el requisito. Probá de nuevo en unos segundos.';

describe('mensajes de dominio', () => {
  it('describe el estado del cliente sin tratar a uno activo como si se conociera', () => {
    expect(mensajeClienteNoActivo('INACTIVO')).toBe(
      'Este cliente está inactivo. Ya no se pueden modificar sus requisitos.',
    );
    expect(mensajeClienteNoActivo('SUSPENDIDO')).toBe(
      'Este cliente está suspendido. Ya no se pueden modificar sus requisitos.',
    );
    expect(mensajeClienteNoActivo(null)).toBe(
      'Este cliente ya no está activo. No se pueden modificar sus requisitos.',
    );
    expect(mensajeClienteNoActivo('ACTIVO')).toBe(
      'Este cliente ya no está activo. No se pueden modificar sus requisitos.',
    );
  });

  it('el duplicado nombra la cantidad cuando el servidor la manda', () => {
    expect(mensajeDuplicado(null)).toBe(
      'Este cliente ya tiene un requisito activo para ese tipo de documento.',
    );
    expect(mensajeDuplicado({ id: 'a', tipoDocumentoId: 'b', cantidad: 3 })).toBe(
      'Este cliente ya tiene un requisito activo para ese tipo (cantidad 3).',
    );
  });
});

describe('erroresParaElFormulario', () => {
  it('el duplicado queda en el tipo y no bloquea un reintento con otro', () => {
    expect(
      erroresParaElFormulario(
        {
          tipo: 'requisito-duplicado',
          requisitoExistente: { id: 'a', tipoDocumentoId: 'b', cantidad: 4 },
        },
        INESPERADO,
      ),
    ).toEqual({
      campos: {
        tipoDocumentoId: 'Este cliente ya tiene un requisito activo para ese tipo (cantidad 4).',
      },
    });
  });

  it('un cliente que dejó de estar activo es un aviso y bloquea el envío', () => {
    expect(
      erroresParaElFormulario({ tipo: 'cliente-no-activo', estado: 'SUSPENDIDO' }, INESPERADO),
    ).toEqual({
      aviso: 'Este cliente está suspendido. Ya no se pueden modificar sus requisitos.',
      bloqueaEnvio: true,
    });
  });

  it('un 404 no dice qué recurso falta', () => {
    expect(erroresParaElFormulario({ tipo: 'no-existe' }, INESPERADO)).toEqual({
      general: MENSAJE_NO_EXISTE,
      bloqueaEnvio: true,
    });
    expect(MENSAJE_NO_EXISTE).toBe('Este recurso ya no está disponible.');
  });

  it('ubica los campos del contrato, también un día por índice', () => {
    const errores = erroresParaElFormulario(
      {
        tipo: 'datos-invalidos',
        detalles: [
          {
            campo: 'canalEntrega',
            mensaje: 'El canal de entrega debe ser CORREO, PORTAL_WEB o WHATSAPP.',
          },
          {
            campo: 'diasAproximados.1',
            mensaje: 'Cada día aproximado debe ser un número entero entre 1 y 31.',
          },
          { campo: 'nota', mensaje: 'Required' },
        ],
      },
      INESPERADO,
    );

    expect(errores.campos).toEqual({
      canal: 'El canal de entrega debe ser CORREO, PORTAL_WEB o WHATSAPP.',
      nota: 'Revisá este dato.',
    });
    expect(errores.diasPorIndice).toEqual({
      1: 'Cada día aproximado debe ser un número entero entre 1 y 31.',
    });
    expect(errores.general).toBe('Algunos datos no son válidos. Revisá los campos marcados.');
  });

  it('un fallo de red usa el texto de reintento y no bloquea', () => {
    expect(erroresParaElFormulario({ tipo: 'inesperado' }, INESPERADO)).toEqual({
      general: INESPERADO,
    });
  });
});

describe('mensajeFalloBaja', () => {
  it('cierra el diálogo si el recurso o el cliente ya no permiten reintentar', () => {
    expect(mensajeFalloBaja({ tipo: 'no-existe' })).toEqual({
      texto: MENSAJE_NO_EXISTE,
      cierra: true,
    });
    expect(mensajeFalloBaja({ tipo: 'cliente-no-activo', estado: 'INACTIVO' }).cierra).toBe(true);
  });

  it('deja el diálogo abierto si se puede volver a intentar', () => {
    expect(mensajeFalloBaja({ tipo: 'inesperado' })).toEqual({
      texto: 'No pudimos quitar el requisito. Probá de nuevo en unos segundos.',
      cierra: false,
    });
    expect(
      mensajeFalloBaja({
        tipo: 'requisito-duplicado',
        requisitoExistente: null,
      }).cierra,
    ).toBe(false);
  });
});
