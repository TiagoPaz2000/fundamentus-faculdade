import { logout } from "@/app/actions/auth";

/**
 * Tela para quem está logado mas não é membro da carteira (o login do Supabase é
 * compartilhado com outro app). Não redireciona: evita loop.
 */
export function NoAccess({ email }: { email: string }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="card w-full max-w-sm p-6 text-center">
        <div className="mx-auto mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-lg font-semibold text-white">
          !
        </div>
        <h1 className="text-lg font-semibold">Você não tem acesso a esta carteira.</h1>
        <p className="mt-2 text-sm text-zinc-500">Peça a um admin para te adicionar.</p>
        <p className="mt-6 rounded-md bg-zinc-50 px-3 py-2 text-sm break-all dark:bg-zinc-800">
          Conectado como <strong>{email}</strong>
        </p>
        <form action={logout} className="mt-4">
          <button type="submit" className="btn-secondary w-full">
            Sair
          </button>
        </form>
      </div>
    </main>
  );
}
