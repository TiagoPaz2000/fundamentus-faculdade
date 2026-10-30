import "server-only";
import { timingSafeEqual } from "node:crypto";

/**
 * Valida `Authorization: Bearer ${CRON_SECRET}`. Devolve uma Response de erro
 * ou null se autorizado. Leia o header do request ANTES de chamar (para a rota
 * nunca ser pré-renderizada no build).
 */
export function checkCronAuth(authHeader: string): Response | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json({ ok: false, error: "CRON_SECRET não configurado" }, { status: 500 });
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(authHeader);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }
  return null;
}
