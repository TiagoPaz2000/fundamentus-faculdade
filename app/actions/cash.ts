"use server";

import { refresh } from "next/cache";
import { fail, type ActionResult } from "@/lib/action-result";
import { AuthError, requireAdmin } from "@/lib/auth";
import { errorMessage, friendlyDbError } from "@/lib/errors";
import { formatBRL } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type CashInput = {
  kind: "deposit" | "withdraw" | "adjust";
  /** Valor digitado. Aporte/retirada: positivo (o sinal é aplicado aqui). Ajuste: com sinal. */
  amount: number;
  note?: string;
};

function guard(err: unknown): { ok: false; error: string } {
  if (err instanceof AuthError) return fail(err.message);
  console.error(err);
  return fail(errorMessage(err));
}

export async function addCashMovement(input: CashInput): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    const { kind } = input ?? {};
    if (kind !== "deposit" && kind !== "withdraw" && kind !== "adjust") return fail("Tipo de lançamento inválido.");
    const raw = Number(input.amount);
    if (!Number.isFinite(raw) || raw === 0 || Math.abs(raw) >= 1e12) return fail("Informe um valor diferente de zero.");
    const rounded = Math.round(raw * 100) / 100;
    const amount = kind === "deposit" ? Math.abs(rounded) : kind === "withdraw" ? -Math.abs(rounded) : rounded;
    const note = typeof input.note === "string" ? input.note.trim().slice(0, 300) || null : null;

    const supabase = await createClient();
    const { error } = await supabase.from("cash_movements").insert({ kind, amount, note, created_by: user.id });
    if (error) return fail(friendlyDbError(error));

    refresh();
    const label = kind === "deposit" ? "Aporte" : kind === "withdraw" ? "Retirada" : "Ajuste";
    return { ok: true, message: `${label} de ${formatBRL(Math.abs(amount))} lançado.` };
  } catch (err) {
    return guard(err);
  }
}

export async function deleteCashMovement(id: number): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!Number.isInteger(id) || id <= 0) return fail("Lançamento inválido.");
    const supabase = await createClient();
    const { data: mov, error: getErr } = await supabase
      .from("cash_movements")
      .select("id, kind")
      .eq("id", id)
      .single();
    if (getErr || !mov) return fail(friendlyDbError(getErr));
    if (mov.kind === "buy" || mov.kind === "sell") {
      return fail("Lançamentos de compra/venda são automáticos: edite ou exclua a posição.");
    }
    const { error } = await supabase.from("cash_movements").delete().eq("id", id);
    if (error) return fail(friendlyDbError(error));
    refresh();
    return { ok: true, message: "Lançamento excluído." };
  } catch (err) {
    return guard(err);
  }
}
