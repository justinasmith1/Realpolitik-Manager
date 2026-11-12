import type { ReactNode } from 'react';

import logoUrl from '@/assets/realpolitik-logo.svg';

interface AccesoLayoutProps {
  children: ReactNode;
  /** Texto de ayuda debajo de la tarjeta. */
  pie?: ReactNode;
}

/**
 * Layout de las pantallas de acceso (login, cambio obligatorio, bloqueos), fuera del shell:
 * panel de marca oscuro (a la izquierda en escritorio, arriba en mobile) y una tarjeta centrada
 * con el contenido. Handoff: "Realpolitik Manager · Épica 4".
 */
export function AccesoLayout({ children, pie }: AccesoLayoutProps) {
  return (
    <div className="grid min-h-svh grid-cols-1 bg-background md:grid-cols-[minmax(0,0.85fr)_minmax(440px,1fr)] xl:grid-cols-[minmax(0,1.1fr)_minmax(480px,1fr)]">
      <aside className="relative flex flex-col items-center justify-center overflow-hidden bg-primary px-4 py-7 text-primary-foreground md:sticky md:top-0 md:h-svh md:p-12">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(rgba(255,255,255,0.09)_1px,transparent_1px)] mask-[radial-gradient(ellipse_at_center,#000_0%,transparent_72%)] bg-size-[22px_22px]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-x-0 bottom-0 h-1 bg-linear-to-r from-[#ec1c24] via-brand-accent to-[#911b1e] md:inset-x-auto md:inset-y-0 md:right-0 md:h-auto md:w-1.5 md:bg-linear-to-b"
        />
        <div className="relative flex flex-col items-center gap-3.5 md:gap-5.5">
          <img
            src={logoUrl}
            alt="Realpolitik"
            className="block h-auto w-33 shadow-[0_18px_48px_rgba(0,0,0,0.45)] md:w-55 xl:w-65"
          />
          <span className="flex items-center gap-3 font-mono text-[11px] tracking-[0.32em] text-[#dad4d2] uppercase md:text-[12.5px]">
            <span aria-hidden="true" className="h-px w-5 bg-brand-accent" />
            <span className="-mr-[0.32em]">Manager</span>
            <span aria-hidden="true" className="h-px w-5 bg-brand-accent" />
          </span>
        </div>
      </aside>
      <div className="flex items-start justify-center px-4 pt-6 pb-24 md:items-center md:px-8 md:py-12">
        <div className="flex w-full max-w-105 flex-col gap-5">
          <main className="flex flex-col gap-5 rounded-card border bg-card px-4.5 py-5.5 shadow-[inset_0_3px_0_var(--brand-accent),0_1px_2px_rgba(22,19,20,0.04),0_12px_32px_rgba(22,19,20,0.06)] md:px-8 md:py-7">
            {children}
          </main>
          {pie !== undefined && (
            <p className="text-[13px] leading-normal text-pretty text-content-secondary">{pie}</p>
          )}
        </div>
      </div>
    </div>
  );
}

interface EncabezadoDeAccesoProps {
  titulo: string;
  bajada?: string;
  /** Línea chica sobre el título (p. ej. la cuenta con la que se entró). */
  quien?: string;
}

export function EncabezadoDeAcceso({ titulo, bajada, quien }: EncabezadoDeAccesoProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {quien !== undefined && (
        <span className="text-[13px] wrap-anywhere text-content-secondary">{quien}</span>
      )}
      <h1 className="text-[26px] leading-8 font-semibold tracking-tight text-primary">{titulo}</h1>
      {bajada !== undefined && (
        <p className="text-sm leading-normal text-pretty text-content-secondary">{bajada}</p>
      )}
    </div>
  );
}
