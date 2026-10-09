import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Contacto, CreateContactoDto, UpdateContactoDto } from '@realpolitik/shared';

import {
  actualizarContacto,
  crearContacto,
  eliminarContacto,
  listarContactos,
} from '../api/contactos.api';

export const contactosQueryKey = (clienteId: string) => ['clientes', clienteId, 'contactos'] as const;

export function useContactos(clienteId: string) {
  return useQuery({
    queryKey: contactosQueryKey(clienteId),
    queryFn: ({ signal }) => listarContactos(clienteId, signal),
  });
}

export function useCrearContacto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clienteId, datos }: { clienteId: string; datos: CreateContactoDto }) =>
      crearContacto(clienteId, datos),
    onSuccess: (contacto) => {
      queryClient.invalidateQueries({ queryKey: contactosQueryKey(contacto.clienteId) });
    },
  });
}

export function useActualizarContacto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      clienteId,
      contactoId,
      datos,
    }: {
      clienteId: string;
      contactoId: string;
      datos: UpdateContactoDto;
    }) => actualizarContacto(clienteId, contactoId, datos),
    onSuccess: (contacto) => {
      queryClient.invalidateQueries({ queryKey: contactosQueryKey(contacto.clienteId) });
    },
  });
}

export function useEliminarContacto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ clienteId, contactoId }: { clienteId: string; contactoId: string }) =>
      eliminarContacto(clienteId, contactoId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: contactosQueryKey(variables.clienteId) });
    },
  });
}
