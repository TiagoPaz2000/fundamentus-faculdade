import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminToggle } from "@/components/admin-toggle";
import { AddMemberForm, MemberActions } from "@/components/members";
import { Alert } from "@/components/modal";
import { ErrorBlock, LoadingBlock } from "@/components/page-states";
import { requireUser } from "@/lib/auth";
import { friendlyDbError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Membros" };

export default function UsuariosPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Membros</h1>
        <p className="text-sm text-zinc-500">
          Só quem está nesta lista acessa a carteira. O login (Supabase) é compartilhado com outro app, então ter conta
          não basta: é preciso ser adicionado aqui.
        </p>
      </div>
      <Suspense fallback={<LoadingBlock label="Carregando membros…" />}>
        <UsuariosContent />
      </Suspense>
    </div>
  );
}

async function UsuariosContent() {
  const user = await requireUser();
  if (!user.isAdmin) {
    return <Alert kind="warning">Acesso restrito: apenas administradores podem gerenciar membros.</Alert>;
  }

  // Só os membros (profiles), nunca a lista inteira do auth.
  const supabase = await createClient();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("*") // inclui profiles.name (0005), se existir
    .order("is_admin", { ascending: false })
    .order("email", { ascending: true });
  if (error) return <ErrorBlock error={new Error(friendlyDbError(error))} />;

  // Situação da conta de cada membro (convite pendente / último acesso), via service role
  // — já validado que quem pede é admin.
  const admin = createAdminClient();
  const authInfo = new Map<string, { pendingInvite: boolean; lastSignIn: string | null }>();
  await Promise.all(
    (profiles ?? []).map(async (p) => {
      const { data } = await admin.auth.admin.getUserById(p.id);
      const u = data?.user;
      authInfo.set(p.id, {
        pendingInvite: Boolean(u && !u.email_confirmed_at && !u.last_sign_in_at),
        lastSignIn: u?.last_sign_in_at ?? null,
      });
    }),
  );

  const adminCount = (profiles ?? []).filter((p) => p.is_admin).length;

  return (
    <div className="space-y-6">
      <AddMemberForm />

      <div className="card overflow-hidden">
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {(profiles ?? []).map((p) => {
            const info = authInfo.get(p.id);
            const isSelf = p.id === user.id;
            return (
              <li key={p.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="font-medium">
                    {memberName(p)}
                    {isSelf ? <span className="ml-2 text-xs font-normal text-zinc-500">(você)</span> : null}
                  </div>
                  <div className="break-all text-xs text-zinc-500">{p.email}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    {p.is_admin ? (
                      <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Administrador
                      </span>
                    ) : (
                      <span className="badge bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        Visualização
                      </span>
                    )}
                    {info?.pendingInvite ? (
                      <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                        Convite pendente
                      </span>
                    ) : null}
                    <span>membro desde {formatDate(p.created_at)}</span>
                    {info?.lastSignIn ? <span>· último acesso {formatDateTime(info.lastSignIn)}</span> : null}
                  </div>
                </div>
                <div className="flex flex-col items-start gap-2 sm:items-end">
                  <AdminToggle
                    userId={p.id}
                    email={p.email}
                    isAdmin={p.is_admin}
                    isSelf={isSelf}
                    isLastAdmin={p.is_admin && adminCount <= 1}
                  />
                  <MemberActions
                    userId={p.id}
                    email={p.email}
                    isSelf={isSelf}
                    pendingInvite={Boolean(info?.pendingInvite)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/** Nome de exibição: profiles.name (0005) ou a parte do email antes do @. */
function memberName(p: { email: string }): string {
  const name = (p as { name?: unknown }).name;
  if (typeof name === "string" && name.trim()) return name.trim();
  return p.email.split("@")[0] || p.email;
}
