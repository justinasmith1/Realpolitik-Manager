import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <div className="px-6 py-5.5">
      <h1 className="text-xl font-semibold tracking-tight">Página no encontrada</h1>
      <p className="mt-2 text-sm text-content-secondary">La dirección que ingresaste no existe.</p>
      <Link
        to="/clientes"
        className="mt-4 inline-block text-sm font-medium underline underline-offset-2"
      >
        Ir a Clientes
      </Link>
    </div>
  );
}
