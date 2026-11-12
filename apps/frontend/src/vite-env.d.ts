/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Base pública de la API: un path de mismo origen (`/api`, servido por un proxy) o una URL
   * absoluta (incluye el prefijo si lo hay). Opcional a nivel de tipos porque se valida en
   * runtime (ver lib/env.ts). Es pública: queda dentro del bundle.
   */
  readonly VITE_API_URL?: string;
}
