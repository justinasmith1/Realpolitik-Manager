import {
  destinatariosDeCorreo,
  type CanalEntregaType,
  type Cliente,
  type ItemChecklist,
} from '@realpolitik/shared';
import { useState, type ReactNode, type RefObject } from 'react';

import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { etiquetasCanalEntrega } from '@/modules/clientes/clientes.etiquetas';
import { useContactos } from '@/modules/clientes/hooks/useContactos';
import { nombreDeItem, numeroDeWhatsappLegible } from '@/modules/rendiciones/rendiciones.etiquetas';

/** Ítems elegidos que van todos por el mismo canal. */
export interface Envio {
  canal: CanalEntregaType;
  items: readonly ItemChecklist[];
}

interface EnvioDialogProps {
  /** `null` mantiene el diálogo cerrado. */
  envio: Envio | null;
  /** `undefined` mientras el cliente carga (o si no se pudo cargar). */
  cliente: Cliente | undefined;
  onCerrar: () => void;
  /** Falta un dato del canal: lleva a completarlo en el cliente. */
  onEditarCliente: () => void;
  focoAlCerrar: RefObject<HTMLElement | null>;
}

type Copiado = 'ok' | 'error' | null;

/**
 * Datos para enviar los ítems elegidos por su canal (HU2.5). El sistema todavía no envía nada:
 * muestra a quién o adónde mandarlo, para que la operadora lo haga. Nunca muestra ni pide
 * credenciales del portal: el sistema no las guarda.
 */
export function EnvioDialog({
  envio,
  cliente,
  onCerrar,
  onEditarCliente,
  focoAlCerrar,
}: EnvioDialogProps) {
  // Se conserva lo último mostrado para que el contenido no desaparezca durante el cierre.
  const [mostrado, setMostrado] = useState(envio);
  if (envio !== null && envio !== mostrado) setMostrado(envio);
  const [copiado, setCopiado] = useState<Copiado>(null);

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado('ok');
    } catch {
      setCopiado('error');
    }
  }

  const canal = mostrado?.canal;
  return (
    <AlertDialog
      open={envio !== null}
      onOpenChange={(abrir) => {
        if (!abrir) onCerrar();
      }}
      onOpenChangeComplete={(abierto) => {
        if (!abierto) {
          setMostrado(null);
          setCopiado(null);
        }
      }}
    >
      <AlertDialogContent finalFocus={focoAlCerrar} className="data-[size=default]:sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Enviar por {canal === undefined ? '' : etiquetasCanalEntrega[canal]}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {canal === 'PORTAL_WEB'
              ? 'Cargá estos documentos en el portal del cliente.'
              : 'Estos son los datos para mandar los documentos elegidos.'}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto text-sm">
          {cliente === undefined ? (
            <p className="text-muted-foreground">Cargando los datos del cliente…</p>
          ) : canal === 'CORREO' ? (
            <DatosDeCorreo
              cliente={cliente}
              onCopiar={(texto) => void copiar(texto)}
              onEditarCliente={onEditarCliente}
            />
          ) : canal === 'PORTAL_WEB' ? (
            <DatosDePortal cliente={cliente} onEditarCliente={onEditarCliente} />
          ) : canal === 'WHATSAPP' ? (
            <DatosDeWhatsapp
              cliente={cliente}
              onCopiar={(texto) => void copiar(texto)}
              onEditarCliente={onEditarCliente}
            />
          ) : null}
          {copiado !== null && (
            <p role="status" className={copiado === 'ok' ? 'text-success' : 'text-destructive'}>
              {copiado === 'ok' ? 'Copiado.' : 'No se pudo copiar. Seleccioná el texto a mano.'}
            </p>
          )}
          {mostrado !== null && <ItemsDelEnvio items={mostrado.items} />}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cerrar</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ItemsDelEnvio({ items }: { items: readonly ItemChecklist[] }) {
  return (
    <section aria-labelledby="titulo-items-del-envio" className="flex flex-col gap-1.5">
      <h3 id="titulo-items-del-envio" className="font-medium text-foreground">
        Documentos ({items.length})
      </h3>
      <ul className="flex flex-col gap-1">
        {items.map((item) => (
          <li key={item.id} className="text-foreground">
            {nombreDeItem(item)}
            {item.diaAproximado !== null && (
              <span className="text-muted-foreground"> · Día aprox. {item.diaAproximado}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Falta el dato que el canal necesita: se dice cuál y se ofrece completarlo. */
function DatoFaltante({
  children,
  onEditarCliente,
}: {
  children: ReactNode;
  onEditarCliente: () => void;
}) {
  return (
    <Alert variant="warning">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>{children}</span>
        <Button type="button" variant="outline" size="sm" onClick={onEditarCliente}>
          Editar el cliente
        </Button>
      </div>
    </Alert>
  );
}

function DatosDeCorreo({
  cliente,
  onCopiar,
  onEditarCliente,
}: {
  cliente: Cliente;
  onCopiar: (texto: string) => void;
  onEditarCliente: () => void;
}) {
  // La misma consulta que el editor de contactos: solo trae los que no están dados de baja.
  const contactos = useContactos(cliente.id);
  const destinatarios = destinatariosDeCorreo(cliente, contactos.data ?? []);

  return (
    <>
      <Alert variant="warning">
        El envío automático por correo todavía no está disponible. Por ahora usá estos datos para
        mandarlo vos.
      </Alert>
      {contactos.isError && (
        <Alert>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              No pudimos cargar los contactos del cliente: la lista puede estar incompleta.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void contactos.refetch()}
              disabled={contactos.isFetching}
            >
              Reintentar
            </Button>
          </div>
        </Alert>
      )}
      {destinatarios.length === 0 && !contactos.isPending ? (
        <DatoFaltante onEditarCliente={onEditarCliente}>
          Este cliente no tiene emails cargados para recibir rendiciones.
        </DatoFaltante>
      ) : (
        <section aria-labelledby="titulo-destinatarios" className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="titulo-destinatarios" className="font-medium text-foreground">
              Destinatarios
            </h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onCopiar(destinatarios.map((d) => d.email).join(', '))}
              disabled={contactos.isPending}
            >
              Copiar destinatarios
            </Button>
          </div>
          <ul className="flex flex-col gap-1">
            {destinatarios.map((destinatario) => (
              <li key={destinatario.email} className="flex flex-col">
                <span className="break-all text-foreground">{destinatario.email}</span>
                {destinatario.nombre !== null && (
                  <span className="text-xs text-muted-foreground">
                    {destinatario.nombre}
                    {destinatario.area !== null && ` · ${destinatario.area}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {contactos.isPending && (
            <p className="text-muted-foreground">Cargando los contactos del cliente…</p>
          )}
        </section>
      )}
    </>
  );
}

function DatosDePortal({
  cliente,
  onEditarCliente,
}: {
  cliente: Cliente;
  onEditarCliente: () => void;
}) {
  const url = cliente.portalUrl;
  if (url === undefined || url === '') {
    return (
      <DatoFaltante onEditarCliente={onEditarCliente}>
        Este cliente no tiene URL de portal cargada.
      </DatoFaltante>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <p className="break-all text-foreground">{url}</p>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: 'outline', size: 'sm', className: 'w-fit' })}
      >
        Abrir portal
      </a>
    </div>
  );
}

function DatosDeWhatsapp({
  cliente,
  onCopiar,
  onEditarCliente,
}: {
  cliente: Cliente;
  onCopiar: (texto: string) => void;
  onEditarCliente: () => void;
}) {
  const numero = cliente.whatsappNumero;
  if (numero === undefined || numero === '') {
    return (
      <DatoFaltante onEditarCliente={onEditarCliente}>
        Este cliente no tiene número de WhatsApp cargado.
      </DatoFaltante>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-base font-medium text-foreground">{numeroDeWhatsappLegible(numero)}</p>
      <Button type="button" variant="outline" size="sm" onClick={() => onCopiar(numero)}>
        Copiar número
      </Button>
    </div>
  );
}
