import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminToggle } from "@/components/admin-toggle";
import { Alert } from "@/components/modal";
import { ErrorBlock, LoadingBlock } from "@/components/page-states";
import { requireUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { formatDate } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Usuários" };

export default function UsuariosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Usuários</h1>
        <p className="text-sm text-zinc-500">
          Novos usuários são convidados pelo painel do Supabase (Authentication → Users → Invite user).
        </p>
      </div>
      <Suspense fallback={<LoadingBlock label="Carregando usuários…" />}>
        <UsuariosContent />
      </Suspense>
    </div>
  );
}

async function UsuariosContent() {
  const user = await requireUser();
  if (!user.isAdmin) {
    return <Alert kind="warning">Acesso restrito: apenas administradores podem gerenciar usuários.</Alert>;
  }

  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, email, is_admin, created_at")
    .order("is_admin", { ascending: false })
    .order("email", { ascending: true });
  if (error) return <ErrorBlock error={new Error(friendlyDbError(error))} />;

  const adminCount = (profiles ?? []).filter((p) => p.is_admin).length;

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60">
            <tr>
              <th className="px-3 py-2">E-mail</th>
              <th className="px-3 py-2">Perfil</th>
              <th className="px-3 py-2">Desde</th>
              <th className="px-3 py-2 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {(profiles ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2">
                  {p.email}
                  {p.id === user.id ? <span className="ml-2 text-xs text-zinc-500">(você)</span> : null}
                </td>
                <td className="px-3 py-2">
                  {p.is_admin ? (
                    <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                      Administrador
                    </span>
                  ) : (
                    <span className="badge bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Visualização</span>
                  )}
                </td>
                <td className="px-3 py-2 tabular-nums">{formatDate(p.created_at)}</td>
                <td className="px-3 py-2 text-right">
                  <AdminToggle
                    userId={p.id}
                    email={p.email}
                    isAdmin={p.is_admin}
                    isSelf={p.id === user.id}
                    isLastAdmin={p.is_admin && adminCount <= 1}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
