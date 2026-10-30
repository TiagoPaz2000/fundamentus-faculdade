import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * O projeto Supabase é compartilhado com outro app: auth.users tem gente que não
 * participa da carteira. Membro = tem linha em public.profiles (migration 0004).
 */
export type CurrentUser = {
  id: string;
  email: string;
  /** profiles.name (coluna gerada da 0005) ou a parte do email antes do @. */
  name: string;
  isMember: boolean;
  isAdmin: boolean;
};

function nameFrom(name: unknown, email: string): string {
  if (typeof name === "string" && name.trim()) return name.trim();
  return email.split("@")[0] || email;
}

export type Member = CurrentUser & { isMember: true };

/** Usuário logado (ou null). Lê a sessão dos cookies: chame dentro de <Suspense>. */
export const getCurrentUserOrNull = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Com o RLS da 0004, só um membro consegue ler o próprio perfil.
  // select("*") para funcionar com ou sem a coluna profiles.name (0005).
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();
  if (profileError) console.error("profiles (perfil do usuário):", profileError.message);

  const email = profile?.email ?? data.user.email ?? "";
  return {
    id: data.user.id,
    email,
    name: nameFrom((profile as { name?: unknown } | null)?.name, email),
    isMember: Boolean(profile),
    isAdmin: profile?.is_admin ?? false,
  };
});

export class AuthError extends Error {}

/** true dentro de uma Server Action (o Next manda o header "next-action" no POST). */
async function inServerAction(): Promise<boolean> {
  try {
    return (await headers()).has("next-action");
  } catch {
    return false;
  }
}

/**
 * Exige login E ser membro da carteira.
 * - Páginas: sem login → /login; logado sem perfil → /sem-acesso (que não chama
 *   isto, então não há loop). O layout (main) já mostra a tela antes disso.
 * - Server Actions: lança AuthError (para virar mensagem no try/catch da action).
 */
export async function requireUser(): Promise<Member> {
  const user = await getCurrentUserOrNull();
  if (!user || !user.isMember) {
    if (await inServerAction()) {
      throw new AuthError(user ? "Você não tem acesso a esta carteira." : "Sessão expirada. Entre novamente.");
    }
    redirect(user ? "/sem-acesso" : "/login");
  }
  return user as Member;
}

/** Exige membro em Server Actions/Route Handlers (lança AuthError). */
export async function requireMemberAction(): Promise<Member> {
  const user = await getCurrentUserOrNull();
  if (!user) throw new AuthError("Sessão expirada. Entre novamente.");
  if (!user.isMember) throw new AuthError("Você não tem acesso a esta carteira.");
  return user as Member;
}

/**
 * Exige admin em Server Actions/Route Handlers. Consulta o banco a cada chamada
 * (não confia no cliente nem só no RLS). Admin implica membro.
 */
export async function requireAdmin(): Promise<Member> {
  const user = await requireMemberAction();
  if (!user.isAdmin) throw new AuthError("Apenas administradores podem fazer isso.");
  return user;
}
