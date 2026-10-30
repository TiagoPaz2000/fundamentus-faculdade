import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { requireUser } from "@/lib/auth";
import { NavLinks } from "./nav-links";

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-600 text-sm text-white">
        C
      </span>
      <span className="hidden sm:inline">Carteira da Turma</span>
    </Link>
  );
}

export function HeaderShell({ children }: { children?: React.ReactNode }) {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Brand />
        {children}
      </div>
    </header>
  );
}

/** Lê a sessão: renderize dentro de <Suspense>. */
export async function Header() {
  const user = await requireUser();
  return (
    <HeaderShell>
      <NavLinks isAdmin={user.isAdmin} />
      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right text-xs leading-tight md:block">
          <div className="text-zinc-700 dark:text-zinc-200">{user.email}</div>
          <div className="text-zinc-500">{user.isAdmin ? "Administrador" : "Visualização"}</div>
        </div>
        <form action={logout}>
          <button type="submit" className="btn-secondary btn-xs">
            Sair
          </button>
        </form>
      </div>
    </HeaderShell>
  );
}
