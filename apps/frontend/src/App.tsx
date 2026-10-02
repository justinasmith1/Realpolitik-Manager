import { ClienteSector } from '@realpolitik/shared';

// Prueba técnica temporal: usa un export runtime real de @realpolitik/shared
// para comprobar que Vite resuelve y bundlea el paquete. Se reemplaza cuando
// exista el componente real que consuma estos valores.
const sectores = ClienteSector.options.join(', ');

// Presentación mínima para comprobar tokens, tipografías y radios. No es el
// layout definitivo de la aplicación.
export function App() {
  return (
    <main className="min-h-svh bg-background p-6 font-sans text-foreground">
      <div className="max-w-xl rounded-card border border-border bg-card p-6">
        <h1 className="text-xl font-semibold">Realpolitik Manager</h1>
        <p className="mt-1 text-content-secondary">Frontend base operativa</p>
        <p className="mt-4 text-sm text-muted-foreground">
          Sectores definidos en @realpolitik/shared:{' '}
          <span className="font-mono text-foreground">{sectores}</span>
        </p>
      </div>
    </main>
  );
}
