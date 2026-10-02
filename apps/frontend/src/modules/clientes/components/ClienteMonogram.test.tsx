import { render, screen } from '@testing-library/react';

import { ClienteMonogram } from '@/modules/clientes/components/ClienteMonogram';

describe('ClienteMonogram', () => {
  it.each([
    ['las iniciales de las dos primeras palabras', 'Banco Provincia', 'BP'],
    ['sin contar los conectores', 'Municipalidad de La Plata', 'MP'],
    ['sin importar mayúsculas en los conectores', 'La Plata Cooperativa', 'PC'],
    ['las dos primeras letras si es una sola palabra', 'YPF', 'YP'],
    ['la única letra si la palabra tiene una', 'x', 'X'],
    ['ignorando espacios repetidos y de los bordes', '  Cooperativa    Abasto   Norte  ', 'CA'],
    ['con letras acentuadas y eñe', 'Ñandú Ángeles', 'ÑÁ'],
    ['saltando números y símbolos', 'Club 9 de Julio', 'CJ'],
    ['ignorando lo que sigue a la segunda palabra', 'Banco Provincia — Sucursal 12', 'BP'],
  ])('muestra %s', (_regla, nombre, esperado) => {
    render(<ClienteMonogram nombre={nombre} />);

    expect(screen.getByText(esperado)).toBeInTheDocument();
  });

  it.each([
    ['vacío', ''],
    ['solo espacios', '   '],
    ['sin ninguna palabra que empiece con letra', '— 12'],
    ['solo conectores', 'de la'],
  ])('muestra "?" cuando el nombre está %s', (_caso, nombre) => {
    render(<ClienteMonogram nombre={nombre} />);

    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('es decorativo: se oculta a las tecnologías de asistencia', () => {
    render(<ClienteMonogram nombre="Banco Provincia" />);

    expect(screen.getByText('BP')).toHaveAttribute('aria-hidden', 'true');
  });
});
