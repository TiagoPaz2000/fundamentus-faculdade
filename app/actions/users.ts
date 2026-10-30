"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { fail, type ActionResult } from "@/lib/action-result";
import { AuthError, requireAdmin } from "@/lib/auth";
import { errorMessage, friendlyDbError } from "@/lib/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// O projeto Supabase é compartilhado com outro app (auth.users é comum aos dois).
// Membro da carteira = tem linha em public.profiles. Inserir/remover perfis usa
// service role (não há policy de insert/delete), SEMPRE depois de requireAdmin().

const UUID_RE = /^[0-9a-f-]{36}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function guard(err: unknown): { ok: false; error: string } {
  if (err instanceof AuthError) return fail(err.message);
  console.error(err);
  return fail(errorMessage(err));
}

/** Origem do site (para montar o link), a partir da request da Server Action. */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const origin = h.get("origin");
  if (origin) return origin;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function confirmLink(origin: string, hashedToken: string, type: "invite" | "recovery") {
  const url = new URL("/auth/confirm", origin);
  url.searchParams.set("token_hash", hashedToken);
  url.searchParams.set("type", type);
  return url.toString();
}

/** Procura um usuário do auth por email (paginando; o auth é compartilhado). */
async function findAuthUserByEmail(email: string) {
  const admin = createAdminClient();
  const target = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Erro ao consultar usuários: ${error.message}`);
    const found = data.users.find((u) => (u.email ?? "").toLowerCase() === target);
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
  return null;
}

export type AddMemberResult = {
  email: string;
  /** true = já tinha conta (ex.: do outro app) e entra com a senha que já tem. */
  existing: boolean;
  /** Link de convite para enviar por WhatsApp etc. (só para conta nova). */
  inviteLink?: string;
};

export async function addMember(emailInput: string): Promise<ActionResult<AddMemberResult>> {
  try {
    await requireAdmin();
    const email = typeof emailInput === "string" ? emailInput.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(email) || email.length > 254) return fail("Informe um e-mail válido.");

    const admin = createAdminClient();
    const existing = await findAuthUserByEmail(email);

    if (existing) {
      const { data: already } = await admin.from("profiles").select("id").eq("id", existing.id).maybeSingle();
      if (already) return fail(`${email} já é membro da carteira.`);
      const { error } = await admin.from("profiles").insert({ id: existing.id, email, is_admin: false });
      if (error) return fail(friendlyDbError(error));
      refresh();
      return {
        ok: true,
        data: { email, existing: true },
        message: `${email} já tinha conta e foi adicionado. Ele entra com a senha que já usa.`,
      };
    }

    // Conta nova: cria o usuário SEM enviar e-mail (os templates são do outro app)
    // e devolve o link para o admin mandar por fora.
    const { data, error } = await admin.auth.admin.generateLink({ type: "invite", email });
    if (error || !data?.user || !data.properties?.hashed_token) {
      return fail(`Não foi possível criar o convite: ${error?.message ?? "resposta vazia do Supabase"}`);
    }
    const { error: insErr } = await admin
      .from("profiles")
      .upsert({ id: data.user.id, email, is_admin: false }, { onConflict: "id" });
    if (insErr) return fail(friendlyDbError(insErr));

    const inviteLink = confirmLink(await siteOrigin(), data.properties.hashed_token, "invite");
    refresh();
    return {
      ok: true,
      data: { email, existing: false, inviteLink },
      message: `Convite criado para ${email}. Envie o link abaixo: ao abrir, a pessoa define a senha.`,
    };
  } catch (err) {
    return guard(err);
  }
}

/**
 * Gera um novo link de acesso (define/redefine a senha) para um membro, ex.: convite
 * expirado ou senha esquecida. Não envia e-mail. Atenção: a senha vale também no
 * outro app que usa o mesmo projeto Supabase.
 */
export async function generateAccessLink(userId: string): Promise<ActionResult<{ link: string; email: string }>> {
  try {
    const me = await requireAdmin();
    if (typeof userId !== "string" || !UUID_RE.test(userId)) return fail("Usuário inválido.");
    if (userId === me.id) return fail("Para trocar a sua senha, use a tela Definir senha.");

    const admin = createAdminClient();
    const { data: profile } = await admin.from("profiles").select("id, email").eq("id", userId).maybeSingle();
    if (!profile) return fail("Esse usuário não é membro da carteira.");

    const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(userId);
    if (getErr || !authUser?.user?.email) return fail("Conta não encontrada no Supabase.");

    // Ainda não aceitou o convite → novo convite; senão → link de redefinição.
    const pending = !authUser.user.email_confirmed_at && !authUser.user.last_sign_in_at;
    const type = pending ? "invite" : "recovery";
    const { data, error } = await admin.auth.admin.generateLink({ type, email: authUser.user.email });
    if (error || !data?.properties?.hashed_token) {
      return fail(`Não foi possível gerar o link: ${error?.message ?? "resposta vazia do Supabase"}`);
    }
    return {
      ok: true,
      data: { link: confirmLink(await siteOrigin(), data.properties.hashed_token, type), email: profile.email },
      message: pending ? "Novo link de convite gerado." : "Link para definir uma nova senha gerado.",
    };
  } catch (err) {
    return guard(err);
  }
}

/** Remove o membro da carteira (apaga só o perfil; a conta do auth continua). */
export async function removeMember(userId: string): Promise<ActionResult> {
  try {
    const me = await requireAdmin();
    if (typeof userId !== "string" || !UUID_RE.test(userId)) return fail("Usuário inválido.");
    if (userId === me.id) return fail("Você não pode remover a si mesmo.");

    const admin = createAdminClient();
    const { data: target } = await admin.from("profiles").select("id, email, is_admin").eq("id", userId).maybeSingle();
    if (!target) return fail("Esse usuário já não é membro.");

    // O banco também barra remover o último admin (trigger da 0004).
    const { error } = await admin.from("profiles").delete().eq("id", userId);
    if (error) return fail(friendlyDbError(error));

    refresh();
    return { ok: true, message: `${target.email} foi removido da carteira.` };
  } catch (err) {
    return guard(err);
  }
}

export async function setAdmin(userId: string, makeAdmin: boolean): Promise<ActionResult> {
  try {
    const me = await requireAdmin();
    if (typeof userId !== "string" || !UUID_RE.test(userId)) return fail("Usuário inválido.");
    if (typeof makeAdmin !== "boolean") return fail("Operação inválida.");

    const supabase = await createClient();
    const { data: target, error: getErr } = await supabase
      .from("profiles")
      .select("id, email, is_admin")
      .eq("id", userId)
      .single();
    if (getErr || !target) return fail(friendlyDbError(getErr));
    if (target.is_admin === makeAdmin) {
      return { ok: true, message: "Nada a alterar." };
    }

    if (!makeAdmin) {
      const { count, error: countErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);
      if (countErr) return fail(friendlyDbError(countErr));
      if ((count ?? 0) <= 1) return fail("Não é possível remover o último administrador.");
    }

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ is_admin: makeAdmin })
      .eq("id", userId)
      .select("id");
    if (error) return fail(friendlyDbError(error));
    if (!updated?.length) return fail("Sem permissão para alterar este usuário.");

    refresh();
    const self = userId === me.id;
    return {
      ok: true,
      message: makeAdmin
        ? `${target.email} agora é administrador.`
        : self
          ? "Você deixou de ser administrador."
          : `${target.email} deixou de ser administrador.`,
    };
  } catch (err) {
    return guard(err);
  }
}
