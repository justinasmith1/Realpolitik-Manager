import type { TipoDocumento } from '@realpolitik/shared';
import { PlusIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { ClientesNav } from '@/components/layout/ClientesNav';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useAvisoDePagina } from '@/hooks/use-aviso-de-pagina';
import { causaDeError, diagnosticoDeError } from '@/lib/errores-api';
import { cn } from '@/lib/utils';
import { interpretarFalloCambioEstadoTipoDocumento } from '@/modules/tipos-documento/api/tipos-documento.api';
import {
  CambiarEstadoTipoDocumentoDialog,
  type AccionDeEstado,
  type CambioAConfirmar,
  type ResultadoCambioEstado,
} from '@/modules/tipos-documento/components/CambiarEstadoTipoDocumentoDialog';
import { EditarTipoDocumentoSheet } from '@/modules/tipos-documento/components/EditarTipoDocumentoSheet';
import { mensajeFalloCambioEstado } from '@/modules/tipos-documento/components/erroresDeTipoDocumento';
import { NuevoTipoDocumentoSheet } from '@/modules/tipos-documento/components/NuevoTipoDocumentoSheet';
import { TiposDocumentoErrorState } from '@/modules/tipos-documento/components/TiposDocumentoErrorState';
import { TiposDocumentoListado } from '@/modules/tipos-documento/components/TiposDocumentoListado';
import { TiposDocumentoLoadingState } from '@/modules/tipos-documento/components/TiposDocumentoLoadingState';
import { TiposDocumentoSinActivos } from '@/modules/tipos-documento/components/TiposDocumentoSinActivos';
import { TiposDocumentoVacio } from '@/modules/tipos-documento/components/TiposDocumentoVacio';
import {
  useCambiarEstadoTipoDocumento,
  useTiposDocumentoCambiandoEstado,
} from '@/modules/tipos-documento/hooks/useCambiarEstadoTipoDocumento';
import { useFiltroDesactivados } from '@/modules/tipos-documento/hooks/useFiltroDesactivados';
import { useTiposDocumento } from '@/modules/tipos-documento/hooks/useTiposDocumento';

/** El aviso de la página tras cada cambio de estado, con el nombre real del tipo. */
const avisoDeEstado: Record<AccionDeEstado, (nombre: string) => string> = {
  desactivar: (nombre) => `Se desactivó ${nombre}. Ya no se ofrece para requisitos nuevos.`,
  reactivar: (nombre) => `Se reactivó ${nombre}. Ya está disponible para requisitos nuevos.`,
};

/**
 * Catálogo de tipos de documento (HU2.1), dentro de la sección Clientes: por eso el título es
 * "Clientes" y la navegación secundaria marca "Tipos de documento".
 *
 * Además de consultar, se crean tipos ("Nuevo tipo"), se editan (desde el nombre o el ⋯) y se
 * desactivan o reactivan con confirmación. Cada operación invalida el catálogo (lo hacen los
 * hooks) y deja un aviso sobre el listado. Los paneles y el diálogo viven acá, fuera del listado y
 * de sus menús: así no se desmontan al cerrarse un menú, y nunca hay dos abiertos a la vez.
 */
export function TiposDocumentoPage() {
  const idIncluirDesactivados = useId();
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [tipoAEditar, setTipoAEditar] = useState<TipoDocumento | null>(null);
  const [cambioAConfirmar, setCambioAConfirmar] = useState<CambioAConfirmar | null>(null);
  // Destino estable del foco cuando lo que lo tenía desaparece: la fila que salió del listado
  // al desactivarla, o el botón de cerrar del aviso.
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const {
    aviso,
    avisar,
    limpiar: limpiarAviso,
    cerrar: cerrarAviso,
    quitar: quitarAviso,
  } = useAvisoDePagina({ avisoRef, destinoDelFoco: tituloRef });

  const { incluirDesactivados, cambiarIncluirDesactivados } = useFiltroDesactivados();
  const consulta = useTiposDocumento({ incluirInactivos: incluirDesactivados });
  const cambioDeEstado = useCambiarEstadoTipoDocumento();
  const idsCambiandoEstado = useTiposDocumentoCambiandoEstado();

  // Empezar otra acción retira el resultado de la anterior, y cierra lo que hubiera abierto.
  const abrirAlta = () => {
    limpiarAviso();
    setAltaAbierta(true);
  };

  const abrirEdicion = (tipo: TipoDocumento) => {
    limpiarAviso();
    setCambioAConfirmar(null);
    setTipoAEditar(tipo);
  };

  const pedirCambioDeEstado = (tipo: TipoDocumento, accion: AccionDeEstado) => {
    limpiarAviso();
    setTipoAEditar(null);
    setCambioAConfirmar({ tipo, accion });
  };

  const alCrear = (tipo: TipoDocumento) => {
    avisar('success', `Se creó el tipo ${tipo.nombre}. Ya está disponible para las matrices.`);
    setAltaAbierta(false);
  };

  const alActualizar = (tipo: TipoDocumento) => {
    avisar('success', `Se guardaron los cambios del tipo ${tipo.nombre}.`);
    setTipoAEditar(null);
  };

  /**
   * Desde el diálogo de confirmación. Un error inesperado queda en el diálogo, para reintentar.
   * Si salió bien o el tipo ya no existe (no hay nada que reintentar), se cierra y se avisa en la
   * página. El listado se refresca desde el hook (también ante el 404).
   */
  const confirmarCambio = async ({
    tipo,
    accion,
  }: CambioAConfirmar): Promise<ResultadoCambioEstado> => {
    limpiarAviso();
    try {
      // Resuelve con el cambio hecho y el catálogo ya vuelto a pedir.
      await cambioDeEstado.mutateAsync({ id: tipo.id, activo: accion === 'reactivar' });
    } catch (error) {
      const fallo = interpretarFalloCambioEstadoTipoDocumento(error);
      const mensaje = mensajeFalloCambioEstado(fallo, accion);
      if (fallo.tipo === 'inesperado') {
        return { tipo: 'error', mensaje };
      }
      avisar('destructive', mensaje);
      setCambioAConfirmar(null);
      return { tipo: 'no-existe' };
    }
    avisar('success', avisoDeEstado[accion](tipo.nombre));
    setCambioAConfirmar(null);
    return { tipo: 'hecho' };
  };

  const tipos = consulta.data;
  // Mientras se pide el filtro nuevo, `data` es la respuesta del anterior: se sigue mostrando
  // (la lista no parpadea), pero no sirve para concluir que no hay resultados.
  const actualizando = consulta.isPlaceholderData;
  const vacio = tipos?.length === 0 && !actualizando;
  const sinActivos = vacio && !incluirDesactivados;
  // Sin activos todavía no se sabe si el catálogo está vacío o si están todos desactivados: se
  // pide el catálogo completo, solo en ese caso. Es la misma key que la vista con desactivados,
  // así que "Ver desactivados" ya la encuentra en caché.
  const todos = useTiposDocumento({ incluirInactivos: true }, { enabled: sinActivos });
  // Un dato viejo (de antes de una invalidación) no sirve: se espera el fresco.
  const verificandoDesactivados = sinActivos && (todos.isPending || todos.isFetching);

  let contenido: ReactNode;
  if (consulta.isPending || verificandoDesactivados || (tipos?.length === 0 && actualizando)) {
    contenido = <TiposDocumentoLoadingState />;
  } else if (consulta.isError) {
    contenido = (
      <TiposDocumentoErrorState
        causa={causaDeError(consulta.error)}
        diagnostico={diagnosticoDeError(consulta.error)}
        onReintentar={() => void consulta.refetch()}
      />
    );
  } else if (sinActivos) {
    // Con los activos vacíos, todo lo que trae el catálogo completo está desactivado.
    const cantidadDesactivados = todos.isError ? null : (todos.data?.length ?? 0);
    contenido =
      cantidadDesactivados === 0 ? (
        <TiposDocumentoVacio onNuevoTipo={abrirAlta} />
      ) : (
        <TiposDocumentoSinActivos
          cantidadDesactivados={cantidadDesactivados}
          onVerDesactivados={() => cambiarIncluirDesactivados(true)}
        />
      );
  } else if (vacio) {
    contenido = <TiposDocumentoVacio onNuevoTipo={abrirAlta} />;
  } else {
    contenido = (
      <div
        aria-busy={actualizando}
        className={cn('transition-opacity', actualizando && 'opacity-60')}
      >
        <TiposDocumentoListado
          tipos={tipos ?? []}
          idsCambiandoEstado={idsCambiandoEstado}
          onEditar={abrirEdicion}
          onDesactivar={(tipo) => pedirCambioDeEstado(tipo, 'desactivar')}
          onReactivar={(tipo) => pedirCambioDeEstado(tipo, 'reactivar')}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
            Clientes
          </h1>
          <p className="mt-0.5 text-sm text-content-secondary">
            Tipos de documento que se pueden pedir en una matriz.
          </p>
        </div>
        <Button variant="brand" onClick={abrirAlta} className="max-sm:w-full">
          <PlusIcon aria-hidden="true" />
          Nuevo tipo
        </Button>
      </div>

      <ClientesNav />

      <p className="max-w-160 text-sm text-content-secondary">
        Catálogo de tipos que se pueden pedir en una matriz. No se permiten nombres repetidos,
        aunque cambien mayúsculas o acentos.
      </p>

      {aviso !== null && (
        <Alert
          // Un aviso nuevo es otro elemento: entra con su animación y no hereda la salida del
          // anterior.
          key={aviso.id}
          ref={avisoRef}
          variant={aviso.variante}
          saliendo={aviso.cerrando}
          onCerrar={() => cerrarAviso(aviso.id)}
          onAnimationEnd={(evento) => {
            if (aviso.cerrando && evento.target === evento.currentTarget) {
              quitarAviso(aviso.id);
            }
          }}
        >
          {aviso.texto}
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="inline-flex min-h-11 items-center gap-2 text-sm md:min-h-9">
          <Checkbox
            id={idIncluirDesactivados}
            checked={incluirDesactivados}
            onCheckedChange={(marcado) => cambiarIncluirDesactivados(marcado)}
          />
          <label htmlFor={idIncluirDesactivados} className="cursor-pointer">
            Incluir desactivados
          </label>
        </div>
        <p role="status" className="text-xs text-content-secondary">
          {actualizando ? 'Actualizando…' : ''}
        </p>
      </div>

      {contenido}

      <NuevoTipoDocumentoSheet
        abierto={altaAbierta}
        onAbiertoChange={setAltaAbierta}
        onCreado={alCrear}
      />
      <EditarTipoDocumentoSheet
        tipo={tipoAEditar}
        onClose={() => setTipoAEditar(null)}
        onActualizado={alActualizar}
      />
      <CambiarEstadoTipoDocumentoDialog
        cambio={cambioAConfirmar}
        onConfirmar={confirmarCambio}
        onCancelar={() => setCambioAConfirmar(null)}
        focoTrasConfirmar={tituloRef}
      />
    </div>
  );
}
