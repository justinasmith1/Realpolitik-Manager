import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';

import { AplicarDocumentoAsistente } from '@/modules/documentos/components/AplicarDocumentoAsistente';

// El asistente "Cargar y aplicar un documento" no puede quedar comprimido: el ancho lo fija
// `SheetContent` (`w-3/4`, tope `sm:max-w-sm` de 24rem) y el asistente tiene que pisarlo. jsdom no
// calcula el layout, así que se comprueban las clases que deciden el ancho y el texto de los pasos.

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockResolvedValue(
    new Response('[]', { headers: { 'Content-Type': 'application/json' } }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderAsistente() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AplicarDocumentoAsistente
        abierto
        documentoInicial={null}
        periodoInicial={{ anio: 2026, mes: 10 }}
        onTerminar={() => undefined}
      />
    </QueryClientProvider>,
  );
  return screen.findByRole('dialog', { name: 'Cargar y aplicar un documento' });
}

describe('AplicarDocumentoAsistente: ancho', () => {
  it('ocupa todo el ancho en pantallas chicas y la mitad de la ventana desde md, sin el tope del Sheet', async () => {
    const asistente = await renderAsistente();

    expect(asistente).toHaveClass(
      'data-[side=right]:w-full',
      'data-[side=right]:sm:max-w-none',
      'md:data-[side=right]:w-[max(50vw,42rem)]',
    );
    // Los anchos de `SheetContent` que lo dejaban en 24rem no quedan en el elemento.
    expect(asistente).not.toHaveClass('data-[side=right]:sm:max-w-sm');
    expect(asistente).not.toHaveClass('data-[side=right]:w-3/4');
  });

  it('el indicador muestra los tres pasos completos, "Confirmar" incluido, sin scroll horizontal', async () => {
    const asistente = await renderAsistente();

    const indicador = within(asistente).getByRole('list', { name: 'Pasos' });
    const pasos = within(indicador).getAllByRole('listitem');
    expect(pasos.map((paso) => paso.textContent)).toEqual([
      '1Archivo y tipo',
      '2Dónde aplica',
      '3Confirmar',
    ]);
    expect(within(indicador).getByText('Confirmar')).toBeVisible();
    // Si no entran en una línea, pasan a la siguiente: nunca un scroll que corte un paso.
    expect(indicador).toHaveClass('flex-wrap');
    expect(indicador).not.toHaveClass('overflow-x-auto');
  });
});
