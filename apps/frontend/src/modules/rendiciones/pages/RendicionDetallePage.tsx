import {
  calcularFaltantes,
  canalDeSeleccion,
  type ItemChecklist,
  type Cliente,
  type RendicionDetalle,
} from '@realpolitik/shared';
import { ArrowLeftIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { enfocarYMostrar } from '@/lib/focus';
import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';
import { EditarClienteSheet } from '@/modules/clientes/components/EditarClienteSheet';
import { MatrizIndicacionesArmado } from '@/modules/clientes/components/MatrizIndicacionesArmado';
import { useCliente } from '@/modules/clientes/hooks/useCliente';
import { esRendicionInexistente } from '@/modules/rendiciones/api/rendiciones.api';
import { CambiarCanalDialog } from '@/modules/rendiciones/components/CambiarCanalDialog';
import { EnvioDialog, type Envio } from '@/modules/rendiciones/components/EnvioDialog';
import { ItemChecklistFila } from '@/modules/rendiciones/components/ItemChecklistFila';
import { useRendicion } from '@/modules/rendiciones/hooks/useRendiciones';
import {
  avanceDelChecklist,
  checklistCompleto,
  etiquetaDePeriodo,
} from '@/modules/rendiciones/rendiciones.etiquetas';
import { rutaDeMatriz, type EstadoDeDetalle } from '@/modules/rendiciones/rendiciones.rutas';

// La fecha de anulación, como la lee la operadora (horario de Buenos Aires, como el período).
const formatoDeFecha = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'long',
  timeZone: 'America/Argentina/Buenos_Aires',
});

/**
 * Detalle de una rendición (`/clientes/:id/rendiciones/:rendicionId`, HU2.5 y HU2.6): período,
 * factura, estado, avance y el checklist en solo lectura, con las indicaciones de armado del
 * cliente al costado. Una rendición anulada se ve igual, como historial, con su aviso.
 *
 * Los ítems se eligen para enviarlos por su canal (ya resuelto en cada ítem al abrir la
 * rendición). Una anulada no se envía: no tiene casillas ni botón.
 */
export function RendicionDetallePage() {
  const { id, rendicionId } = useParams();
  const location = useLocation();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const idsValidos = esIdDeRuta(id) && esIdDeRuta(rendicionId);
  const clienteQuery = useCliente(id, { enabled: idsValidos });
  const consulta = useRendicion(id, rendicionId);
  const [aviso, setAviso] = useState(() => (location.state as EstadoDeDetalle | null)?.aviso);

  const rendicion = consulta.data;
  // Una rendición de otro cliente (URL armada a mano) no existe para este.
  const inexistente =
    !idsValidos ||
    (consulta.isError && esRendicionInexistente(consulta.error)) ||
    (rendicion !== undefined && rendicion.clienteId !== id);

  const anclaDeFoco = inexistente ? 'inexistente' : rendicion !== undefined ? 'rendicion' : null;
  useEffect(() => {
    if (anclaDeFoco !== null) enfocarYMostrar(tituloRef.current);
  }, [anclaDeFoco, rendicionId]);

  let contenido: ReactNode;
  if (inexistente) {
    contenido = (
      <>
        <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
          La rendición no existe
        </h1>
        <p className="text-sm text-content-secondary">
          Puede que el enlace esté mal o que el cliente ya no exista.
        </p>
      </>
    );
  } else if (consulta.isError) {
    contenido = (
      <>
        <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
          Rendición
        </h1>
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>No pudimos cargar la rendición.</span>
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
      </>
    );
  } else if (rendicion === undefined) {
    contenido = (
      <div className="flex flex-col gap-3" data-testid="rendicion-cargando">
        <h1 className="sr-only">Rendición</h1>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  } else {
    contenido = (
      <DetalleDeRendicion
        rendicion={rendicion}
        cliente={clienteQuery.data}
        onClienteActualizado={() => void clienteQuery.refetch()}
        tituloRef={tituloRef}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      {id !== undefined && esIdDeRuta(id) && (
        <Link
          to={rutaDeMatriz(id)}
          className="inline-flex w-fit items-center gap-1 rounded-chip text-sm text-content-secondary outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
        >
          <ArrowLeftIcon aria-hidden="true" />
          Volver a los requisitos del cliente
        </Link>
      )}
      {aviso !== undefined && (
        <Alert variant="success" onCerrar={() => setAviso(undefined)}>
          {aviso}
        </Alert>
      )}
      {contenido}
    </div>
  );
}

interface DetalleDeRendicionProps {
  rendicion: RendicionDetalle;
  cliente: Cliente | undefined;
  onClienteActualizado: () => void;
  tituloRef: RefObject<HTMLHeadingElement | null>;
}

function DetalleDeRendicion({
  rendicion,
  cliente,
  onClienteActualizado,
  tituloRef,
}: DetalleDeRendicionProps) {
  const idSoloFaltantes = useId();
  const enviarRef = useRef<HTMLButtonElement>(null);
  const [soloFaltantes, setSoloFaltantes] = useState(false);
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  // El aviso de canales mezclados se pidió al tocar "Enviar"; los canales se calculan con los
  // datos de ahora, así corregir el canal de un ítem lo actualiza o lo retira solo.
  const [avisoDeMezcla, setAvisoDeMezcla] = useState(false);
  const [envio, setEnvio] = useState<Envio | null>(null);
  const [itemACorregir, setItemACorregir] = useState<ItemChecklist | null>(null);
  const [avisoDeCanal, setAvisoDeCanal] = useState<string | null>(null);
  const [editandoCliente, setEditandoCliente] = useState(false);
  const avance = calcularFaltantes(rendicion.items);
  const anulada = rendicion.estado === 'ANULADA';
  const completo = checklistCompleto(avance);
  const visibles = soloFaltantes ? avance.faltantes : rendicion.items;
  const elegidos = rendicion.items.filter((item) => seleccion.has(item.id));
  const canalDeElegidos = canalDeSeleccion(elegidos);
  const canalesMezclados =
    avisoDeMezcla && canalDeElegidos.tipo === 'mezclados' ? canalDeElegidos.canales : null;
  const denominacion = cliente?.denominacion;

  function alternar(itemId: string, marcado: boolean) {
    setAvisoDeMezcla(false);
    setSeleccion((actual) => {
      const siguiente = new Set(actual);
      if (marcado) siguiente.add(itemId);
      else siguiente.delete(itemId);
      return siguiente;
    });
  }

  function enviar() {
    if (canalDeElegidos.tipo === 'mezclados') setAvisoDeMezcla(true);
    else if (canalDeElegidos.tipo === 'un-canal') {
      setEnvio({ canal: canalDeElegidos.canal, items: elegidos });
    }
  }

  return (
    <>
      <header className="flex flex-col gap-2">
        {denominacion !== undefined && (
          <p className="text-sm text-content-secondary">{denominacion}</p>
        )}
        <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
          Rendición {etiquetaDePeriodo(rendicion)}
        </h1>
        <dl className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          <div className="flex gap-1.5">
            <dt className="text-content-secondary">Factura</dt>
            <dd className="font-mono text-foreground">{rendicion.numeroFactura}</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="text-content-secondary">Estado</dt>
            <dd>
              <Badge tone={anulada ? 'muted' : 'neutral'}>{anulada ? 'Anulada' : 'Activa'}</Badge>
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-content-secondary">Avance</dt>
            <dd className="text-foreground">{avanceDelChecklist(avance)}</dd>
          </div>
        </dl>
      </header>

      {anulada && (
        <Alert variant="warning">
          Anulada
          {rendicion.anuladaEn !== null && ` el ${formatoDeFecha.format(rendicion.anuladaEn)}`}. Se
          conserva como historial: no se puede modificar.
        </Alert>
      )}
      {completo && <Alert variant="success">Checklist completo: están todos los documentos.</Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          aria-labelledby="titulo-checklist"
          className="order-2 flex flex-col gap-3 rounded-panel border bg-panel p-5 shadow-xs lg:order-1"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="titulo-checklist" className="text-base font-semibold text-foreground">
              Checklist
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex min-h-9 items-center gap-2 text-sm">
                <Checkbox
                  id={idSoloFaltantes}
                  checked={soloFaltantes}
                  onCheckedChange={(marcado) => setSoloFaltantes(marcado)}
                />
                <label htmlFor={idSoloFaltantes} className="cursor-pointer">
                  Ver solo faltantes ({avance.faltantes.length})
                </label>
              </div>
              {!anulada && (
                <Button
                  ref={enviarRef}
                  type="button"
                  size="sm"
                  onClick={enviar}
                  disabled={elegidos.length === 0}
                >
                  Enviar ({elegidos.length})
                </Button>
              )}
            </div>
          </div>
          {canalesMezclados !== null && (
            <Alert variant="warning" onCerrar={() => setAvisoDeMezcla(false)}>
              Los ítems seleccionados se envían por canales distintos (
              {canalesMezclados.map((canal) => etiquetasCanalEntrega[canal]).join(', ')}). Separalos
              en envíos distintos.
            </Alert>
          )}
          {avisoDeCanal !== null && (
            <Alert variant="success" onCerrar={() => setAvisoDeCanal(null)}>
              {avisoDeCanal}
            </Alert>
          )}
          {visibles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {soloFaltantes
                ? 'No hay documentos faltantes.'
                : 'Esta rendición no tiene documentos.'}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {visibles.map((item) => (
                <ItemChecklistFila
                  key={item.id}
                  item={item}
                  {...(!anulada && {
                    seleccion: {
                      marcado: seleccion.has(item.id),
                      onCambio: (marcado: boolean) => alternar(item.id, marcado),
                    },
                    onCambiarCanal: () => {
                      setAvisoDeCanal(null);
                      setItemACorregir(item);
                    },
                  })}
                />
              ))}
            </ul>
          )}
        </section>
        <div className="order-1 lg:order-2">
          <MatrizIndicacionesArmado cliente={{ id: rendicion.clienteId }} />
        </div>
      </div>

      <CambiarCanalDialog
        item={itemACorregir}
        clienteId={rendicion.clienteId}
        rendicionId={rendicion.id}
        onCerrar={() => setItemACorregir(null)}
        onCambiado={(texto) => {
          setItemACorregir(null);
          setAvisoDeCanal(texto);
        }}
      />
      <EnvioDialog
        envio={envio}
        cliente={cliente}
        onCerrar={() => setEnvio(null)}
        onEditarCliente={() => {
          setEnvio(null);
          setEditandoCliente(true);
        }}
        focoAlCerrar={enviarRef}
      />
      {cliente !== undefined && (
        <EditarClienteSheet
          cliente={editandoCliente ? cliente : null}
          onClose={() => setEditandoCliente(false)}
          onActualizado={() => {
            setEditandoCliente(false);
            onClienteActualizado();
          }}
        />
      )}
    </>
  );
}
