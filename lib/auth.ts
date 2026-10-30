import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CurrentUser = {
  id: string;
  email: string;
  isAdmin: boolean;
};

/** Usuário logado (ou null). Lê a sessão dos cookies: chame dentro de <Suspense>. */
export const getCurrentUserOrNull = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, is_admin")
    .eq("id", data.user.id)
    .maybeSingle();

  return {
    id: data.user.id,
    email: profile?.email ?? data.user.email ?? "",
    isAdmin: profile?.is_admin ?? false,
  };
});

/** Exige login em páginas; redireciona para /login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUserOrNull();
  if (!user) redirect("/login");
  return user;
}

export class AuthError extends Error {}

/**
 * Exige admin em Server Actions/Route Handlers. Consulta o banco a cada chamada
 * (não confia no cliente nem só no RLS).
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await getCurrentUserOrNull();
  if (!user) throw new AuthError("Sessão expirada. Entre novamente.");
  if (!user.isAdmin) throw new AuthError("Apenas administradores podem fazer isso.");
  return user;
}
