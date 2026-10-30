import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NoAccess } from "@/components/no-access";
import { getCurrentUserOrNull } from "@/lib/auth";

export const metadata: Metadata = { title: "Sem acesso" };

/**
 * Destino do requireUser() quando quem chama não é membro (o layout da carteira
 * já mostra a mesma tela). Não chama requireUser: sem loop de redirect.
 */
export default function SemAcessoPage() {
  return (
    <Suspense fallback={<main className="flex-1" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const user = await getCurrentUserOrNull();
  if (!user) redirect("/login");
  if (user.isMember) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-12">
        <Link href="/" className="btn-primary">
          Você já tem acesso: abrir a carteira
        </Link>
      </main>
    );
  }
  return <NoAccess email={user.email} />;
}
