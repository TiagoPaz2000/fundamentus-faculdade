import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Link dos e-mails de convite / recuperação de senha.
 * Template no Supabase: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite
 * (ou type=recovery). Depois de validar, manda para /definir-senha.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/definir-senha";

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(new URL(safeNext, request.url));
    }
  }

  const url = new URL("/login", request.url);
  url.searchParams.set("erro", "Link inválido ou expirado. Peça um novo convite.");
  return NextResponse.redirect(url);
}
