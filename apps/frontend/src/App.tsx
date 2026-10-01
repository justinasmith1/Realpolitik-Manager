import { ClienteSector } from '@realpolitik/shared';

// Prueba técnica temporal: usa un export runtime real de @realpolitik/shared
// para comprobar que Vite resuelve y bundlea el paquete. Se reemplaza cuando
// exista el componente real que consuma estos valores.
const sectores = ClienteSector.options.join(', ');

export function App() {
  return (
    <main>
      <h1>Realpolitik Manager</h1>
      <p>Frontend base operativa</p>
      <p>Sectores definidos en @realpolitik/shared: {sectores}</p>
    </main>
  );
}
