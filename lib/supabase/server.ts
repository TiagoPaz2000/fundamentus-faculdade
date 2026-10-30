import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import type { Database } from "@/lib/database.types";
import { getSupabasePublicEnv } from "@/lib/env";

/** Cliente Supabase com a sessão do usuário (cookies). Respeita o RLS. */
export async function createClient() {
  // Dados por usuário e por request: o supabase-js lê Date.now() ao carregar a sessão,
  // então a renderização precisa esperar a request real (não entra em prerender).
  await connection();
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabasePublicEnv();

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Chamado de um Server Component: não dá para gravar cookies aqui.
          // O proxy já renova a sessão a cada request.
        }
      },
    },
  });
}
