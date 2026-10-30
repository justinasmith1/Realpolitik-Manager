import type { CandidatoAplicacion, Documento } from '@realpolitik/shared';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, UploadIcon } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { LoadingButton } from '@/components/ui/loading-button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  interpretarFalloAplicacion,
  interpretarFalloCarga,
} from '@/modules/documentos/api/documentos.api';
import {
  mensajeFalloAplicacion,
  mensajeFalloCarga,
} from '@/modules/documentos/components/erroresDeDocumentos';
import {
  PasoArchivo,
  PasoConfirmar,
  PasoDondeAplica,
  type Origen,
  type Periodo,
} from '@/modules/documentos/components/PasosDeAplicacion';
import { PasosDelAsistente } from '@/modules/documentos/components/PasosDelAsistente';
import { problemaDelArchivo, resumenDeSeleccion } from '@/modules/documentos/documentos.etiquetas';
import {
  useAplicarDocumento,
  useCandidatos,
  useCargarDocumento,
} from '@/modules/documentos/hooks/useDocumentos';
import { nombreDeItem } from '@/modules/rendiciones/rendiciones.etiquetas';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

const PASOS = ['Archivo y tipo', 'Dónde aplica', 'Confirmar'] as const;

/** Cómo terminó el asistente, para que la página avise. */
export type ResultadoDelAsistente =
  | { tipo: 'cancelado' }
  /** Se subió un archivo y no se aplicó: quedó en el repositorio. */
  | { tipo: 'guardado'; documento: Documento }
  | { tipo: 'aplicado'; documento: Documento; items: number; rendiciones: number };

interface AplicarDocumentoAsistenteProps {
  abierto: boolean;
  /** Un documento ya cargado (desde el repositorio o su detalle): arranca en "Dónde aplica". */
  documentoInicial: Documento | null;
  /** Período con el que arranca (el que se está mirando en el repositorio). */
  periodoInicial: Periodo;
  onTerminar: (resultado: ResultadoDelAsistente) => void;
}

/** Cuántas rendiciones distintas hay entre los candidatos elegidos. */
const contarRendiciones = (elegidos: readonly CandidatoAplicacion[]) =>
  new Set(elegidos.map((c) => c.rendicion.id)).size;

/**
 * Asistente para aplicar un documento a varios ítems (HU2.8): archivo y tipo → dónde aplica →
 * confirmar. Quien lo usa lo vuelve a montar (con otra `key`) en cada apertura: siempre empieza
 * limpio.
 *
 * Un archivo nuevo se sube al final del paso 1, con un botón explícito ("Subir y continuar"): los
 * candidatos y el aviso de duplicados salen de la API para ese documento. Desde ahí el archivo ya
 * está en el repositorio: volver al paso 1, cerrar o fallar al aplicar NO lo vuelve a subir. Nunca
 * se aplica sin la confirmación del paso 3.
 */
export function AplicarDocumentoAsistente({
  abierto,
  documentoInicial,
  periodoInicial,
  onTerminar,
}: AplicarDocumentoAsistenteProps) {
  const [paso, setPaso] = useState<1 | 2 | 3>(documentoInicial === null ? 1 : 2);
  const [origen, setOrigen] = useState<Origen>('nuevo');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [errorArchivo, setErrorArchivo] = useState<string | null>(null);
  const [tipoDocumentoId, setTipoDocumentoId] = useState('');
  const [errorTipo, setErrorTipo] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<Periodo>(documentoInicial ?? periodoInicial);
  /** El documento subido en esta sesión (si lo hubo): ya está en el repositorio. */
  const [cargado, setCargado] = useState<Documento | null>(null);
  const [duplicados, setDuplicados] = useState<Documento[]>([]);
  /** Existente elegido en el paso 1. */
  const [elegido, setElegido] = useState<Documento | null>(null);
  /** El documento que se va a aplicar. */
  const [documento, setDocumento] = useState<Documento | null>(documentoInicial);
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  const [avisoDeSeleccion, setAvisoDeSeleccion] = useState<string | null>(null);
  const [errorPaso, setErrorPaso] = useState<string | null>(null);

  const tipos = useTiposDocumento();
  const opcionesDeTipo = useMemo(
    () => (tipos.data ?? []).map((tipo) => ({ value: tipo.id, label: tipo.nombre })),
    [tipos.data],
  );
  const carga = useCargarDocumento();
  const aplicacion = useAplicarDocumento();
  // Recién desde el paso 2: en el 1 el documento todavía puede cambiar (un duplicado).
  const candidatos = useCandidatos(paso === 1 ? null : (documento?.id ?? null));
  const enCurso = carga.isPending || aplicacion.isPending;

  const elegidos = (candidatos.data ?? []).filter((c) => seleccion.has(c.item.id));

  const terminar = (resultado: ResultadoDelAsistente) => {
    if (enCurso) return;
    onTerminar(resultado);
  };
  const cerrar = () =>
    terminar(cargado === null ? { tipo: 'cancelado' } : { tipo: 'guardado', documento: cargado });

  const irAlPaso = (siguiente: 1 | 2 | 3) => {
    setErrorPaso(null);
    setPaso(siguiente);
  };

  /** Usar `doc` y pasar a elegir dónde: la selección anterior era de otro documento. */
  const continuarCon = (doc: Documento) => {
    if (doc.id !== documento?.id) {
      setSeleccion(new Set());
      setAvisoDeSeleccion(null);
    }
    setDocumento(doc);
    irAlPaso(2);
  };

  // ─── Paso 1 ───

  const subirYContinuar = async () => {
    setErrorPaso(null);
    const problema = archivo === null ? 'Elegí el archivo.' : problemaDelArchivo(archivo);
    const sinTipo = tipoDocumentoId === '' ? 'Elegí el tipo de documento.' : null;
    setErrorArchivo(problema);
    setErrorTipo(sinTipo);
    if (problema !== null || sinTipo !== null || archivo === null) return;

    try {
      const resultado = await carga.mutateAsync({ archivo, tipoDocumentoId, ...periodo });
      setCargado(resultado.documento);
      setDocumento(resultado.documento);
      if (resultado.posiblesDuplicados.length > 0) {
        // Se queda en el paso 1 para decidir cuál usar.
        setDuplicados(resultado.posiblesDuplicados);
        return;
      }
      continuarCon(resultado.documento);
    } catch (error) {
      const fallo = interpretarFalloCarga(error);
      const mensaje = mensajeFalloCarga(fallo);
      if (fallo.tipo === 'archivo' || fallo.tipo === 'demasiado-grande') setErrorArchivo(mensaje);
      else if (fallo.tipo === 'tipo-inexistente' || fallo.tipo === 'tipo-inactivo') {
        setErrorTipo(mensaje);
      } else setErrorPaso(mensaje);
    }
  };

  const siguienteDesdePaso1 = () => {
    if (origen === 'existente') {
      if (elegido === null) {
        setErrorPaso('Elegí un documento del repositorio.');
        return;
      }
      continuarCon(elegido);
      return;
    }
    if (cargado !== null) {
      continuarCon(documento ?? cargado);
      return;
    }
    void subirYContinuar();
  };

  // ─── Paso 3 ───

  /** Cómo se nombra un ítem en un mensaje: "Print 2 de 5 de Municipio X (factura B 00002-…)". */
  const describirItem = (itemId: string): string | null => {
    const candidato = candidatos.data?.find((c) => c.item.id === itemId);
    if (candidato === undefined) return null;
    return `${nombreDeItem(candidato.item)} de ${candidato.cliente.denominacion} (factura ${candidato.rendicion.numeroFactura})`;
  };

  const confirmar = async () => {
    if (documento === null || elegidos.length === 0) return;
    setErrorPaso(null);
    const itemIds = elegidos.map((c) => c.item.id);
    const clienteIds = [...new Set(elegidos.map((c) => c.cliente.id))];
    try {
      await aplicacion.mutateAsync({ documentoId: documento.id, itemIds, clienteIds });
      onTerminar({
        tipo: 'aplicado',
        documento,
        items: itemIds.length,
        rendiciones: contarRendiciones(elegidos),
      });
    } catch (error) {
      const fallo = interpretarFalloAplicacion(error);
      const mensaje = mensajeFalloAplicacion(fallo, describirItem);
      if (fallo.tipo === 'rechazado' || fallo.tipo === 'no-existe') {
        // Algo cambió mientras tanto: se vuelve a elegir con los candidatos de ahora. El
        // documento ya está cargado y no se vuelve a subir.
        const actuales = await candidatos.refetch();
        const disponibles = new Set((actuales.data ?? []).map((c) => c.item.id));
        setSeleccion((previa) => new Set([...previa].filter((id) => disponibles.has(id))));
        setAvisoDeSeleccion(
          `${mensaje} Se quitó de la selección lo que ya no está disponible: revisá y confirmá de nuevo.`,
        );
        irAlPaso(2);
        return;
      }
      setErrorPaso(mensaje);
    }
  };

  const alternar = (itemId: string, marcado: boolean) => {
    setSeleccion((previa) => {
      const siguiente = new Set(previa);
      if (marcado) siguiente.add(itemId);
      else siguiente.delete(itemId);
      return siguiente;
    });
  };

  const titulo = documentoInicial === null ? 'Cargar y aplicar un documento' : 'Aplicar documento';

  return (
    <Sheet
      open={abierto}
      onOpenChange={(abrir) => {
        if (!abrir) cerrar();
      }}
    >
      <SheetContent className="flex h-full w-full flex-col gap-0 p-0 sm:max-w-none md:max-w-2xl">
        <SheetHeader className="border-b px-6 py-4">
          <SheetTitle>{titulo}</SheetTitle>
          <SheetDescription>
            Un archivo se carga una sola vez y se aplica a los ítems que elijas, de uno o varios
            clientes.
          </SheetDescription>
          <PasosDelAsistente pasos={PASOS} actual={paso} />
        </SheetHeader>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-4">
          {errorPaso !== null && paso !== 3 && <Alert>{errorPaso}</Alert>}
          {paso === 1 && (
            <PasoArchivo
              origen={origen}
              onOrigen={(nuevo) => {
                setErrorPaso(null);
                setOrigen(nuevo);
              }}
              cargado={cargado}
              archivo={archivo}
              onArchivo={(nuevo) => {
                setArchivo(nuevo);
                setErrorArchivo(nuevo === null ? null : problemaDelArchivo(nuevo));
              }}
              errorArchivo={errorArchivo}
              tipoDocumentoId={tipoDocumentoId}
              onTipo={(tipo) => {
                setTipoDocumentoId(tipo);
                setErrorTipo(null);
              }}
              opcionesDeTipo={opcionesDeTipo}
              tiposCargando={tipos.isPending}
              errorTipo={errorTipo}
              periodo={periodo}
              onPeriodo={(nuevo) => {
                setPeriodo(nuevo);
                setElegido(null);
              }}
              duplicados={duplicados}
              onUsarDuplicado={continuarCon}
              elegido={elegido}
              onElegir={(doc) => {
                setErrorPaso(null);
                setElegido(doc);
              }}
            />
          )}
          {paso === 2 && documento !== null && (
            <PasoDondeAplica
              documento={documento}
              candidatos={candidatos.data}
              cargando={candidatos.isPending}
              error={candidatos.isError}
              onReintentar={() => void candidatos.refetch()}
              seleccion={seleccion}
              onAlternar={alternar}
              aviso={avisoDeSeleccion}
            />
          )}
          {paso === 3 && documento !== null && (
            <PasoConfirmar documento={documento} elegidos={elegidos} error={errorPaso} />
          )}
        </div>

        <SheetFooter className="flex flex-row flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          {paso === 1 || (paso === 2 && documentoInicial !== null) ? (
            <Button type="button" variant="ghost" onClick={cerrar} disabled={enCurso}>
              {cargado === null ? 'Cancelar' : 'Cerrar sin aplicar'}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              onClick={() => irAlPaso(paso === 3 ? 2 : 1)}
              disabled={enCurso}
            >
              <ArrowLeftIcon aria-hidden="true" />
              Atrás
            </Button>
          )}

          <div className="flex flex-wrap items-center gap-3">
            {paso === 2 && (
              <p role="status" className="text-sm text-content-secondary">
                {elegidos.length === 0
                  ? 'Ningún ítem elegido'
                  : resumenDeSeleccion(elegidos.length, contarRendiciones(elegidos))}
              </p>
            )}
            {paso === 3 && (
              <p className="text-sm text-content-secondary">Nunca se aplica sin tu confirmación.</p>
            )}

            {paso === 1 &&
              (origen === 'nuevo' && cargado === null ? (
                <LoadingButton
                  type="button"
                  variant="brand"
                  loading={carga.isPending}
                  loadingText="Subiendo…"
                  onClick={siguienteDesdePaso1}
                >
                  <UploadIcon aria-hidden="true" />
                  Subir y continuar
                </LoadingButton>
              ) : (
                <Button type="button" variant="brand" onClick={siguienteDesdePaso1}>
                  Siguiente
                  <ArrowRightIcon aria-hidden="true" />
                </Button>
              ))}
            {paso === 2 && (
              <Button
                type="button"
                variant="brand"
                onClick={() => irAlPaso(3)}
                disabled={elegidos.length === 0}
              >
                Revisar
                <ArrowRightIcon aria-hidden="true" />
              </Button>
            )}
            {paso === 3 && (
              <LoadingButton
                type="button"
                variant="brand"
                loading={aplicacion.isPending}
                loadingText="Aplicando…"
                onClick={() => void confirmar()}
              >
                <CheckIcon aria-hidden="true" />
                Confirmar y aplicar
              </LoadingButton>
            )}
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
