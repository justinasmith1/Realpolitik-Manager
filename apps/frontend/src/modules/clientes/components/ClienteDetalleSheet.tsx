import type { Cliente } from '@realpolitik/shared';
import { useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FormSection } from '@/components/ui/form-field';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import {
  etiquetaDeMes,
  etiquetasEmisor,
  etiquetasIvaCondicion,
  etiquetasPeriodicidad,
} from '@/modules/clientes/clientes.etiquetas';
import { CanalEntregaBadge } from '@/modules/clientes/components/CanalEntregaBadge';
import { EmisorPendiente } from '@/modules/clientes/components/EmisorPendiente';
import { EstadoBadge } from '@/modules/clientes/components/EstadoBadge';
import { MatrizIndicacionesArmado } from '@/modules/clientes/components/MatrizIndicacionesArmado';
import { ObservacionesClientePanel } from '@/modules/clientes/components/ObservacionesClientePanel';
import { SectorBadge } from '@/modules/clientes/components/SectorBadge';
import { SubtipoBadge } from '@/modules/clientes/components/SubtipoBadge';
import { useCliente } from '@/modules/clientes/hooks/useCliente';

interface ClienteDetalleSheetProps {
  /** El cliente elegido en el listado (solo se usa su id y su nombre); `null`, cerrado. */
  cliente: Cliente | null;
  onClose: () => void;
}

/** Un dato que el cliente no tiene cargado: se dice, no se inventa ni se deja en blanco. */
function NoRegistrado({ texto = 'No registrado' }: { texto?: string }) {
  return <span className="text-content-secondary italic">{texto}</span>;
}

/** Pares dato–valor de una sección. En un celular, el dato va arriba del valor. */
function Datos({ children }: { children: ReactNode }) {
  return (
    <dl className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline">
      {children}
    </dl>
  );
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="text-xs text-content-secondary sm:text-sm">{etiqueta}</dt>
      <dd className="-mt-2 min-w-0 break-words sm:mt-0">{children}</dd>
    </div>
  );
}

/** Los datos del cliente, con las secciones y los nombres de campo de la hoja "Editar cliente". */
function FichaDelCliente({ cliente }: { cliente: Cliente }) {
  const { periodicidad } = cliente;
  return (
    <>
      <FormSection title="Identificación">
        <Datos>
          <Dato etiqueta="Razón social">{cliente.razonSocial}</Dato>
          <Dato etiqueta="Denominación">{cliente.denominacion}</Dato>
          <Dato etiqueta="Estado">
            <EstadoBadge estado={cliente.estado} />
          </Dato>
        </Datos>
      </FormSection>

      <FormSection title="Datos fiscales">
        <Datos>
          <Dato etiqueta="CUIT">
            <span className="font-mono text-xs">{cliente.cuit}</span>
          </Dato>
          <Dato etiqueta="Sector">
            <SectorBadge sector={cliente.sector} />
          </Dato>
          {cliente.sector === 'PUBLICO' && (
            <Dato etiqueta="Subtipo público">
              <SubtipoBadge subtipo={cliente.subtipo} />
            </Dato>
          )}
          <Dato etiqueta="Condición frente al IVA">
            {etiquetasIvaCondicion[cliente.ivaCondicion]}
          </Dato>
          <Dato etiqueta="Emisor">
            {cliente.emisor === undefined ? <EmisorPendiente /> : etiquetasEmisor[cliente.emisor]}
          </Dato>
        </Datos>
      </FormSection>

      <FormSection title="Contacto">
        <Datos>
          <Dato etiqueta="Email de contacto">{cliente.emailContacto}</Dato>
          {/* La hoja de edición no carga estos dos: se muestran solo si el cliente los tiene, para
              no anunciar como faltante algo que nadie puede completar desde la interfaz. */}
          {cliente.emailsAdicionales.length > 0 && (
            <Dato etiqueta="Emails adicionales">
              <ul className="flex flex-col gap-0.5">
                {cliente.emailsAdicionales.map((email) => (
                  <li key={email}>{email}</li>
                ))}
              </ul>
            </Dato>
          )}
          {cliente.telefono !== undefined && <Dato etiqueta="Teléfono">{cliente.telefono}</Dato>}
        </Datos>
      </FormSection>

      <FormSection title="Entrega de rendiciones">
        {/* Shared exige la URL con el canal PORTAL_WEB y el número con WHATSAPP: el "No
            registrado" de esos dos es solo el resguardo del tipo opcional. */}
        <Datos>
          <Dato etiqueta="Canal habitual">
            <CanalEntregaBadge canal={cliente.canalEntrega} />
          </Dato>
          {cliente.canalEntrega === 'PORTAL_WEB' && (
            <Dato etiqueta="URL del portal">
              {cliente.portalUrl === undefined ? (
                <NoRegistrado texto="No registrada" />
              ) : (
                // Shared solo admite URLs http(s) sin credenciales: se puede ofrecer como enlace.
                <a
                  href={cliente.portalUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-brand-accent underline-offset-2 hover:underline focus-visible:rounded-chip focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
                >
                  {cliente.portalUrl}
                </a>
              )}
            </Dato>
          )}
          {cliente.canalEntrega === 'WHATSAPP' && (
            <Dato etiqueta="Número de WhatsApp">{cliente.whatsappNumero ?? <NoRegistrado />}</Dato>
          )}
        </Datos>
      </FormSection>

      <FormSection title="Periodicidad de rendición">
        <Datos>
          <Dato etiqueta="Periodicidad">
            {periodicidad === null ? (
              <NoRegistrado texto="Sin configurar" />
            ) : (
              etiquetasPeriodicidad[periodicidad.tipo]
            )}
          </Dato>
          {periodicidad !== null && <Dato etiqueta="Día límite">Día {periodicidad.diaLimite}</Dato>}
          {periodicidad?.tipo === 'BIMESTRAL' && (
            <Dato etiqueta="Mes de inicio del ciclo">
              {etiquetaDeMes(periodicidad.mesInicioCiclo)}
            </Dato>
          )}
        </Datos>
      </FormSection>

      {/* Las dos notas, en el mismo orden que la hoja "Editar cliente". Cada una tiene su carga y
          su error: si una falla, lo dice y deja reintentar, sin afirmar que no hay nota. */}
      <MatrizIndicacionesArmado cliente={cliente} nivelDeTitulo="h3" />
      <ObservacionesClientePanel cliente={cliente} nivelDeTitulo="h3" />
    </>
  );
}

/**
 * Ficha del cliente en SOLO LECTURA (HU4.3), para quien puede ver clientes pero no editarlos.
 * Los datos salen de `GET /clientes/:id` (`useCliente`), no del resumen del listado. Al cambiar
 * de cliente no se muestran los datos del anterior: la consulta es otra y arranca cargando.
 *
 * No tiene formularios ni botones de guardar o editar; solo se cierra. El foco vuelve a lo que
 * lo abrió (el disparador del menú), como en los otros paneles.
 */
export function ClienteDetalleSheet({ cliente, onClose }: ClienteDetalleSheetProps) {
  // Mientras el panel sale, sigue mostrando al último cliente: quien lo usa pasa `cliente` a null
  // al cerrar, y sin esto se vería la carga durante la animación de salida.
  const [mostrado, setMostrado] = useState(cliente);
  if (cliente !== null && cliente !== mostrado) {
    setMostrado(cliente);
  }
  const consulta = useCliente(mostrado?.id, { enabled: mostrado !== null });

  return (
    <Sheet
      open={cliente !== null}
      onOpenChange={(abrir) => {
        if (!abrir) onClose();
      }}
      onOpenChangeComplete={(abiertoAhora) => {
        if (!abiertoAhora) setMostrado(null);
      }}
    >
      <SheetContent className="flex flex-col data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Ficha de {mostrado?.razonSocial}</SheetTitle>
          <SheetDescription>Datos del cliente, en modo de solo lectura.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-7 overflow-y-auto px-5 py-5">
          {consulta.isError ? (
            <Alert>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>No pudimos cargar la ficha del cliente.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void consulta.refetch()}
                  disabled={consulta.isFetching}
                >
                  Reintentar
                </Button>
              </div>
            </Alert>
          ) : consulta.data === undefined ? (
            <div className="flex flex-col gap-3" data-testid="ficha-cargando" aria-busy="true">
              <span className="sr-only">Cargando la ficha del cliente…</span>
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ) : (
            <FichaDelCliente cliente={consulta.data} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
