import type { RequisitoCliente } from '@realpolitik/shared';
import { ArrowLeftIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router';

import { ClientesNav } from '@/components/layout/ClientesNav';
import { Alert } from '@/components/ui/alert';
import { useAvisoDePagina } from '@/hooks/use-aviso-de-pagina';
import { causaDeError, diagnosticoDeError } from '@/lib/errores-api';
import { enfocarYMostrar } from '@/lib/focus';
import { ApiClientError } from '@/lib/http';
import { esIdDeRuta } from '@/modules/clientes/api/clientes.api';
import { interpretarFalloRequisito } from '@/modules/clientes/api/requisitos.api';
import { mensajeFalloBaja } from '@/modules/clientes/components/erroresDeRequisito';
import { MatrizEncabezado } from '@/modules/clientes/components/MatrizEncabezado';
import {
  MatrizCargando,
  MatrizClienteAusente,
  MatrizEnlaceInvalido,
  MatrizError,
  MatrizVacia,
} from '@/modules/clientes/components/MatrizEstados';
import { MatrizListado } from '@/modules/clientes/components/MatrizListado';
import {
  QuitarRequisitoDialog,
  type ResultadoBaja,
} from '@/modules/clientes/components/QuitarRequisitoDialog';
import { RequisitoSheet, type ModoRequisito } from '@/modules/clientes/components/RequisitoSheet';
import { useCliente } from '@/modules/clientes/hooks/useCliente';
import { useEliminarRequisito } from '@/modules/clientes/hooks/useEliminarRequisito';
import { useRequisitos } from '@/modules/clientes/hooks/useRequisitos';
import { busquedaParaVolver } from '@/modules/clientes/matriz.navegacion';

/** Un 404 del detalle: el cliente no existe o ya fue dado de baja. */
function esClienteAusente(error: unknown): boolean {
  return error instanceof ApiClientError && error.kind === 'http' && error.status === 404;
}

/**
 * Matriz de requisitos de un cliente (`/clientes/:id/matriz`). Consulta, alta, edición y baja
 * lógica. Los datos salen de `useCliente` y `useRequisitos`. Un cliente que no está activo se
 * lee y no se modifica.
 */
export function MatrizPage() {
  const { id } = useParams();
  const location = useLocation();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  const agregarRef = useRef<HTMLButtonElement>(null);
  const retornoRef = useRef<HTMLElement | null>(null);
  const avisoRef = useRef<HTMLDivElement>(null);
  const aviso = useAvisoDePagina({ avisoRef, destinoDelFoco: tituloRef });
  const [modo, setModo] = useState<ModoRequisito | null>(null);
  const [requisitoAQuitar, setRequisitoAQuitar] = useState<RequisitoCliente | null>(null);
  const eliminar = useEliminarRequisito();
  const idValido = esIdDeRuta(id);
  const clienteQuery = useCliente(id, { enabled: idValido });
  const clienteAusente = clienteQuery.isError && esClienteAusente(clienteQuery.error);
  // En paralelo con el cliente, salvo que ya se sepa que no existe o el id no sirve.
  // Si el cliente falla, esta consulta no se muestra: un 404 no se suma a otro error.
  const requisitosQuery = useRequisitos(id, { enabled: idValido && !clienteQuery.isError });

  const cliente = clienteQuery.data;
  // A qué título llevar el foco. Cambia al pasar de carga a cliente, de error a éxito y de un
  // id a otro: si el botón que tenía el foco desaparece, el h1 lo recibe.
  const anclaDeFoco = !idValido
    ? 'invalido'
    : clienteAusente
      ? 'ausente'
      : clienteQuery.isError
        ? 'error-cliente'
        : cliente !== undefined && requisitosQuery.isError
          ? 'error-requisitos'
          : cliente !== undefined
            ? 'cliente'
            : null;

  useEffect(() => {
    if (anclaDeFoco === null) {
      return;
    }
    enfocarYMostrar(tituloRef.current);
  }, [anclaDeFoco, id]);

  const search = busquedaParaVolver(location.state);
  const volver = search === '' ? '/clientes' : { pathname: '/clientes', search };
  const puedeModificar = cliente?.estado === 'ACTIVO' && requisitosQuery.isSuccess;

  function abrirAlta() {
    aviso.limpiar();
    setRequisitoAQuitar(null);
    retornoRef.current = agregarRef.current ?? tituloRef.current;
    setModo({ tipo: 'alta' });
  }

  function abrirEdicion(requisito: RequisitoCliente) {
    aviso.limpiar();
    setRequisitoAQuitar(null);
    retornoRef.current =
      document.getElementById(`acciones-requisito-${requisito.id}`) ?? tituloRef.current;
    setModo({ tipo: 'edicion', requisito });
  }

  function abrirQuitar(requisito: RequisitoCliente) {
    aviso.limpiar();
    setModo(null);
    retornoRef.current =
      document.getElementById(`acciones-requisito-${requisito.id}`) ?? tituloRef.current;
    setRequisitoAQuitar(requisito);
  }

  async function confirmarBaja(requisito: RequisitoCliente): Promise<ResultadoBaja> {
    if (cliente === undefined) {
      return {
        tipo: 'error',
        mensaje: 'No pudimos quitar el requisito de la matriz. Probá de nuevo en unos segundos.',
      };
    }
    try {
      await eliminar.mutateAsync({ clienteId: cliente.id, requisitoId: requisito.id });
    } catch (error) {
      const resultado = mensajeFalloBaja(interpretarFalloRequisito(error));
      if (!resultado.cierra) return { tipo: 'error', mensaje: resultado.texto };
      aviso.avisar('destructive', resultado.texto);
      setRequisitoAQuitar(null);
      return { tipo: 'cerrado' };
    }
    aviso.avisar(
      'success',
      `Se quitó ${requisito.tipoDocumento.nombre} de la matriz. Las rendiciones ya abiertas no cambian.`,
    );
    setRequisitoAQuitar(null);
    return { tipo: 'hecho' };
  }

  let contenido: ReactNode;
  if (!idValido) {
    contenido = <MatrizEnlaceInvalido tituloRef={tituloRef} />;
  } else if (clienteQuery.isLoading || (cliente === undefined && !clienteQuery.isError)) {
    contenido = (
      <>
        <h1 ref={tituloRef} tabIndex={-1} className="sr-only">
          Matriz de requisitos
        </h1>
        <MatrizCargando incluirEncabezado />
      </>
    );
  } else if (clienteAusente) {
    contenido = <MatrizClienteAusente tituloRef={tituloRef} />;
  } else if (clienteQuery.isError || cliente === undefined) {
    contenido = (
      <>
        <h1 ref={tituloRef} tabIndex={-1} className="text-xl font-semibold tracking-tight">
          Matriz de requisitos
        </h1>
        <MatrizError
          recurso="cliente"
          causa={causaDeError(clienteQuery.error)}
          diagnostico={diagnosticoDeError(clienteQuery.error)}
          onReintentar={() => void clienteQuery.refetch()}
        />
      </>
    );
  } else if (requisitosQuery.isError) {
    contenido = (
      <>
        <MatrizEncabezado cliente={cliente} tituloRef={tituloRef} />
        <MatrizError
          recurso="requisitos"
          causa={causaDeError(requisitosQuery.error)}
          diagnostico={diagnosticoDeError(requisitosQuery.error)}
          onReintentar={() => void requisitosQuery.refetch()}
        />
      </>
    );
  } else if (!requisitosQuery.isSuccess) {
    contenido = (
      <>
        <MatrizEncabezado cliente={cliente} tituloRef={tituloRef} />
        <MatrizCargando incluirEncabezado={false} />
      </>
    );
  } else if (requisitosQuery.data.length === 0) {
    contenido = (
      <>
        <MatrizEncabezado
          cliente={cliente}
          tituloRef={tituloRef}
          onAgregar={puedeModificar ? abrirAlta : undefined}
          agregarRef={agregarRef}
        />
        <MatrizVacia />
      </>
    );
  } else {
    contenido = (
      <>
        <MatrizEncabezado
          cliente={cliente}
          tituloRef={tituloRef}
          onAgregar={puedeModificar ? abrirAlta : undefined}
          agregarRef={agregarRef}
        />
        <MatrizListado
          denominacion={cliente.denominacion}
          canalDelCliente={cliente.canalEntrega}
          requisitos={requisitosQuery.data}
          acciones={puedeModificar ? { onEditar: abrirEdicion, onQuitar: abrirQuitar } : undefined}
        />
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 pt-5 pb-10 md:px-6 md:pt-6">
      <Link
        to={volver}
        className="inline-flex w-fit items-center gap-1 rounded-chip text-sm text-content-secondary outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30"
      >
        <ArrowLeftIcon aria-hidden="true" />
        Volver a clientes
      </Link>
      <ClientesNav />
      {aviso.aviso !== null && (
        <Alert
          key={aviso.aviso.id}
          ref={avisoRef}
          variant={aviso.aviso.variante}
          saliendo={aviso.aviso.cerrando}
          onCerrar={() => aviso.cerrar(aviso.aviso?.id ?? 0)}
          onAnimationEnd={(evento) => {
            if (aviso.aviso?.cerrando && evento.target === evento.currentTarget) {
              aviso.quitar(aviso.aviso.id);
            }
          }}
        >
          {aviso.aviso.texto}
        </Alert>
      )}
      {contenido}
      {cliente !== undefined && (
        <>
          <RequisitoSheet
            modo={modo}
            cliente={cliente}
            requisitos={requisitosQuery.data ?? []}
            onClose={() => setModo(null)}
            onGuardado={(texto) => {
              aviso.avisar('success', texto);
              setModo(null);
            }}
            retornoDeFoco={retornoRef}
            onCerrado={() => {
              if (document.activeElement === null || document.activeElement === document.body) {
                enfocarYMostrar(tituloRef.current);
              }
            }}
          />
          <QuitarRequisitoDialog
            requisito={requisitoAQuitar}
            denominacion={cliente.denominacion}
            onConfirmar={confirmarBaja}
            onCancelar={() => setRequisitoAQuitar(null)}
            focoTrasConfirmar={tituloRef}
            focoAlCancelar={retornoRef}
          />
        </>
      )}
    </div>
  );
}
