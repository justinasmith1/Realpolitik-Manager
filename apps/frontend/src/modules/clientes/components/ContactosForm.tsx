import { useId, useState } from 'react';
import { Controller, useFieldArray, useForm, type Resolver } from 'react-hook-form';
import type { Contacto, CreateContactoDto } from '@realpolitik/shared';
import { CreateContactoSchema } from '@realpolitik/shared';
import { PlusIcon, TrashIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
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

interface ContactosFormValues {
  contactos: (CreateContactoDto & { _id?: string })[];
}

const resolver: Resolver<ContactosFormValues> = async (values) => {
  const result = CreateContactoSchema.array().safeParse(values.contactos);
  if (result.success) {
    return { values, errors: {} };
  }
  
  const errors: Record<string, any> = {};
  for (const issue of result.error.issues) {
    const [index, campo] = issue.path;
    if (index !== undefined && campo) {
      if (!errors.contactos) errors.contactos = [];
      if (!errors.contactos[index as number]) errors.contactos[index as number] = {};
      errors.contactos[index as number][campo] = { message: 'Dato inválido' };
    }
  }
  return { values: {}, errors };
};

interface ContactosFormProps {
  contactosIniciales: Contacto[];
  onSave: (nuevos: CreateContactoDto[], borrados: string[]) => Promise<string | undefined>;
  onCancel: () => void;
}

export function ContactosForm({ contactosIniciales, onSave, onCancel }: ContactosFormProps) {
  const [borradosIds, setBorradosIds] = useState<string[]>([]);
  const [rootError, setRootError] = useState<string | null>(null);
  const id = useId();

  const {
    control,
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactosFormValues>({
    resolver,
    defaultValues: {
      contactos: contactosIniciales.map((c) => ({
        nombre: c.nombre,
        area: c.area,
        email: c.email,
        recibeRendiciones: c.recibeRendiciones,
        // Hack para mantener el ID internamente en el array
        _id: c.id,
      })) as any,
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'contactos',
  });

  const onSubmit = handleSubmit(async (data) => {
    setRootError(null);
    const err = await onSave(data.contactos, borradosIds);
    if (err) {
      setRootError(err);
    }
  });

  const marcarParaBorrar = (index: number) => {
    const field = fields[index] as any;
    if (field._id) {
      setBorradosIds((prev) => [...prev, field._id]);
    }
    remove(index);
  };

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {fields.map((field, index) => (
          <div key={field.id} className="flex flex-col gap-3 rounded-card border bg-card p-4">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Contacto {index + 1}</h4>
              <AlertDialog>
                <AlertDialogTrigger render={<Button variant="ghost" size="icon" className="text-destructive" />}>
                  <TrashIcon className="h-4 w-4" />
                  <span className="sr-only">Eliminar</span>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>¿Eliminar contacto?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Esta acción removerá el contacto de la lista. Deberás guardar los cambios para confirmar.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction onClick={() => marcarParaBorrar(index)}>Eliminar</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Nombre</label>
                <Input {...register(`contactos.${index}.nombre` as const)} />
                {errors.contactos?.[index]?.nombre && (
                  <p className="text-xs text-destructive">{errors.contactos[index]?.nombre?.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium">Área</label>
                <Input {...register(`contactos.${index}.area` as const)} />
                {errors.contactos?.[index]?.area && (
                  <p className="text-xs text-destructive">{errors.contactos[index]?.area?.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-sm font-medium">Email</label>
                <Input type="email" {...register(`contactos.${index}.email` as const)} />
                {errors.contactos?.[index]?.email && (
                  <p className="text-xs text-destructive">{errors.contactos[index]?.email?.message}</p>
                )}
              </div>
              <div className="flex items-center gap-2 sm:col-span-2">
                <Controller
                  name={`contactos.${index}.recibeRendiciones` as const}
                  control={control}
                  render={({ field }) => (
                    <Checkbox checked={field.value} onCheckedChange={field.onChange} />
                  )}
                />
                <label className="text-sm">Recibe rendiciones</label>
              </div>
            </div>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          className="mt-2 w-full"
          onClick={() => append({ nombre: '', area: '', email: '', recibeRendiciones: false })}
        >
          <PlusIcon className="mr-2 h-4 w-4" />
          Agregar contacto
        </Button>

        {rootError !== null && (
          <p
            role="alert"
            className="mt-2 rounded-control border border-destructive-border bg-destructive-soft px-3 py-2 text-sm text-destructive"
          >
            {rootError}
          </p>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t p-4">
        <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Guardando…' : 'Guardar contactos'}
        </Button>
      </div>
    </form>
  );
}
