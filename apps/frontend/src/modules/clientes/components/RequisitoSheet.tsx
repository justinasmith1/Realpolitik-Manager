import type { Cliente, RequisitoCliente } from '@realpolitik/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState, type RefObject } from 'react';

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useExitoBreve } from '@/hooks/use-exito-breve';
import { enfocarYMostrar } from '@/lib/focus';
import { interpretarFalloRequisito } from '@/modules/clientes/api/requisitos.api';
import {
  erroresParaElFormulario,
  mensajeClienteNoActivo,
  type ErroresDeEnvio,
} from '@/modules/clientes/components/erroresDeRequisito';
import { RequisitoForm, type EstadoCatalogo } from '@/modules/clientes/components/RequisitoForm';
import {
  cambiosDeRequisito,
  cuerpoDeAlta,
  hayCambios,
  requisitoAValoresForm,
  valoresInicialesAlta,
  type RequisitoNormalizado,
} from '@/modules/clientes/components/requisitoForm.validation';
import { useActualizarRequisito } from '@/modules/clientes/hooks/useActualizarRequisito';
import { useCrearRequisito } from '@/modules/clientes/hooks/useCrearRequisito';
import { tiposDocumentoQueryKey } from '@/modules/tipos-documento/api/tipos-documento.api';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

const MENSAJE_INESPERADO = 'No pudimos guardar el requisito. Probá de nuevo en unos segundos.';
const AVISO_INACTIVO = 'Este cliente debe estar activo para modificar sus requisitos.';

export type ModoRequisito = { tipo: 'alta' } | { tipo: 'edicion'; requisito: RequisitoCliente };

/**
 * Qué se guardó. El alta lleva el requisito creado (para ofrecer sumarlo a rendiciones); la
 * edición, cómo estaba y cómo quedó (para ofrecer pasar un canal nuevo a las rendiciones).
 */
export type RequisitoGuardado =
  | { tipo: 'alta'; creado: RequisitoCliente }
  | { tipo: 'edicion'; anterior: RequisitoCliente; actualizado: RequisitoCliente };

interface RequisitoSheetProps {
  /** `null` mantiene el panel cerrado. */
  modo: ModoRequisito | null;
  cliente: Cliente;
  requisitos: readonly RequisitoCliente[];
  onClose: () => void;
  /** El texto del aviso y qué se guardó. */
  onGuardado: (texto: string, guardado: RequisitoGuardado) => void;
  /** A dónde vuelve el foco al cerrarse. */
  retornoDeFoco: RefObject<HTMLElement | null>;
  onCerrado?: () => void;
}

function claveDe(modo: ModoRequisito): string {
  return modo.tipo === 'alta' ? 'alta' : modo.requisito.id;
}

/**
 * Panel de alta y de edición. Comparte el formulario. Si hay cambios sin guardar, pide
 * confirmación antes de cerrar. Mientras se guarda o se confirma el éxito, no se cierra.
 */
export function RequisitoSheet({
  modo,
  cliente,
  requisitos,
  onClose,
  onGuardado,
  retornoDeFoco,
  onCerrado,
}: RequisitoSheetProps) {
  const queryClient = useQueryClient();
  const crear = useCrearRequisito();
  const editar = useActualizarRequisito();
  const exito = useExitoBreve();
  const [borrador, setBorrador] = useState(modo);
  const claveEntrante = modo === null ? null : claveDe(modo);
  const claveBorrador = borrador === null ? null : claveDe(borrador);
  if (claveEntrante !== null && claveEntrante !== claveBorrador) setBorrador(modo);
  const [sucio, setSucio] = useState(false);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const [mensajeEstado, setMensajeEstado] = useState<string | null>(null);
  const marcarSucio = useCallback((valor: boolean) => {
    setSucio((actual) => (actual === valor ? actual : valor));
  }, []);
  const modoAlta = borrador?.tipo === 'alta';
  const tipos = useTiposDocumento({}, { enabled: modo !== null && modo.tipo === 'alta' });
  const ocupado = crear.isPending || editar.isPending || exito.activo;
  const claveActual = claveBorrador;
  const [claveReiniciada, setClaveReiniciada] = useState(claveActual);
  if (claveActual !== claveReiniciada) {
    setClaveReiniciada(claveActual);
    setBloqueado(false);
    setMensajeEstado(null);
    setSucio(false);
  }

  function pedirCierre() {
    if (ocupado) return;
    if (sucio) {
      setConfirmarDescarte(true);
      return;
    }
    onClose();
  }

  function refrescarCatalogo(error: unknown) {
    const fallo = interpretarFalloRequisito(error);
    const tocaTipo =
      fallo.tipo === 'no-existe' ||
      (fallo.tipo === 'datos-invalidos' &&
        fallo.detalles.some(
          (detalle) =>
            detalle.campo === 'tipoDocumentoId' || detalle.campo.startsWith('tipoDocumentoId.'),
        ));
    if (tocaTipo) void queryClient.invalidateQueries({ queryKey: tiposDocumentoQueryKey });
  }

  async function guardar(datos: RequisitoNormalizado): Promise<ErroresDeEnvio | undefined> {
    if (borrador === null) return undefined;
    try {
      if (borrador.tipo === 'alta') {
        const creado = await crear.mutateAsync({
          clienteId: cliente.id,
          datos: cuerpoDeAlta(datos),
        });
        await exito.mostrar();
        onGuardado(`Se agregó ${creado.tipoDocumento.nombre} a los requisitos del cliente.`, {
          tipo: 'alta',
          creado,
        });
        return undefined;
      }
      const cambios = cambiosDeRequisito(datos, borrador.requisito);
      if (!hayCambios(cambios)) {
        onClose();
        return undefined;
      }
      const actualizado = await editar.mutateAsync({
        clienteId: cliente.id,
        requisitoId: borrador.requisito.id,
        datos: cambios,
      });
      await exito.mostrar();
      onGuardado(`Se guardaron los cambios de ${actualizado.tipoDocumento.nombre}.`, {
        tipo: 'edicion',
        anterior: borrador.requisito,
        actualizado,
      });
      return undefined;
    } catch (error) {
      const fallo = interpretarFalloRequisito(error);
      if (fallo.tipo === 'cliente-no-activo') {
        setMensajeEstado(mensajeClienteNoActivo(fallo.estado));
        setBloqueado(true);
      }
      if (fallo.tipo === 'no-existe') setBloqueado(true);
      refrescarCatalogo(error);
      return erroresParaElFormulario(fallo, MENSAJE_INESPERADO);
    }
  }

  const activos = (tipos.data ?? []).filter((tipo) => tipo.activo);
  const asignados = new Set(requisitos.map((requisito) => requisito.tipoDocumento.id));
  const disponibles = activos.filter((tipo) => !asignados.has(tipo.id));
  let estadoTipos: EstadoCatalogo = 'oculto';
  if (modoAlta) {
    if (tipos.isLoading) estadoTipos = 'cargando';
    else if (tipos.isError) estadoTipos = 'error';
    else if (tipos.isSuccess && activos.length === 0) estadoTipos = 'sin-activos';
    else if (tipos.isSuccess && disponibles.length === 0) estadoTipos = 'todos-asignados';
    else if (tipos.isSuccess) estadoTipos = 'listo';
  }

  const avisoEstado = mensajeEstado ?? (cliente.estado !== 'ACTIVO' ? AVISO_INACTIVO : null);
  const iniciales = useMemo(
    () =>
      borrador === null || borrador.tipo === 'alta'
        ? valoresInicialesAlta
        : requisitoAValoresForm(borrador.requisito),
    [borrador],
  );
  const titulo = modoAlta ? 'Agregar requisito' : 'Editar requisito';
  const descripcion = modoAlta
    ? 'Elegí el documento y cómo se pide en cada rendición.'
    : `Modificá la cantidad, los días, el canal o la nota de ${borrador?.tipo === 'edicion' ? borrador.requisito.tipoDocumento.nombre : 'este requisito'}. El tipo de documento no cambia.`;

  return (
    <>
      <Sheet
        open={modo !== null}
        onOpenChange={(abrir) => {
          if (abrir || confirmarDescarte) return;
          pedirCierre();
        }}
        onOpenChangeComplete={(abierto) => {
          if (abierto) return;
          exito.reiniciar();
          setConfirmarDescarte(false);
          setBorrador(null);
          onCerrado?.();
          if (document.activeElement === null || document.activeElement === document.body) {
            enfocarYMostrar(retornoDeFoco.current);
          }
        }}
      >
        <SheetContent
          finalFocus={retornoDeFoco}
          className="data-[side=right]:w-full data-[side=right]:sm:max-w-lg"
        >
          <SheetHeader>
            <SheetTitle>{titulo}</SheetTitle>
            <SheetDescription>{descripcion}</SheetDescription>
          </SheetHeader>
          {borrador !== null && (
            <RequisitoForm
              key={claveDe(borrador)}
              modo={borrador.tipo}
              valoresIniciales={iniciales}
              estadoTipos={estadoTipos}
              tiposDisponibles={disponibles}
              onReintentarTipos={() => void tipos.refetch()}
              canalDelCliente={cliente.canalEntrega}
              tipoLectura={borrador.tipo === 'edicion' ? borrador.requisito.tipoDocumento : null}
              onSubmit={guardar}
              onCancel={pedirCierre}
              onDirtyChange={marcarSucio}
              textoEnviar={borrador.tipo === 'alta' ? 'Agregar requisito' : 'Guardar cambios'}
              textoEnviando={borrador.tipo === 'alta' ? 'Agregando…' : 'Guardando…'}
              exito={exito.activo}
              envioBloqueado={bloqueado || cliente.estado !== 'ACTIVO'}
              avisoEstado={avisoEstado}
            />
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={confirmarDescarte}
        onOpenChange={(abrir) => {
          if (!abrir) setConfirmarDescarte(false);
        }}
      >
        <AlertDialogContent className="z-[60]">
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar los cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Si cerrás ahora, se pierde lo que todavía no guardaste.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuar editando</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmarDescarte(false);
                setSucio(false);
                onClose();
              }}
            >
              Descartar cambios
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
