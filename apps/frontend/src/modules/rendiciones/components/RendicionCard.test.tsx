import { Emisor, RendicionResumenSchema } from '@realpolitik/shared';
import { screen, waitFor, within } from '@testing-library/react';

import { etiquetasEmisor } from '@/modules/clientes/clientes.etiquetas';
import { RendicionCard } from '@/modules/rendiciones/components/RendicionCard';
import { TEXTO_SIN_EMISOR } from '@/modules/rendiciones/rendiciones.etiquetas';
import { renderEnMatriz } from '@/modules/rendiciones/test/renderConRouter';
import {
  CLIENTE_ID,
  errorJson,
  json,
  RENDICION_ID,
  rendicionJson,
  resumenJson,
} from '@/modules/rendiciones/test/rendiciones.fixtures';

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('VITE_API_URL', 'https://api.example');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

function renderTarjeta(
  resumen: { totalItems: number; completados: number } = {
    totalItems: 4,
    completados: 1,
  },
  extra: Record<string, unknown> = {},
) {
  const onAnulada = vi.fn();
  const onYaNoExiste = vi.fn();
  const resultado = renderEnMatriz(
    <RendicionCard
      rendicion={RendicionResumenSchema.parse(resumenJson({ resumen, ...extra }))}
      onAnulada={onAnulada}
      onYaNoExiste={onYaNoExiste}
    />,
    `/clientes/${CLIENTE_ID}/matriz`,
  );
  return { ...resultado, onAnulada, onYaNoExiste };
}

const botonAnular = () => screen.getByRole('button', { name: /^Anular la rendición de/ });
const dialogo = () => screen.getByRole('alertdialog');

describe('RendicionCard: emisor (HU2.9)', () => {
  it.each(Emisor.options)('muestra el emisor %s con su etiqueta', (emisor) => {
    renderTarjeta(undefined, { emisor });

    expect(screen.getByRole('article', { name: 'Octubre 2026' })).toHaveTextContent(
      `Emisor ${etiquetasEmisor[emisor]}`,
    );
  });

  it('una rendición heredada, sin emisor, dice "Sin emisor" en tono neutro (no como error)', () => {
    renderTarjeta(undefined, { emisor: null });

    const tarjeta = screen.getByRole('article', { name: 'Octubre 2026' });
    const sinEmisor = within(tarjeta).getByText(TEXTO_SIN_EMISOR);
    expect(sinEmisor).toHaveClass('text-muted-foreground');
    expect(sinEmisor).not.toHaveClass('text-warning');
    expect(sinEmisor).not.toHaveClass('text-destructive');
  });
});

describe('RendicionCard', () => {
  it('muestra el período, la factura y el avance "X de Y" sin abrirla', () => {
    renderTarjeta();

    const tarjeta = screen.getByRole('article', { name: 'Octubre 2026' });
    expect(tarjeta).toHaveTextContent('Factura A 00001-00000001');
    expect(tarjeta).toHaveTextContent('1 de 4 reunidos');
    expect(within(tarjeta).queryByText('Checklist completo')).not.toBeInTheDocument();
  });

  it('con todos los documentos reunidos, lo marca como completo', () => {
    renderTarjeta({ totalItems: 4, completados: 4 });

    expect(screen.getByText('4 de 4 reunidos')).toBeInTheDocument();
    expect(screen.getByText('Checklist completo')).toBeInTheDocument();
  });

  it('la tarjeta lleva al detalle de la rendición', async () => {
    const { user, router } = renderTarjeta();

    await user.click(screen.getByRole('link', { name: 'Octubre 2026' }));

    expect(router.state.location.pathname).toBe(
      `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
    );
  });

  it('con teclado: Tab llega al enlace del detalle y Enter navega', async () => {
    const { user, router } = renderTarjeta();

    await user.tab();
    expect(screen.getByRole('link', { name: 'Octubre 2026' })).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(router.state.location.pathname).toBe(
      `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
    );
  });

  it('se ve como navegable: el enlace cubre la tarjeta y hay una pista de "Ver detalle"', () => {
    renderTarjeta();

    const tarjeta = screen.getByRole('article', { name: 'Octubre 2026' });
    // El enlace se estira sobre la tarjeta (posicionada) con su pseudo-elemento.
    expect(tarjeta).toHaveClass('relative', 'cursor-pointer');
    expect(screen.getByRole('link', { name: 'Octubre 2026' })).toHaveClass('after:absolute');
    // La pista es visual: el enlace ya tiene nombre y no se anuncia dos veces.
    expect(within(tarjeta).getByText('Ver detalle')).toHaveAttribute('aria-hidden', 'true');
  });

  it('"Anular" no está dentro del enlace y su clic no navega', async () => {
    const { user, router } = renderTarjeta();

    expect(screen.getByRole('link', { name: 'Octubre 2026' })).not.toContainElement(botonAnular());
    await user.click(botonAnular());

    expect(router.state.location.pathname).toBe(`/clientes/${CLIENTE_ID}/matriz`);
    expect(dialogo()).toBeInTheDocument();
  });

  it('"Anular" pide confirmación antes de enviar nada', async () => {
    const { user } = renderTarjeta();

    await user.click(botonAnular());

    expect(dialogo()).toHaveAccessibleName('¿Anular la rendición de Octubre 2026?');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('confirmar envía la anulación y avisa', async () => {
    fetchMock.mockResolvedValue(
      json(rendicionJson({ estado: 'ANULADA', anuladaEn: '2026-10-15T16:00:00.000Z' })),
    );
    const { user, onAnulada } = renderTarjeta();

    await user.click(botonAnular());
    await user.click(within(dialogo()).getByRole('button', { name: 'Anular rendición' }));

    await waitFor(() => expect(onAnulada).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`https://api.example/rendiciones/${RENDICION_ID}/estado`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ estado: 'ANULADA' });
  });

  it('cancelar no envía nada ni navega', async () => {
    const { user, onAnulada, router } = renderTarjeta();

    await user.click(botonAnular());
    await user.click(within(dialogo()).getByRole('button', { name: 'Cancelar' }));

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onAnulada).not.toHaveBeenCalled();
    expect(router.state.location.pathname).toBe(`/clientes/${CLIENTE_ID}/matriz`);
  });

  it('si falla, el diálogo queda abierto con el error para reintentar', async () => {
    fetchMock.mockResolvedValue(errorJson(500, 'INTERNAL_ERROR'));
    const { user, onAnulada } = renderTarjeta();

    await user.click(botonAnular());
    await user.click(within(dialogo()).getByRole('button', { name: 'Anular rendición' }));

    expect(await within(dialogo()).findByRole('alert')).toHaveTextContent(
      'No pudimos anular la rendición. Probá de nuevo en unos segundos.',
    );
    expect(onAnulada).not.toHaveBeenCalled();
  });

  it('si la rendición ya no existe, cierra el diálogo y lo avisa', async () => {
    fetchMock.mockResolvedValue(errorJson(404, 'NOT_FOUND'));
    const { user, onYaNoExiste } = renderTarjeta();

    await user.click(botonAnular());
    await user.click(within(dialogo()).getByRole('button', { name: 'Anular rendición' }));

    await waitFor(() => expect(onYaNoExiste).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  describe('anulada', () => {
    const ANULADA = { estado: 'ANULADA', anuladaEn: '2026-10-20T15:00:00.000Z' };

    it('lleva la marca "Anulada", se ve atenuada y no ofrece "Anular"', () => {
      renderTarjeta({ totalItems: 4, completados: 4 }, ANULADA);

      const tarjeta = screen.getByRole('article', { name: 'Octubre 2026' });
      expect(within(tarjeta).getByText('Anulada')).toBeInTheDocument();
      expect(tarjeta).toHaveAttribute('data-estado', 'anulada');
      expect(tarjeta).toHaveClass('bg-muted/40');
      expect(within(tarjeta).queryByRole('button')).not.toBeInTheDocument();
      // Una anulada no se completa: la marca de completo no aplica.
      expect(within(tarjeta).queryByText('Checklist completo')).not.toBeInTheDocument();
    });

    it('sigue llevando al detalle, que la muestra en solo lectura', async () => {
      const { user, router } = renderTarjeta(undefined, ANULADA);

      await user.click(screen.getByRole('link', { name: 'Octubre 2026' }));

      expect(router.state.location.pathname).toBe(
        `/clientes/${CLIENTE_ID}/rendiciones/${RENDICION_ID}`,
      );
    });

    it('una activa no lleva la marca', () => {
      renderTarjeta();

      expect(screen.queryByText('Anulada')).not.toBeInTheDocument();
      expect(screen.getByRole('article', { name: 'Octubre 2026' })).toHaveAttribute(
        'data-estado',
        'activa',
      );
    });
  });
});
