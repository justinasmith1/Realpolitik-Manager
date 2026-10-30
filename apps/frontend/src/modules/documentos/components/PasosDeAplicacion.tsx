import type { CandidatoAplicacion, Documento } from '@realpolitik/shared';
import { useId } from 'react';

import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { etiquetasEstado } from '@/modules/clientes/clientes.etiquetas';
import {
  agruparCandidatos,
  cantidadDeItems,
  EXTENSIONES_ADMITIDAS,
  fechaLegible,
  FORMATOS_ADMITIDOS,
  resumenDeSeleccion,
  tamanioLegible,
} from '@/modules/documentos/documentos.etiquetas';
import { useDocumentos } from '@/modules/documentos/hooks/useDocumentos';
import {
  opcionesDeAnio,
  opcionesDeMes,
} from '@/modules/rendiciones/components/abrirRendicionForm.validation';
import { etiquetaDePeriodo, nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';

// Los tres pasos del asistente de aplicación (HU2.8). Son presentacionales: el estado y las
// llamadas a la API los maneja `AplicarDocumentoAsistente`.

export interface Periodo {
  anio: number;
  mes: number;
}

const claseDeError = 'text-sm text-destructive';

/** Mes y año, con los mismos selectores que al abrir una rendición. */
function CamposDePeriodo({
  periodo,
  onPeriodo,
  deshabilitado,
}: {
  periodo: Periodo;
  onPeriodo: (periodo: Periodo) => void;
  deshabilitado: boolean;
}) {
  const idMes = useId();
  const idAnio = useId();
  const anios = opcionesDeAnio();
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idMes} className="text-sm font-medium">
          Mes
        </label>
        <Select
          id={idMes}
          value={String(periodo.mes)}
          onValueChange={(mes) => onPeriodo({ ...periodo, mes: Number(mes) })}
          options={opcionesDeMes}
          disabled={deshabilitado}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={idAnio} className="text-sm font-medium">
          Año
        </label>
        <Select
          id={idAnio}
          value={String(periodo.anio)}
          onValueChange={(anio) => onPeriodo({ ...periodo, anio: Number(anio) })}
          options={anios}
          disabled={deshabilitado}
        />
      </div>
    </div>
  );
}

// ─── Paso 1: archivo y tipo ───────────────────────────────────────────────────

export type Origen = 'nuevo' | 'existente';

interface PasoArchivoProps {
  origen: Origen;
  onOrigen: (origen: Origen) => void;
  /** Ya se subió en esta sesión: el archivo, el tipo y el período no se pueden cambiar. */
  cargado: Documento | null;
  archivo: File | null;
  onArchivo: (archivo: File | null) => void;
  errorArchivo: string | null;
  tipoDocumentoId: string;
  onTipo: (tipoDocumentoId: string) => void;
  opcionesDeTipo: readonly SelectOption[];
  tiposCargando: boolean;
  errorTipo: string | null;
  periodo: Periodo;
  onPeriodo: (periodo: Periodo) => void;
  /** Documentos con el mismo contenido, tipo y período que el recién subido. */
  duplicados: Documento[];
  onUsarDuplicado: (documento: Documento) => void;
  /** Documento existente elegido (origen `existente`). */
  elegido: Documento | null;
  onElegir: (documento: Documento) => void;
}

export function PasoArchivo(props: PasoArchivoProps) {
  const { origen, onOrigen, cargado } = props;
  const nombreDelGrupo = useId();
  return (
    <div className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2" disabled={cargado !== null}>
        <legend className="mb-1 text-sm font-medium">¿Qué archivo vas a aplicar?</legend>
        {(
          [
            ['nuevo', 'Subir un archivo nuevo'],
            ['existente', 'Usar uno ya cargado en el repositorio'],
          ] as const
        ).map(([valor, texto]) => (
          <label
            key={valor}
            className={cn(
              'flex cursor-pointer items-center gap-2.5 rounded-control border px-3 py-2.5 text-sm has-focus-visible:ring-3 has-focus-visible:ring-ring/30',
              origen === valor ? 'border-primary bg-panel-alt font-medium' : 'bg-card',
              cargado !== null && 'cursor-not-allowed opacity-70',
            )}
          >
            <input
              type="radio"
              name={nombreDelGrupo}
              value={valor}
              checked={origen === valor}
              onChange={() => onOrigen(valor)}
              className="size-4 accent-primary"
            />
            {texto}
          </label>
        ))}
      </fieldset>
      {origen === 'nuevo' ? <ArchivoNuevo {...props} /> : <ArchivoExistente {...props} />}
    </div>
  );
}

function ArchivoNuevo({
  cargado,
  archivo,
  onArchivo,
  errorArchivo,
  tipoDocumentoId,
  onTipo,
  opcionesDeTipo,
  tiposCargando,
  errorTipo,
  periodo,
  onPeriodo,
  duplicados,
  onUsarDuplicado,
}: PasoArchivoProps) {
  const idArchivo = useId();
  const idTipo = useId();
  const idAyuda = useId();
  const idErrorArchivo = useId();
  const idErrorTipo = useId();
  const bloqueado = cargado !== null;

  return (
    <div className="flex flex-col gap-4">
      {cargado !== null && (
        <Alert variant="success">
          {cargado.nombreOriginal} ya está en el repositorio. Para usar otro archivo, cerrá y empezá
          de nuevo.
        </Alert>
      )}
      {duplicados.length > 0 && (
        <Alert variant="warning">
          <div className="flex flex-col gap-2">
            <span>
              Ya había {duplicados.length === 1 ? 'un archivo' : `${duplicados.length} archivos`}{' '}
              con el mismo contenido, tipo y período. Podés aplicar ese en lugar del que acabás de
              subir (el nuevo queda en el repositorio, sin aplicar).
            </span>
            <ul className="flex flex-col gap-1.5">
              {duplicados.map((duplicado) => (
                <li
                  key={duplicado.id}
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span className="text-sm">
                    <span className="font-medium break-all">{duplicado.nombreOriginal}</span> ·
                    cargado el {fechaLegible(duplicado.creadoEn)}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onUsarDuplicado(duplicado)}
                  >
                    Usar este
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        </Alert>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor={idArchivo} className="text-sm font-medium">
          Archivo
        </label>
        <Input
          id={idArchivo}
          type="file"
          accept={EXTENSIONES_ADMITIDAS}
          disabled={bloqueado}
          aria-invalid={errorArchivo !== null ? true : undefined}
          aria-describedby={errorArchivo !== null ? `${idAyuda} ${idErrorArchivo}` : idAyuda}
          onChange={(evento) => onArchivo(evento.target.files?.[0] ?? null)}
          className="h-auto py-2"
        />
        <p id={idAyuda} className="text-xs text-content-secondary">
          {FORMATOS_ADMITIDOS}, hasta 10 MB.
          {archivo !== null && ` Elegiste ${archivo.name} (${tamanioLegible(archivo.size)}).`}
        </p>
        {errorArchivo !== null && (
          <p id={idErrorArchivo} className={claseDeError}>
            {errorArchivo}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={idTipo} className="text-sm font-medium">
          Tipo de documento
        </label>
        <Select
          id={idTipo}
          value={tipoDocumentoId}
          onValueChange={onTipo}
          options={opcionesDeTipo}
          placeholder={tiposCargando ? 'Cargando tipos…' : 'Elegí un tipo'}
          disabled={bloqueado || tiposCargando}
          invalid={errorTipo !== null}
          aria-describedby={errorTipo !== null ? idErrorTipo : undefined}
        />
        {errorTipo !== null && (
          <p id={idErrorTipo} className={claseDeError}>
            {errorTipo}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Período del documento</legend>
        <CamposDePeriodo periodo={periodo} onPeriodo={onPeriodo} deshabilitado={bloqueado} />
      </fieldset>
    </div>
  );
}

function ArchivoExistente({ periodo, onPeriodo, elegido, onElegir }: PasoArchivoProps) {
  const consulta = useDocumentos(periodo);
  const nombreDelGrupo = useId();
  const documentos = consulta.isPlaceholderData ? undefined : consulta.data;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Período</legend>
        <CamposDePeriodo periodo={periodo} onPeriodo={onPeriodo} deshabilitado={false} />
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">
          Documentos de {etiquetaDePeriodo(periodo)}
        </legend>
        {consulta.isError ? (
          <Alert>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>No pudimos cargar los documentos del período.</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void consulta.refetch()}
              >
                Reintentar
              </Button>
            </div>
          </Alert>
        ) : documentos === undefined ? (
          <Skeleton className="h-24 w-full" />
        ) : documentos.length === 0 ? (
          <p className="text-sm text-content-secondary">
            Todavía no hay documentos cargados en {etiquetaDePeriodo(periodo)}.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border rounded-card border bg-card">
            {documentos.map((documento) => (
              <label
                key={documento.id}
                className={cn(
                  // Grilla: la casilla a la izquierda, el nombre y sus datos en la segunda columna.
                  // Los textos van directo en el label, así el nombre accesible es el del archivo.
                  'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2.5 gap-y-0.5 px-3 py-2.5 has-focus-visible:ring-3 has-focus-visible:ring-ring/30',
                  elegido?.id === documento.id && 'bg-panel-alt',
                )}
              >
                <input
                  type="radio"
                  name={nombreDelGrupo}
                  value={documento.id}
                  checked={elegido?.id === documento.id}
                  onChange={() => onElegir(documento)}
                  className="row-span-2 mt-0.5 size-4 accent-primary"
                />
                <span className="text-sm font-medium break-all">{documento.nombreOriginal}</span>
                <span className="col-start-2 text-xs text-content-secondary">
                  {documento.tipoDocumento.nombre} · cargado el {fechaLegible(documento.creadoEn)} ·{' '}
                  {cantidadDeItems(documento.aplicacionesVigentes).toLowerCase()}
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

// ─── Paso 2: dónde aplica ─────────────────────────────────────────────────────

interface PasoDondeAplicaProps {
  documento: Documento;
  candidatos: CandidatoAplicacion[] | undefined;
  cargando: boolean;
  error: boolean;
  onReintentar: () => void;
  seleccion: ReadonlySet<string>;
  onAlternar: (itemId: string, marcado: boolean) => void;
  /** Lo que pasó al confirmar (un ítem dejó de estar disponible), para volver a elegir. */
  aviso: string | null;
}

/**
 * Los ítems pendientes compatibles, agrupados por cliente y rendición, cada uno con su casilla.
 * Nada viene marcado: la operadora elige cada ítem (Print 1 de 5, 2 de 5…), también varios de la
 * misma rendición o de distintos clientes.
 */
export function PasoDondeAplica({
  documento,
  candidatos,
  cargando,
  error,
  onReintentar,
  seleccion,
  onAlternar,
  aviso,
}: PasoDondeAplicaProps) {
  const prefijo = useId();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-content-secondary">
        Ítems pendientes de{' '}
        <span className="font-medium text-foreground">{documento.tipoDocumento.nombre}</span> en
        rendiciones abiertas de {etiquetaDePeriodo(documento)}. Elegí dónde aplicar{' '}
        <span className="font-medium break-all text-foreground">{documento.nombreOriginal}</span>.
      </p>
      {aviso !== null && <Alert variant="warning">{aviso}</Alert>}
      {error ? (
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>No pudimos cargar dónde se puede aplicar.</span>
            <Button type="button" variant="outline" size="sm" onClick={onReintentar}>
              Reintentar
            </Button>
          </div>
        </Alert>
      ) : cargando || candidatos === undefined ? (
        <div className="flex flex-col gap-3">
          <span className="sr-only" role="status">
            Buscando dónde se puede aplicar…
          </span>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : candidatos.length === 0 ? (
        <p className="rounded-card border bg-card p-4 text-sm text-content-secondary">
          No hay ítems pendientes de {documento.tipoDocumento.nombre} en rendiciones abiertas de{' '}
          {etiquetaDePeriodo(documento)}. El documento queda en el repositorio y podés aplicarlo
          después.
        </p>
      ) : (
        agruparCandidatos(candidatos).map(({ cliente, rendiciones }) => (
          <section
            key={cliente.id}
            aria-labelledby={`${prefijo}-${cliente.id}`}
            className="flex flex-col gap-2 rounded-card border bg-card p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <h3 id={`${prefijo}-${cliente.id}`} className="text-sm font-semibold">
                {cliente.denominacion}
              </h3>
              {cliente.estado !== 'ACTIVO' && (
                <Badge tone="muted">Cliente {etiquetasEstado[cliente.estado]}</Badge>
              )}
            </div>
            {rendiciones.map(({ rendicion, items }) => (
              <fieldset key={rendicion.id} className="flex flex-col gap-1 border-t pt-2">
                <legend className="text-xs font-medium text-content-secondary">
                  Factura <span className="font-mono">{rendicion.numeroFactura}</span>
                </legend>
                {items.map((item) => {
                  const idCasilla = `${prefijo}-${item.id}`;
                  return (
                    <div key={item.id} className="flex min-h-9 items-center gap-2.5">
                      <Checkbox
                        id={idCasilla}
                        checked={seleccion.has(item.id)}
                        onCheckedChange={(marcado) => onAlternar(item.id, marcado)}
                      />
                      <label htmlFor={idCasilla} className="cursor-pointer text-sm">
                        {nombreDeItem(item)}
                        {item.diaAproximado !== null && (
                          <span className="text-content-secondary">
                            {' '}
                            · día aprox. {item.diaAproximado}
                          </span>
                        )}
                      </label>
                    </div>
                  );
                })}
              </fieldset>
            ))}
          </section>
        ))
      )}
    </div>
  );
}

// ─── Paso 3: confirmar ────────────────────────────────────────────────────────

interface PasoConfirmarProps {
  documento: Documento;
  elegidos: CandidatoAplicacion[];
  error: string | null;
}

export function PasoConfirmar({ documento, elegidos, error }: PasoConfirmarProps) {
  const grupos = agruparCandidatos(elegidos);
  const rendiciones = grupos.reduce((total, grupo) => total + grupo.rendiciones.length, 0);
  return (
    <div className="flex flex-col gap-4">
      {error !== null && <Alert>{error}</Alert>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-card border bg-card p-3 text-sm">
        <dt className="text-content-secondary">Archivo</dt>
        <dd className="font-medium break-all">{documento.nombreOriginal}</dd>
        <dt className="text-content-secondary">Tipo</dt>
        <dd>{documento.tipoDocumento.nombre}</dd>
        <dt className="text-content-secondary">Período</dt>
        <dd>{etiquetaDePeriodo(documento)}</dd>
      </dl>
      <section aria-labelledby="titulo-confirmacion" className="flex flex-col gap-2">
        <h3 id="titulo-confirmacion" className="text-sm font-semibold">
          Se aplica a {resumenDeSeleccion(elegidos.length, rendiciones)}
        </h3>
        <ul className="divide-y divide-border rounded-card border bg-card">
          {grupos.flatMap(({ cliente, rendiciones: deCliente }) =>
            deCliente.map(({ rendicion, items }) => (
              <li key={rendicion.id} className="flex flex-col gap-0.5 px-3 py-2.5">
                <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                  {cliente.denominacion}
                  {cliente.estado !== 'ACTIVO' && (
                    <Badge tone="muted">Cliente {etiquetasEstado[cliente.estado]}</Badge>
                  )}
                </span>
                <span className="text-[13px] text-content-secondary">
                  Factura <span className="font-mono">{rendicion.numeroFactura}</span> ·{' '}
                  {items.map(nombreDeItem).join(', ')}
                </span>
              </li>
            )),
          )}
        </ul>
      </section>
    </div>
  );
}
