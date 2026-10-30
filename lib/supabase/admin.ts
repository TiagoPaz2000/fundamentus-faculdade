import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { getServiceRoleKey, getSupabasePublicEnv } from "@/lib/env";

/**
 * Cliente com service role: IGNORA o RLS. Use só no servidor e só depois de
 * validar que o usuário é admin (ou no cron, depois de validar o CRON_SECRET).
 */
export function createAdminClient() {
  const { url } = getSupabasePublicEnv();
  return createClient<Database>(url, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
