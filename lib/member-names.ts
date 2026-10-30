import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { displayName } from "@/lib/names";

/** id do usuário → nome de exibição, só membros atuais (profiles só tem membros). */
export type MemberNames = Record<string, string>;

/**
 * Nomes de todos os membros. Não há FK de positions.created_by/closed_by para
 * profiles (a FK é para auth.users), então a junção é feita por id, sem embed.
 * Lê só o email: a coluna gerada profiles.name é a mesma parte antes do @, e assim
 * funciona com ou sem a migration que a cria.
 * Não lança: sem nomes, a tela mostra "ex-membro" em vez de quebrar.
 */
export async function loadMemberNames(supabase: SupabaseClient<Database>): Promise<MemberNames> {
  const { data, error } = await supabase.from("profiles").select("id, email");
  if (error) console.error("profiles:", error.message);
  return Object.fromEntries((data ?? []).map((p) => [p.id, displayName(p.email)]));
}

/** Ids dos admins (não compram; ficam fora do placar). Não lança. */
export async function loadAdminIds(supabase: SupabaseClient<Database>): Promise<string[]> {
  const { data, error } = await supabase.from("profiles").select("id").eq("is_admin", true);
  if (error) console.error("profiles (admins):", error.message);
  return (data ?? []).map((p) => p.id);
}

/** Nome de quem comprou/vendeu: membro atual, "ex-membro" ou "—" se não registrado. */
export function memberLabel(userId: string | null | undefined, names: MemberNames): string {
  if (!userId) return "—";
  return names[userId] ?? "ex-membro";
}
