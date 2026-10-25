import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from 'lucide-react';
import { useState } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';

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
import { useCargarRequisitosMasivo } from '@/modules/clientes/hooks/useCargarRequisitosMasivo';

import { validarFilaCliente, type CargaMasivaFormValues } from './cargaMasiva.types';
import { StepOne } from './StepOne';
import { StepThree } from './StepThree';
import { StepTwo } from './StepTwo';

interface CargaMasivaWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (resultado: {
    creadosCount: number;
    omitidos: Array<{ clienteId: string; motivo: string }>;
  }) => void;
}

const valoresPorDefecto: CargaMasivaFormValues = {
  tipoDocumentoId: '',
  canalEntrega: '',
  nota: '',
  clientes: {},
};

export function CargaMasivaWizard({ open, onOpenChange, onSuccess }: CargaMasivaWizardProps) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [errorPaso, setErrorPaso] = useState<string | null>(null);

  const methods = useForm<CargaMasivaFormValues>({
    defaultValues: valoresPorDefecto,
    mode: 'onChange',
  });

  const { reset, setError, clearErrors, control } = methods;
  const tipoDocumentoId = useWatch({ control, name: 'tipoDocumentoId' });
  const clientesForm = useWatch({ control, name: 'clientes' }) ?? {};

  const mutacion = useCargarRequisitosMasivo();

  const handleCerrar = () => {
    if (mutacion.isPending) return;
    onOpenChange(false);
    setPaso(1);
    setErrorPaso(null);
    reset(valoresPorDefecto);
  };

  const pasoSiguiente = () => {
    setErrorPaso(null);

    if (paso === 1) {
      if (!tipoDocumentoId || tipoDocumentoId.trim() === '') {
        setError('tipoDocumentoId', { message: 'Elegí un tipo de documento.' });
        return;
      }
      clearErrors('tipoDocumentoId');
      setPaso(2);
      return;
    }

    if (paso === 2) {
      // Validar que haya al menos un cliente seleccionado
      const seleccionados = Object.entries(clientesForm).filter(([, c]) => c?.seleccionado);

      if (seleccionados.length === 0) {
        setErrorPaso('Debes seleccionar al menos un cliente para continuar.');
        return;
      }

      // Validar cada cliente seleccionado con las reglas Zod / negocio
      let hayErrores = false;
      for (const [, datosCliente] of seleccionados) {
        const val = validarFilaCliente(datosCliente);
        if (!val.valido) {
          hayErrores = true;
          break;
        }
      }

      if (hayErrores) {
        setErrorPaso('Revisá los errores en las filas de los clientes seleccionados.');
        return;
      }

      setPaso(3);
      return;
    }
  };

  const pasoAnterior = () => {
    setErrorPaso(null);
    if (paso === 2) setPaso(1);
    if (paso === 3) setPaso(2);
  };

  const handleSubmitFinal = async () => {
    setErrorPaso(null);

    const seleccionados = Object.entries(clientesForm).filter(([, c]) => c?.seleccionado);

    const payloadClientes: Array<{
      clienteId: string;
      cantidad: number;
      diasAproximados: number[];
    }> = [];

    for (const [clienteId, datos] of seleccionados) {
      const val = validarFilaCliente(datos);
      if (!val.valido) {
        setErrorPaso('Hay errores de validación pendientes.');
        return;
      }
      payloadClientes.push({
        clienteId,
        cantidad: val.cantidadNum ?? 1,
        diasAproximados: val.diasArray ?? [],
      });
    }

    try {
      const respuesta = await mutacion.mutateAsync({
        tipoDocumentoId,
        canalEntrega: null,
        nota: null,
        clientes: payloadClientes,
      });

      // Éxito: cerrar wizard, limpiar formulario y disparar callback
      onSuccess({
        creadosCount: respuesta.creados.length,
        omitidos: respuesta.omitidos,
      });
      handleCerrar();
    } catch (err: unknown) {
      setErrorPaso(
        err instanceof Error ? err.message : 'Ocurrió un error al procesar la carga masiva.',
      );
    }
  };

  return (
    <Sheet open={open} onOpenChange={(nueva) => (!nueva ? handleCerrar() : null)}>
      <SheetContent
        side="right"
        className="w-full md:w-[50vw] sm:max-w-none data-[side=right]:sm:max-w-none flex flex-col h-full overflow-hidden p-0"
      >
        <SheetHeader className="px-6 py-4 border-b">
          <SheetTitle className="text-lg font-bold">Agregar requisito a varios clientes</SheetTitle>
          <SheetDescription className="text-xs text-content-secondary">
            Un tipo de documento → muchos clientes activos. Los que ya lo tienen se omiten sin
            cambios.
          </SheetDescription>

          {/* Stepper indicator con nombres de paso */}
          <div className="flex items-center gap-3 pt-3 text-xs font-medium overflow-x-auto whitespace-nowrap">
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${paso >= 1 ? 'text-foreground font-bold' : 'text-muted-foreground'}`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[10px] ${paso > 1 ? 'bg-primary text-primary-foreground' : paso === 1 ? 'border-2 border-primary text-primary font-bold' : 'border border-border text-muted-foreground'}`}
              >
                {paso > 1 ? '✓' : '1'}
              </span>
              Tipo
            </span>
            <span className="text-muted-foreground shrink-0">—</span>
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${paso >= 2 ? 'text-foreground font-bold' : 'text-muted-foreground'}`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[10px] ${paso > 2 ? 'bg-primary text-primary-foreground' : paso === 2 ? 'bg-primary text-primary-foreground font-bold' : 'border border-border text-muted-foreground'}`}
              >
                {paso > 2 ? '✓' : '2'}
              </span>
              Clientes y configuración
            </span>
            <span className="text-muted-foreground shrink-0">—</span>
            <span
              className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${paso >= 3 ? 'text-foreground font-bold' : 'text-muted-foreground'}`}
            >
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[10px] ${paso === 3 ? 'bg-primary text-primary-foreground font-bold' : 'border border-border text-muted-foreground'}`}
              >
                3
              </span>
              Revisar
            </span>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {errorPaso && (
            <Alert variant="destructive" className="text-sm">
              {errorPaso}
            </Alert>
          )}

          <FormProvider {...methods}>
            {paso === 1 && <StepOne />}
            {paso === 2 && <StepTwo />}
            {paso === 3 && <StepThree />}
          </FormProvider>
        </div>

        <SheetFooter className="px-6 py-4 border-t bg-muted/20 flex flex-row items-center justify-between gap-3">
          {paso > 1 ? (
            <Button
              type="button"
              variant="outline"
              onClick={pasoAnterior}
              disabled={mutacion.isPending}
            >
              <ArrowLeftIcon className="size-4 mr-1" />
              Atrás
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              onClick={handleCerrar}
              disabled={mutacion.isPending}
            >
              Cancelar
            </Button>
          )}

          {paso < 3 ? (
            <Button type="button" variant="brand" onClick={pasoSiguiente}>
              Siguiente
              <ArrowRightIcon className="size-4 ml-1" />
            </Button>
          ) : (
            <LoadingButton
              type="button"
              variant="brand"
              loading={mutacion.isPending}
              onClick={() => {
                void handleSubmitFinal();
              }}
            >
              <CheckIcon className="size-4 mr-1" />
              Confirmar y aplicar
            </LoadingButton>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
