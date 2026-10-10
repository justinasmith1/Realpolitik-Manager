import { ReemplazarContactosSchema, type Contacto } from '@realpolitik/shared';
import { PlusIcon, TrashIcon } from 'lucide-react';
import { useState } from 'react';
import {
  Controller,
  useFieldArray,
  useForm,
  useWatch,
  type FieldError,
  type FieldErrors,
  type Resolver,
} from 'react-hook-form';

import { Alert } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import type { ContactoAGuardar } from '@/modules/clientes/api/contactos.api';
import type {
  CampoContacto,
  ErroresDeContactos,
} from '@/modules/clientes/components/erroresDeContactos';

/**
 * Un contacto del formulario. `contactoId` está solo en los que ya existen (la base lo
 * conoce); los nuevos no lo tienen. No se llama `id` porque `useFieldArray` reserva ese nombre.
 */
interface ContactoFormItem {
  contactoId?: string;
  nombre: string;
  area: string;
  email: string;
  recibeRendiciones: boolean;
}

interface ContactosFormValues {
  contactos: ContactoFormItem[];
}

const CAMPOS_CONTACTO: readonly CampoContacto[] = ['nombre', 'area', 'email'];

const esCampoContacto = (valor: unknown): valor is CampoContacto =>
  CAMPOS_CONTACTO.some((campo) => campo === valor);

/** Lo que viaja al servidor: el `id` solo en los contactos que ya existían. */
function aContactoAGuardar(item: ContactoFormItem): ContactoAGuardar {
  return {
    ...(item.contactoId === undefined ? {} : { id: item.contactoId }),
    nombre: item.nombre,
    area: item.area,
    email: item.email,
    recibeRendiciones: item.recibeRendiciones,
  };
}

/**
 * Valida con el MISMO schema que el servidor (`ReemplazarContactosSchema`), así los mensajes
 * son los de shared y los emails repetidos dentro de la lista se detectan antes de enviar. Cada
 * issue se marca en el campo del contacto que corresponde; lo que no es de un campo (p. ej. un
 * id repetido) va como error general.
 */
const resolver: Resolver<ContactosFormValues> = (values) => {
  const resultado = ReemplazarContactosSchema.safeParse({
    contactos: values.contactos.map(aContactoAGuardar),
  });
  if (resultado.success) {
    return { values, errors: {} };
  }

  const porContacto: Record<string, FieldError>[] = [];
  const generales: string[] = [];
  for (const issue of resultado.error.issues) {
    const [raiz, indice, campo] = issue.path;
    if (raiz === 'contactos' && typeof indice === 'number' && esCampoContacto(campo)) {
      const errores = porContacto[indice] ?? {};
      // El primer mensaje de cada campo, como en el resto de los formularios.
      errores[campo] ??= { type: 'validate', message: issue.message };
      porContacto[indice] = errores;
    } else {
      generales.push(issue.message);
    }
  }

  const errors: FieldErrors<ContactosFormValues> = {};
  if (porContacto.length > 0) {
    errors.contactos = porContacto;
  }
  if (generales.length > 0 && porContacto.length === 0) {
    // RHF tipa `root` como error y a la vez como mapa de errores con nombre; se usa la forma
    // simple (`errors.root.message`), igual que en `ClienteForm`.
    errors.root = { type: 'validate', message: generales[0] ?? 'Revisá los datos.' } as NonNullable<
      FieldErrors<ContactosFormValues>['root']
    >;
  }
  return { values: {}, errors };
};

interface ContactosFormProps {
  contactosIniciales: Contacto[];
  /** Recibe la lista completa, ya validada. Devuelve los errores del servidor, o nada si salió bien. */
  onSave: (contactos: ContactoAGuardar[]) => Promise<ErroresDeContactos | undefined>;
  onCancel: () => void;
}

export function ContactosForm({ contactosIniciales, onSave, onCancel }: ContactosFormProps) {
  const [errorGeneral, setErrorGeneral] = useState<string | null>(null);

  const {
    control,
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ContactosFormValues>({
    resolver,
    defaultValues: {
      contactos: contactosIniciales.map((c) => ({
        contactoId: c.id,
        nombre: c.nombre,
        area: c.area,
        email: c.email,
        recibeRendiciones: c.recibeRendiciones,
      })),
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'contactos' });
  // Para nombrar el botón de eliminar con el contacto que se está escribiendo.
  const escritos = useWatch({ control, name: 'contactos' });

  const nombreDe = (indice: number) => escritos?.[indice]?.nombre.trim() || `${indice + 1}`;

  const guardar = handleSubmit(async (data) => {
    setErrorGeneral(null);
    const erroresDelServidor = await onSave(data.contactos.map(aContactoAGuardar));
    if (erroresDelServidor === undefined) {
      return;
    }
    let primero = true;
    for (const [indice, campos] of Object.entries(erroresDelServidor.contactos ?? {})) {
      for (const [campo, message] of Object.entries(campos)) {
        setError(
          `contactos.${Number(indice)}.${campo as CampoContacto}`,
          { type: 'server', message },
          { shouldFocus: primero },
        );
        primero = false;
      }
    }
    setErrorGeneral(erroresDelServidor.general ?? null);
  });

  const avisoGeneral = errorGeneral ?? errors.root?.message ?? null;

  return (
    <form noValidate onSubmit={(e) => void guardar(e)} className="flex min-h-0 flex-1 flex-col">
      {/* Zona fija, fuera del área con scroll: con varios contactos el aviso quedaría
          debajo de lo visible. */}
      {avisoGeneral !== null && (
        <div className="px-5 pt-4">
          <Alert>{avisoGeneral}</Alert>
        </div>
      )}

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        {fields.map((field, index) => {
          const errores = errors.contactos?.[index];
          const idDe = (campo: CampoContacto) => `${field.id}-${campo}`;
          return (
            <div
              key={field.id}
              role="group"
              aria-label={`Contacto ${index + 1}`}
              className="flex flex-col gap-3 rounded-card border bg-card p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Contacto {index + 1}</h3>
                <AlertDialog>
                  <AlertDialogTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive"
                        aria-label={`Eliminar contacto ${nombreDe(index)}`}
                      />
                    }
                  >
                    <TrashIcon aria-hidden="true" className="h-4 w-4" />
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar contacto?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Se quitará de la lista el contacto {nombreDe(index)}. Deberás guardar los
                        cambios para confirmar.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => remove(index)}>Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <FormField id={idDe('nombre')} label="Nombre" error={errores?.nombre}>
                  <Input
                    autoComplete="off"
                    {...register(`contactos.${index}.nombre`)}
                    {...describirCampo(idDe('nombre'), errores?.nombre)}
                  />
                </FormField>
                <FormField id={idDe('area')} label="Área" error={errores?.area}>
                  <Input
                    autoComplete="off"
                    {...register(`contactos.${index}.area`)}
                    {...describirCampo(idDe('area'), errores?.area)}
                  />
                </FormField>
                <FormField
                  id={idDe('email')}
                  label="Email"
                  error={errores?.email}
                  className="sm:col-span-2"
                >
                  <Input
                    type="email"
                    autoComplete="off"
                    {...register(`contactos.${index}.email`)}
                    {...describirCampo(idDe('email'), errores?.email)}
                  />
                </FormField>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Controller
                    name={`contactos.${index}.recibeRendiciones`}
                    control={control}
                    render={({ field: campo }) => (
                      <Checkbox
                        id={`${field.id}-recibeRendiciones`}
                        checked={campo.value}
                        onCheckedChange={campo.onChange}
                      />
                    )}
                  />
                  <label htmlFor={`${field.id}-recibeRendiciones`} className="text-sm">
                    Recibe rendiciones
                  </label>
                </div>
              </div>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          className="mt-2 w-full"
          onClick={() => append({ nombre: '', area: '', email: '', recibeRendiciones: false })}
        >
          <PlusIcon aria-hidden="true" className="mr-2 h-4 w-4" />
          Agregar contacto
        </Button>
      </div>

      <div className="flex justify-end gap-2 border-t bg-panel-alt px-5 py-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <LoadingButton
          type="submit"
          loading={isSubmitting}
          loadingText="Guardando…"
          className="min-w-44"
        >
          Guardar contactos
        </LoadingButton>
      </div>
    </form>
  );
}
