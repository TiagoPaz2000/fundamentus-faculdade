import { Alert } from "./modal";

export function LoadingBlock({ label = "Carregando…", height = "h-64" }: { label?: string; height?: string }) {
  return (
    <div className={`card flex ${height} items-center justify-center text-sm text-zinc-500`}>
      <span className="animate-pulse">{label}</span>
    </div>
  );
}

export function ErrorBlock({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <Alert kind="error">
      <strong>Não foi possível carregar os dados.</strong> {message}
    </Alert>
  );
}
