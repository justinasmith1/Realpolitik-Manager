import type { CanalEntrega, RequisitoCliente } from '@realpolitik/shared';

import { Badge } from '@/components/ui/badge';
import { useIsCompactLayout } from '@/hooks/use-media-query';
import { CanalEntregaBadge } from '@/modules/clientes/components/CanalEntregaBadge';
import { RequisitoAccionesMenu } from '@/modules/clientes/components/RequisitoAccionesMenu';

/** A partir de acá la celda de la tabla se recorta y se puede abrir. En la tarjeta se lee entera. */
const NOTA_LARGA = 80;

interface AccionesDeMatriz {
  onEditar: (requisito: RequisitoCliente) => void;
  onQuitar: (requisito: RequisitoCliente) => void;
}

interface MatrizListadoProps {
  denominacion: string;
  canalDelCliente: CanalEntrega;
  /** En el orden de la API. No se filtra ni se reordena. */
  requisitos: readonly RequisitoCliente[];
  /** Sin esto la matriz es solo lectura (cliente inactivo o suspendido). */
  acciones?: AccionesDeMatriz | undefined;
}

/** Los días se muestran como llegaron: no son fechas y no se vuelven a ordenar. */
function textoDeDias(dias: readonly number[]): string {
  if (dias.length === 0) {
    return 'Sin días aproximados';
  }
  return dias.join(', ');
}

function NombreDeTipo({ nombre, activo }: { nombre: string; activo: boolean }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <span className="font-medium break-words">{nombre}</span>
      {activo ? null : <Badge tone="muted">Desactivado</Badge>}
    </span>
  );
}

function CanalDeRequisito({ canal, heredado }: { canal: CanalEntrega; heredado: boolean }) {
  return (
    <div className="flex flex-col items-start gap-1">
      <CanalEntregaBadge canal={canal} />
      <span className="text-xs text-content-secondary">
        {heredado ? 'Canal heredado' : 'Canal de este requisito'}
      </span>
    </div>
  );
}

/**
 * Nota del requisito. En la tabla, una nota larga se muestra en dos líneas y se abre en el
 * lugar: el texto completo está en la página, sin un cuadro aparte y sin depender del hover.
 * En la tarjeta se lee entera, porque hay lugar hacia abajo.
 */
function NotaDeRequisito({ nota, completa }: { nota: string | null; completa: boolean }) {
  if (nota === null || nota.trim() === '') {
    return <span className="text-content-secondary">Sin nota</span>;
  }
  if (completa || nota.length <= NOTA_LARGA) {
    return <p className="break-words whitespace-pre-wrap">{nota}</p>;
  }
  return (
    <details className="group max-w-sm">
      <summary className="cursor-pointer rounded-chip break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/30 [&::-webkit-details-marker]:hidden">
        <span className="line-clamp-2 group-open:line-clamp-none group-open:whitespace-pre-wrap">
          {nota}
        </span>
        <span className="mt-1 block text-xs font-medium text-content-secondary underline group-open:hidden">
          Mostrar nota completa
        </span>
        <span className="mt-1 hidden text-xs font-medium text-content-secondary underline group-open:block">
          Ocultar nota
        </span>
      </summary>
    </details>
  );
}

function DatosDeRequisito({
  requisito,
  canalDelCliente,
  completa,
}: {
  requisito: RequisitoCliente;
  canalDelCliente: CanalEntrega;
  completa: boolean;
}) {
  const heredado = requisito.canalEntrega === null;
  return {
    nombre: (
      <NombreDeTipo
        nombre={requisito.tipoDocumento.nombre}
        activo={requisito.tipoDocumento.activo}
      />
    ),
    // Solo el número: la etiqueta ya la ponen el `<dt>` de la tarjeta y el encabezado de la tabla.
    cantidad: String(requisito.cantidad),
    dias: textoDeDias(requisito.diasAproximados),
    canal: (
      <CanalDeRequisito canal={requisito.canalEntrega ?? canalDelCliente} heredado={heredado} />
    ),
    nota: <NotaDeRequisito nota={requisito.nota} completa={completa} />,
  };
}

/**
 * Requisitos del cliente. En escritorio es una tabla. Debajo de 1280 px, tarjetas: la misma
 * información, de arriba abajo, sin comprimir columnas.
 */
export function MatrizListado({
  denominacion,
  canalDelCliente,
  requisitos,
  acciones,
}: MatrizListadoProps) {
  const compacto = useIsCompactLayout();
  const titulo = `Requisitos de ${denominacion}`;

  if (compacto) {
    return (
      <ul aria-label={titulo} className="flex flex-col gap-3">
        {requisitos.map((requisito) => {
          const datos = DatosDeRequisito({ requisito, canalDelCliente, completa: true });
          return (
            <li key={requisito.id} className="rounded-card border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-base leading-snug font-semibold">{datos.nombre}</h2>
                {acciones !== undefined && (
                  <RequisitoAccionesMenu
                    requisito={requisito}
                    onEditar={acciones.onEditar}
                    onQuitar={acciones.onQuitar}
                  />
                )}
              </div>
              <dl className="mt-3 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
                <dt className="text-xs text-content-secondary">Cantidad</dt>
                <dd className="break-words">{datos.cantidad}</dd>
                <dt className="text-xs text-content-secondary">Días</dt>
                <dd className="break-words">{datos.dias}</dd>
                <dt className="self-start text-xs text-content-secondary">Canal</dt>
                <dd>{datos.canal}</dd>
                <dt className="self-start text-xs text-content-secondary">Nota</dt>
                <dd className="min-w-0">{datos.nota}</dd>
              </dl>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="rounded-card border bg-card">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{titulo}</caption>
        <thead className="border-b bg-table-head text-xs text-content-secondary">
          <tr>
            <th scope="col" className="min-w-40 px-4 py-3 font-medium">
              Documento
            </th>
            <th scope="col" className="px-2.5 py-3 font-medium">
              Cantidad
            </th>
            <th scope="col" className="px-2.5 py-3 font-medium">
              Días
            </th>
            <th scope="col" className="px-2.5 py-3 font-medium">
              Canal
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Nota
            </th>
            {acciones !== undefined && (
              <th scope="col" className="px-2 py-3 text-right font-medium">
                Acciones
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {requisitos.map((requisito) => {
            const datos = DatosDeRequisito({ requisito, canalDelCliente, completa: false });
            return (
              <tr key={requisito.id} className="align-top">
                <th scope="row" className="px-4 py-3 text-left font-normal">
                  {datos.nombre}
                </th>
                <td className="px-2.5 py-3 whitespace-nowrap">{datos.cantidad}</td>
                <td className="max-w-48 px-2.5 py-3 break-words">{datos.dias}</td>
                <td className="px-2.5 py-3">{datos.canal}</td>
                <td className="px-4 py-3">{datos.nota}</td>
                {acciones !== undefined && (
                  <td className="px-2 py-2 text-right">
                    <RequisitoAccionesMenu
                      requisito={requisito}
                      onEditar={acciones.onEditar}
                      onQuitar={acciones.onQuitar}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
