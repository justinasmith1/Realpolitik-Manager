import {
  normalizarNombreTipoDocumento,
  type Documento,
  type DocumentoResumen,
} from '@realpolitik/shared';
import { SearchIcon, UploadIcon } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';

import { DocumentosNav } from '@/components/layout/DocumentosNav';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAvisoDePagina } from '@/hooks/use-aviso-de-pagina';
import { causaDeError, diagnosticoDeError } from '@/lib/errores-api';
import { cn } from '@/lib/utils';
import {
  AplicarDocumentoAsistente,
  type ResultadoDelAsistente,
} from '@/modules/documentos/components/AplicarDocumentoAsistente';
import { ArchivosErrorState } from '@/modules/documentos/components/ArchivosErrorState';
import { ArchivosListado } from '@/modules/documentos/components/ArchivosListado';
import { DocumentoDetalleSheet } from '@/modules/documentos/components/DocumentoDetalleSheet';
import { descargarDocumento } from '@/modules/documentos/descargarDocumento';
import { resumenDeSeleccion } from '@/modules/documentos/documentos.etiquetas';
import { useDocumentos } from '@/modules/documentos/hooks/useDocumentos';
import { useFiltrosArchivos } from '@/modules/documentos/hooks/useFiltrosArchivos';
import {
  opcionesDeAnio,
  opcionesDeMes,
} from '@/modules/rendiciones/components/abrirRendicionForm.validation';
import { etiquetaDePeriodo } from '@/modules/rendiciones/rendiciones.etiquetas';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

/** Sin texto de búsqueda, todo coincide. Sin mayúsculas ni acentos (la ñ cuenta), como el catálogo. */
const coincide = (documento: DocumentoResumen, busqueda: string) =>
  busqueda === '' ||
  normalizarNombreTipoDocumento(documento.nombreOriginal).includes(
    normalizarNombreTipoDocumento(busqueda),
  );

interface SesionDelAsistente {
  /** Cambia en cada apertura: el asistente se vuelve a montar y empieza limpio. */
  sesion: number;
  abierto: boolean;
  documento: Documento | null;
}

/**
 * Repositorio de archivos (`/documentos/archivos`, HU2.8): los documentos cargados en un período,
 * con su tipo, fecha y en cuántos ítems están vigentes. Desde acá se cargan y aplican (asistente),
 * se consulta dónde se usó cada uno (detalle) y se descargan, siempre a través del backend.
 */
export function ArchivosPage() {
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const idBusqueda = useId();
  const idMes = useId();
  const idAnio = useId();
  const idTipo = useId();
  const { aviso, avisar, limpiar, cerrar, quitar } = useAvisoDePagina({
    avisoRef,
    destinoDelFoco: tituloRef,
  });

  const { anio, mes, tipoDocumentoId, elegirPeriodo, elegirTipo } = useFiltrosArchivos();
  const [busqueda, setBusqueda] = useState('');
  const consulta = useDocumentos({ anio, mes, tipoDocumentoId });
  // Todos los tipos, también los desactivados: puede haber archivos de un tipo que ya no se usa.
  const tipos = useTiposDocumento({ incluirInactivos: true });
  const opcionesDeTipo = useMemo(
    () => [
      { value: '', label: 'Todos los tipos' },
      ...(tipos.data ?? []).map((tipo) => ({ value: tipo.id, label: tipo.nombre })),
    ],
    [tipos.data],
  );
  const anios = useMemo(() => opcionesDeAnio(), []);

  const [detalleId, setDetalleId] = useState<string | null>(null);
  const [asistente, setAsistente] = useState<SesionDelAsistente>({
    sesion: 0,
    abierto: false,
    documento: null,
  });
  const [idsDescargando, setIdsDescargando] = useState<readonly string[]>([]);

  const abrirAsistente = (documento: Documento | null) => {
    limpiar();
    setDetalleId(null);
    setAsistente((previo) => ({ sesion: previo.sesion + 1, abierto: true, documento }));
  };

  const alTerminarAsistente = (resultado: ResultadoDelAsistente) => {
    setAsistente((previo) => ({ ...previo, abierto: false }));
    if (resultado.tipo === 'aplicado') {
      avisar(
        'success',
        `Se aplicó ${resultado.documento.nombreOriginal} a ${resumenDeSeleccion(
          resultado.items,
          resultado.rendiciones,
        )}.`,
      );
    } else if (resultado.tipo === 'guardado') {
      avisar(
        'success',
        `Se guardó ${resultado.documento.nombreOriginal} en el repositorio, sin aplicar. Podés aplicarlo cuando quieras.`,
      );
    }
  };

  const descargar = async (documento: { id: string; nombreOriginal: string }) => {
    if (idsDescargando.includes(documento.id)) return;
    setIdsDescargando((previos) => [...previos, documento.id]);
    try {
      await descargarDocumento(documento);
    } catch {
      avisar('destructive', `No se pudo descargar ${documento.nombreOriginal}. Probá de nuevo.`);
    } finally {
      setIdsDescargando((previos) => previos.filter((id) => id !== documento.id));
    }
  };

  const documentos = consulta.data;
  // Mientras se pide el filtro nuevo, `data` es del anterior: se muestra, pero no sirve para
  // concluir que no hay resultados.
  const actualizando = consulta.isPlaceholderData;
  const visibles = (documentos ?? []).filter((documento) => coincide(documento, busqueda));
  const hayFiltros = busqueda !== '' || tipoDocumentoId !== undefined;
  const periodo = etiquetaDePeriodo({ anio, mes });

  const limpiarFiltros = () => {
    setBusqueda('');
    elegirTipo(undefined);
  };

  let contenido: ReactNode;
  if (consulta.isPending || (documentos?.length === 0 && actualizando)) {
    contenido = (
      <div className="flex flex-col gap-2" aria-busy="true">
        <span role="status" className="sr-only">
          Cargando los archivos…
        </span>
        {[0, 1, 2].map((fila) => (
          <Skeleton key={fila} className="h-16 w-full" />
        ))}
      </div>
    );
  } else if (consulta.isError) {
    contenido = (
      <ArchivosErrorState
        causa={causaDeError(consulta.error)}
        diagnostico={diagnosticoDeError(consulta.error)}
        onReintentar={() => void consulta.refetch()}
      />
    );
  } else if (visibles.length === 0) {
    const sinDocumentos = (documentos?.length ?? 0) === 0 && tipoDocumentoId === undefined;
    contenido = (
      <div className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-card border bg-card p-8 text-center">
        <h2 className="text-[17px] font-semibold">
          {sinDocumentos
            ? `Todavía no se cargaron documentos en ${periodo}`
            : 'Ningún archivo coincide con estos filtros'}
        </h2>
        <p className="max-w-115 text-sm text-content-secondary">
          {sinDocumentos
            ? 'Cargá un archivo una sola vez y aplicalo a los clientes que lo necesiten.'
            : 'Probá con otro nombre u otro tipo de documento.'}
        </p>
        {sinDocumentos ? (
          <Button variant="brand" onClick={() => abrirAsistente(null)}>
            <UploadIcon aria-hidden="true" />
            Cargar documento
          </Button>
        ) : (
          hayFiltros && (
            <Button variant="outline" onClick={limpiarFiltros}>
              Limpiar filtros
            </Button>
          )
        )}
      </div>
    );
  } else {
    contenido = (
      <div
        aria-busy={actualizando}
        className={cn('transition-opacity', actualizando && 'opacity-60')}
      >
        <ArchivosListado
          documentos={visibles}
          idsDescargando={idsDescargando}
          onVerDetalle={(documento) => {
            limpiar();
            setDetalleId(documento.id);
          }}
          onDescargar={(documento) => void descargar(documento)}
          onAplicar={abrirAsistente}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
            Documentos
          </h1>
          <p className="mt-0.5 text-sm text-content-secondary">
            Repositorio de {periodo}. Un mismo archivo puede aplicarse a varias rendiciones.
          </p>
        </div>
        <Button variant="brand" onClick={() => abrirAsistente(null)} className="max-sm:w-full">
          <UploadIcon aria-hidden="true" />
          Cargar documento
        </Button>
      </div>

      <DocumentosNav />

      {aviso !== null && (
        <Alert
          key={aviso.id}
          ref={avisoRef}
          variant={aviso.variante}
          saliendo={aviso.cerrando}
          onCerrar={() => cerrar(aviso.id)}
          onAnimationEnd={(evento) => {
            if (aviso.cerrando && evento.target === evento.currentTarget) quitar(aviso.id);
          }}
        >
          {aviso.texto}
        </Alert>
      )}

      <div
        role="search"
        aria-label="Filtrar archivos"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idBusqueda} className="text-sm font-medium">
            Buscar por nombre
          </label>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={idBusqueda}
              type="search"
              value={busqueda}
              onChange={(evento) => setBusqueda(evento.target.value)}
              placeholder="Nombre del archivo"
              className="pl-9"
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idMes} className="text-sm font-medium">
            Mes
          </label>
          <Select
            id={idMes}
            value={String(mes)}
            onValueChange={(valor) => elegirPeriodo({ anio, mes: Number(valor) })}
            options={opcionesDeMes}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idAnio} className="text-sm font-medium">
            Año
          </label>
          <Select
            id={idAnio}
            value={String(anio)}
            onValueChange={(valor) => elegirPeriodo({ anio: Number(valor), mes })}
            options={anios}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={idTipo} className="text-sm font-medium">
            Tipo de documento
          </label>
          <Select
            id={idTipo}
            value={tipoDocumentoId ?? ''}
            onValueChange={(valor) => elegirTipo(valor === '' ? undefined : valor)}
            options={opcionesDeTipo}
          />
        </div>
      </div>

      <p role="status" className="text-xs text-content-secondary">
        {actualizando
          ? 'Actualizando…'
          : documentos === undefined
            ? ''
            : `${visibles.length} de ${documentos.length} ${documentos.length === 1 ? 'archivo' : 'archivos'} en ${periodo}`}
      </p>

      {contenido}

      <DocumentoDetalleSheet
        documentoId={detalleId}
        onCerrar={() => setDetalleId(null)}
        onDescargar={(documento) => void descargar(documento)}
        descargando={detalleId !== null && idsDescargando.includes(detalleId)}
        onAplicar={abrirAsistente}
      />
      {asistente.sesion > 0 && (
        <AplicarDocumentoAsistente
          key={asistente.sesion}
          abierto={asistente.abierto}
          documentoInicial={asistente.documento}
          periodoInicial={{ anio, mes }}
          onTerminar={alTerminarAsistente}
        />
      )}
    </div>
  );
}
