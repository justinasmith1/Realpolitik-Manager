import {
  MAX_BUSQUEDA_USUARIOS,
  RolUsuario,
  type UsuarioAdministrado,
  type UsuarioCreado,
  type UsuarioModificado,
} from '@realpolitik/shared';
import { PlusIcon, RotateCcwIcon, SearchIcon } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';
import { useAvisoDePagina } from '@/hooks/use-aviso-de-pagina';
import { causaDeError, diagnosticoDeError } from '@/lib/errores-api';
import { ApiClientError } from '@/lib/http';
import { cn } from '@/lib/utils';
import { useSesion } from '@/modules/auth/hooks/useSesion';
import { ETIQUETA_DE_ROL } from '@/modules/auth/permisos';
import {
  interpretarFalloDeUsuario,
  type FalloDeUsuario,
} from '@/modules/usuarios/api/usuarios.api';
import {
  ConfirmarAccionUsuarioDialog,
  type AccionAConfirmar,
  type ResultadoDeConfirmacion,
} from '@/modules/usuarios/components/ConfirmarAccionUsuarioDialog';
import {
  ContrasenaTemporalDialog,
  type EntregaDeContrasena,
} from '@/modules/usuarios/components/ContrasenaTemporalDialog';
import { EditarUsuarioSheet } from '@/modules/usuarios/components/EditarUsuarioSheet';
import { avisoDeFallo } from '@/modules/usuarios/components/erroresDeUsuario';
import { NuevoUsuarioSheet } from '@/modules/usuarios/components/NuevoUsuarioSheet';
import {
  UsuariosCargando,
  UsuariosError,
  UsuariosVacio,
} from '@/modules/usuarios/components/UsuariosEstados';
import { UsuariosListado } from '@/modules/usuarios/components/UsuariosListado';
import { useCambiarEstadoUsuario } from '@/modules/usuarios/hooks/useCambiarEstadoUsuario';
import { useRestablecerContrasena } from '@/modules/usuarios/hooks/useContrasenaTemporal';
import { useFiltrosUsuarios } from '@/modules/usuarios/hooks/useFiltrosUsuarios';
import { useUsuarios } from '@/modules/usuarios/hooks/useUsuarios';

const opcionesDeRol: SelectOption[] = [
  { value: '', label: 'Todos' },
  ...RolUsuario.options.map((rol) => ({ value: rol, label: ETIQUETA_DE_ROL[rol] })),
];

/** Fallos con los que reintentar desde el mismo diálogo tiene sentido: no cambió nada. */
const reintentable = (fallo: FalloDeUsuario) =>
  fallo.tipo === 'ocupado' ||
  fallo.tipo === 'concurrencia' ||
  fallo.tipo === 'inesperado' ||
  fallo.tipo === 'sin-sesion';

function avisoDeEdicion({ usuario, modificados, sesionesRevocadas }: UsuarioModificado): string {
  if (modificados.length === 0) return `La cuenta de ${usuario.nombre} ya tenía esos datos.`;
  const sesiones =
    modificados.includes('rol') && sesionesRevocadas > 0
      ? ' Se cerraron sus sesiones abiertas.'
      : '';
  return `Se guardaron los cambios de ${usuario.nombre}.${sesiones}`;
}

/**
 * Administración de usuarios (HU4.5), en `/usuarios`, desde el menú de cuenta. Solo la monta la
 * ruta si la sesión tiene `usuarios:administrar` (ver `router.tsx`); igual, la API decide de verdad.
 *
 * Como en tipos de documento: listado con filtros, alta y edición en paneles, y confirmaciones en
 * diálogos. Todos viven acá, fuera del listado y de sus menús, así no se desmontan al cerrarse un
 * menú y nunca hay dos abiertos a la vez. El alta y el restablecimiento terminan en el diálogo de la
 * contraseña temporal, que se ve una sola vez.
 */
export function UsuariosPage() {
  const idPropio = useSesion().data?.usuario.id ?? '';
  const idIncluirDesactivados = useId();
  const [altaAbierta, setAltaAbierta] = useState(false);
  const [usuarioAEditar, setUsuarioAEditar] = useState<UsuarioAdministrado | null>(null);
  const [accionAConfirmar, setAccionAConfirmar] = useState<AccionAConfirmar | null>(null);
  // La contraseña temporal recién recibida: existe solo mientras su diálogo está abierto.
  const [entrega, setEntrega] = useState<EntregaDeContrasena | null>(null);
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const nuevoRef = useRef<HTMLButtonElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const {
    aviso,
    avisar,
    limpiar: limpiarAviso,
    cerrar: cerrarAviso,
    quitar: quitarAviso,
  } = useAvisoDePagina({ avisoRef, destinoDelFoco: tituloRef });

  const filtrosDeUrl = useFiltrosUsuarios();
  const { filtros, hayBusqueda, hayFiltros } = filtrosDeUrl;
  const consulta = useUsuarios(filtros);
  const cambioDeEstado = useCambiarEstadoUsuario();
  const { restablecer } = useRestablecerContrasena();

  // Empezar otra acción retira el resultado de la anterior.
  const abrirAlta = () => {
    limpiarAviso();
    setAltaAbierta(true);
  };
  const abrirEdicion = (usuario: UsuarioAdministrado) => {
    limpiarAviso();
    setUsuarioAEditar(usuario);
  };
  const pedirConfirmacion = (usuario: UsuarioAdministrado, accion: AccionAConfirmar['accion']) => {
    limpiarAviso();
    setAccionAConfirmar({ usuario, accion });
  };

  const alCrear = ({ usuario, contrasenaTemporal }: UsuarioCreado) => {
    setAltaAbierta(false);
    setEntrega({ origen: 'alta', usuario, contrasena: contrasenaTemporal });
  };

  const alActualizar = (resultado: UsuarioModificado) => {
    avisar('success', avisoDeEdicion(resultado));
    setUsuarioAEditar(null);
  };

  /**
   * Desde el diálogo de confirmación. Lo que se puede reintentar queda en el diálogo; lo demás (un
   * resultado sin confirmar, la cuenta que ya no existe, una regla de negocio) lo cierra y se avisa
   * en la página. El listado se refresca desde los hooks.
   */
  const confirmar = async ({
    usuario,
    accion,
  }: AccionAConfirmar): Promise<ResultadoDeConfirmacion> => {
    limpiarAviso();
    let fallo: FalloDeUsuario;
    if (accion === 'restablecer') {
      const resultado = await restablecer(usuario.id);
      if (resultado === null) return { tipo: 'cerrado' };
      if (resultado.ok) {
        const { usuario: restablecido, contrasenaTemporal } = resultado.respuesta;
        setAccionAConfirmar(null);
        setEntrega({
          origen: 'restablecimiento',
          usuario: restablecido,
          contrasena: contrasenaTemporal,
        });
        return { tipo: 'cerrado' };
      }
      fallo = resultado.fallo;
    } else {
      try {
        const {
          usuario: cambiado,
          cambio,
          sesionesRevocadas,
        } = await cambioDeEstado.mutateAsync({
          id: usuario.id,
          activo: accion === 'reactivar',
        });
        avisar(
          'success',
          !cambio
            ? `La cuenta de ${cambiado.nombre} ya estaba ${cambiado.activo ? 'activa' : 'desactivada'}.`
            : accion === 'desactivar'
              ? `Se desactivó la cuenta de ${cambiado.nombre}.${sesionesRevocadas > 0 ? ' Se cerraron sus sesiones abiertas.' : ''}`
              : `Se reactivó la cuenta de ${cambiado.nombre}.`,
        );
        setAccionAConfirmar(null);
        return { tipo: 'cerrado' };
      } catch (error) {
        fallo = interpretarFalloDeUsuario(error);
      }
    }
    const avisoDelFallo = avisoDeFallo(fallo, accion);
    if (reintentable(fallo)) return { tipo: 'error', aviso: avisoDelFallo };
    avisar(avisoDelFallo.variante, avisoDelFallo.texto);
    setAccionAConfirmar(null);
    return { tipo: 'cerrado' };
  };

  const usuarios = consulta.data;
  // Mientras se pide el filtro nuevo, `data` es la respuesta del anterior: se sigue mostrando,
  // atenuada, pero no sirve para concluir que no hay resultados.
  const actualizando = consulta.isPlaceholderData;
  const sinPermiso =
    consulta.error instanceof ApiClientError &&
    consulta.error.kind === 'http' &&
    consulta.error.status === 403;

  let contenido: ReactNode;
  if (consulta.isPending || (usuarios?.length === 0 && actualizando)) {
    contenido = <UsuariosCargando />;
  } else if (consulta.isError) {
    contenido = (
      <UsuariosError
        causa={sinPermiso ? 'permiso' : causaDeError(consulta.error)}
        diagnostico={diagnosticoDeError(consulta.error)}
        onReintentar={() => void consulta.refetch()}
      />
    );
  } else if (usuarios?.length === 0) {
    contenido = (
      <UsuariosVacio
        hayBusqueda={hayBusqueda}
        incluirDesactivados={filtros.incluirDesactivados}
        onIncluirDesactivados={() => filtrosDeUrl.cambiarIncluirDesactivados(true)}
        onLimpiarFiltros={filtrosDeUrl.limpiar}
      />
    );
  } else {
    contenido = (
      <div
        aria-busy={actualizando}
        className={cn('transition-opacity', actualizando && 'opacity-60')}
      >
        <UsuariosListado
          usuarios={usuarios ?? []}
          idPropio={idPropio}
          onEditar={abrirEdicion}
          onRestablecer={(usuario) => pedirConfirmacion(usuario, 'restablecer')}
          onDesactivar={(usuario) => pedirConfirmacion(usuario, 'desactivar')}
          onReactivar={(usuario) => pedirConfirmacion(usuario, 'reactivar')}
        />
      </div>
    );
  }

  const cantidad = usuarios?.length ?? 0;
  const estadoDelListado =
    usuarios === undefined || consulta.isError
      ? ''
      : actualizando
        ? 'Actualizando…'
        : cantidad === 1
          ? '1 usuario'
          : `${cantidad} usuarios`;

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1
            ref={tituloRef}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight outline-none"
          >
            Usuarios
          </h1>
          <p className="mt-0.5 text-sm text-content-secondary">
            Administrá las cuentas y los permisos de acceso al sistema.
          </p>
        </div>
        <Button ref={nuevoRef} variant="brand" onClick={abrirAlta} className="max-sm:w-full">
          <PlusIcon aria-hidden="true" />
          Nuevo usuario
        </Button>
      </div>

      {aviso !== null && (
        <Alert
          key={aviso.id}
          ref={avisoRef}
          variant={aviso.variante}
          saliendo={aviso.cerrando}
          onCerrar={() => cerrarAviso(aviso.id)}
          onAnimationEnd={(evento) => {
            if (aviso.cerrando && evento.target === evento.currentTarget) quitarAviso(aviso.id);
          }}
        >
          {aviso.texto}
        </Alert>
      )}

      <div
        role="search"
        aria-label="Buscar y filtrar usuarios"
        className="grid grid-cols-1 items-end gap-3 rounded-card border bg-card p-3.5 sm:grid-cols-[minmax(0,1fr)_11rem] lg:grid-cols-[minmax(16rem,30rem)_11rem_auto_auto]"
      >
        <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
          <label
            htmlFor="filtro-usuarios-busqueda"
            className="text-xs font-medium text-content-secondary"
          >
            Buscar usuario
          </label>
          <div className="relative">
            <SearchIcon
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id="filtro-usuarios-busqueda"
              type="search"
              placeholder="Nombre o email"
              maxLength={MAX_BUSQUEDA_USUARIOS}
              value={filtrosDeUrl.textoBusqueda}
              onChange={(evento) => filtrosDeUrl.cambiarTexto(evento.target.value)}
              className="pl-9 text-ellipsis"
            />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <label
            htmlFor="filtro-usuarios-rol"
            className="text-xs font-medium text-content-secondary"
          >
            Rol
          </label>
          <Select
            id="filtro-usuarios-rol"
            value={filtros.rol ?? ''}
            onValueChange={(valor) => filtrosDeUrl.elegirRol(RolUsuario.safeParse(valor).data)}
            options={opcionesDeRol}
          />
        </div>
        <div className="inline-flex min-h-11 items-center gap-2 text-sm md:min-h-9">
          <Checkbox
            id={idIncluirDesactivados}
            checked={filtros.incluirDesactivados}
            onCheckedChange={(marcado) => filtrosDeUrl.cambiarIncluirDesactivados(marcado)}
          />
          <label htmlFor={idIncluirDesactivados} className="cursor-pointer">
            Incluir desactivados
          </label>
        </div>
        {hayFiltros && (
          <Button
            type="button"
            variant="ghost"
            onClick={filtrosDeUrl.limpiar}
            className="max-sm:w-full"
          >
            <RotateCcwIcon aria-hidden="true" />
            Limpiar filtros
          </Button>
        )}
      </div>

      <p role="status" className="-mt-1 text-xs text-content-secondary">
        {estadoDelListado}
      </p>

      {contenido}

      <NuevoUsuarioSheet
        abierto={altaAbierta}
        onAbiertoChange={setAltaAbierta}
        onCreado={alCrear}
      />
      <EditarUsuarioSheet
        usuario={usuarioAEditar}
        propia={usuarioAEditar?.id === idPropio}
        onClose={() => setUsuarioAEditar(null)}
        onActualizado={alActualizar}
      />
      <ConfirmarAccionUsuarioDialog
        accion={accionAConfirmar}
        onConfirmar={confirmar}
        onCancelar={() => setAccionAConfirmar(null)}
        // Si se abrió el diálogo de la contraseña, el foco ya es suyo.
        focoTrasConfirmar={() => (entrega === null ? tituloRef.current : false)}
      />
      <ContrasenaTemporalDialog
        entrega={entrega}
        onCerrar={() => setEntrega(null)}
        // Tras un alta, a "Nuevo usuario"; tras un restablecimiento, al título (el ⋯ de la fila
        // pudo haberse movido con el listado actualizado).
        focoAlCerrar={(origen) => (origen === 'alta' ? nuevoRef.current : tituloRef.current)}
      />
    </div>
  );
}
