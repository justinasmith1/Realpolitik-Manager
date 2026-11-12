import { IniciarSesionSchema } from '@realpolitik/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Navigate, useSearchParams } from 'react-router';

import { Alert } from '@/components/ui/alert';
import { describirCampo, FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { LoadingButton } from '@/components/ui/loading-button';
import { iniciarSesion } from '@/modules/auth/api/auth.api';
import { AccesoLayout, EncabezadoDeAcceso } from '@/modules/auth/components/AccesoLayout';
import { CampoContrasena } from '@/modules/auth/components/CampoContrasena';
import { CargandoSesion } from '@/modules/auth/components/PantallasDeAcceso';
import {
  avisoDeErrorDeAuth,
  clasificarErrorDeAuth,
  mensajeDeCampo,
} from '@/modules/auth/erroresDeAuth';
import { useSesion } from '@/modules/auth/hooks/useSesion';
import {
  destinoDespuesDeEntrar,
  establecerSesion,
  META_DE_SESION,
  urlDeCambioDeContrasena,
} from '@/modules/auth/sesion';

/** Avisos de `?motivo=`. Solo presentación: un valor desconocido no muestra nada. */
const AVISOS_DE_MOTIVO: Record<string, { variante: 'success' | 'warning'; texto: string }> = {
  vencida: { variante: 'warning', texto: 'Tu sesión venció. Iniciá sesión de nuevo.' },
  terminada: { variante: 'warning', texto: 'Tu sesión terminó. Iniciá sesión de nuevo.' },
  cerrada: { variante: 'success', texto: 'Cerraste la sesión.' },
  contrasena: { variante: 'success', texto: 'Elegiste tu contraseña. Ingresá con la nueva.' },
};

interface Aviso {
  variante: 'destructive' | 'warning' | 'success';
  texto: string;
}

const errorDeCampo = (mensaje: string | undefined) =>
  mensaje === undefined ? undefined : { type: 'manual', message: mensaje };

export function LoginPage() {
  const queryClient = useQueryClient();
  const [parametros] = useSearchParams();
  const volverA = parametros.get('volverA');
  const sesion = useSesion();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errores, setErrores] = useState<{ email?: string; password?: string }>({});
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const avisoRef = useRef<HTMLDivElement>(null);

  const login = useMutation({
    mutationFn: iniciarSesion,
    meta: META_DE_SESION,
    // La sesión es la que respondió el servidor; la navegación sale del estado (más abajo).
    onSuccess: (respuesta) => establecerSesion(queryClient, respuesta),
    onError: (error) => {
      const clasificado = clasificarErrorDeAuth(error);
      // La contraseña no se conserva después de un intento fallido; el email sí.
      setPassword('');
      if (clasificado.clase === 'validacion') {
        const delEmail = mensajeDeCampo(clasificado.detalles, 'email');
        const deLaContrasena = mensajeDeCampo(clasificado.detalles, 'password');
        if (delEmail !== null || deLaContrasena !== null) {
          setErrores({
            ...(delEmail !== null && { email: delEmail }),
            ...(deLaContrasena !== null && { password: deLaContrasena }),
          });
          (delEmail !== null ? emailRef : passwordRef).current?.focus();
          return;
        }
      }
      // Un 401 de sesión no tiene sentido en el login: se trata como credenciales incorrectas.
      setAviso(
        avisoDeErrorDeAuth(
          clasificado.clase === 'sin-sesion' ? { clase: 'credenciales' } : clasificado,
        ),
      );
    },
  });

  // El foco inicial va al email (o a la contraseña si el navegador ya completó el email).
  const yaResuelta = !sesion.isPending;
  useEffect(() => {
    if (yaResuelta) {
      emailRef.current?.focus();
    }
  }, [yaResuelta]);

  // Después de un error general, el foco va al aviso: lo anuncia y deja Tab en el formulario.
  useEffect(() => {
    if (aviso !== null) {
      avisoRef.current?.focus();
    }
  }, [aviso]);

  if (sesion.data) {
    const { usuario } = sesion.data;
    return (
      <Navigate
        to={
          usuario.debeCambiarPassword
            ? urlDeCambioDeContrasena(volverA)
            : destinoDespuesDeEntrar(volverA)
        }
        replace
      />
    );
  }
  // Solo la primera resolución: si no se puede saber (503, red), se muestra el formulario igual.
  if (sesion.isPending) {
    return <CargandoSesion />;
  }

  function enviar(evento: FormEvent) {
    evento.preventDefault();
    if (login.isPending) {
      return;
    }
    setAviso(null);
    const resultado = IniciarSesionSchema.safeParse({ email, password });
    if (!resultado.success) {
      const campos = resultado.error.flatten().fieldErrors;
      const nuevos = {
        ...(campos.email?.[0] !== undefined && { email: campos.email[0] }),
        ...(campos.password?.[0] !== undefined && { password: campos.password[0] }),
      };
      setErrores(nuevos);
      (nuevos.email !== undefined ? emailRef : passwordRef).current?.focus();
      return;
    }
    setErrores({});
    login.mutate(resultado.data);
  }

  const avisoDeMotivo = aviso === null ? AVISOS_DE_MOTIVO[parametros.get('motivo') ?? ''] : null;
  const eEmail = errorDeCampo(errores.email);
  const ePassword = errorDeCampo(errores.password);

  return (
    <AccesoLayout pie="Si no tenés cuenta o no podés ingresar, pedí ayuda a un administrador de Realpolitik.">
      <EncabezadoDeAcceso
        titulo="Iniciar sesión"
        bajada="Sistema de acceso interno. Ingresá con la cuenta que te asignó la agencia."
      />
      {aviso !== null && (
        <Alert ref={avisoRef} tabIndex={-1} variant={aviso.variante} className="outline-none">
          {aviso.texto}
        </Alert>
      )}
      {avisoDeMotivo && <Alert variant={avisoDeMotivo.variante}>{avisoDeMotivo.texto}</Alert>}
      <form noValidate onSubmit={enviar} className="flex flex-col gap-4">
        <FormField id="login-email" label="Email" error={eEmail}>
          <Input
            ref={emailRef}
            {...describirCampo('login-email', eEmail)}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="h-11 md:h-11"
            value={email}
            readOnly={login.isPending}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField id="login-password" label="Contraseña" error={ePassword}>
          <CampoContrasena
            ref={passwordRef}
            {...describirCampo('login-password', ePassword)}
            nombre="contraseña"
            name="password"
            autoComplete="current-password"
            value={password}
            readOnly={login.isPending}
            onChange={(e) => setPassword(e.target.value)}
          />
        </FormField>
        <LoadingButton
          type="submit"
          className="mt-1 h-12 md:h-12"
          loading={login.isPending}
          loadingText="Ingresando…"
        >
          Ingresar
        </LoadingButton>
      </form>
    </AccesoLayout>
  );
}
