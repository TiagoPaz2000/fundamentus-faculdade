import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Header, HeaderShell } from "@/components/header";
import { NoAccess } from "@/components/no-access";
import { getCurrentUserOrNull } from "@/lib/auth";

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <Suspense fallback={<HeaderShell />}>
      <MemberGate>{children}</MemberGate>
    </Suspense>
  );
}

/**
 * O login é compartilhado com outro app: logado não basta, precisa ser membro
 * (ter perfil em public.profiles). Quem não é vê a tela de "sem acesso" aqui
 * mesmo, sem redirect (nada de loop), e as páginas nem chegam a renderizar.
 */
async function MemberGate({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUserOrNull();
  if (!user) redirect("/login");
  if (!user.isMember) return <NoAccess email={user.email} />;

  return (
    <>
      <Suspense fallback={<HeaderShell />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-zinc-200 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800">
        Cotações: Fundamentus e InfoMoney. Dados com atraso; uso acadêmico.
      </footer>
    </>
  );
}
