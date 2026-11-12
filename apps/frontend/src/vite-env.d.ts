/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * URL base pública de la API (incluye el prefijo si lo hay). Opcional a nivel de tipos
   * porque se valida en runtime (ver lib/env.ts). Es pública: queda dentro del bundle.
   */
  readonly VITE_API_URL?: string;
}
