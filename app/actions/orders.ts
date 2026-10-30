"use server";

import { refresh } from "next/cache";
import { fail, type ActionResult } from "@/lib/action-result";
import { AuthError, requireAdmin } from "@/lib/auth";
import { isIsoDate, todaySP } from "@/lib/dates";
import { SHARES_PER_TICKER, errorMessage, friendlyDbError } from "@/lib/errors";
import { formatBRL, formatDate } from "@/lib/format";
import { marketStatus } from "@/lib/market-hours";
import { checkTickerSlot } from "@/lib/portfolio";
import { normalizeTicker } from "@/lib/quotes";
import { executeDueOrders, type OrderRunResult } from "@/lib/scheduled-orders";
import { createClient } from "@/lib/supabase/server";

function guard(err: unknown): { ok: false; error: string } {
  if (err instanceof AuthError) return fail(err.message);
  console.error(err);
  return fail(errorMessage(err));
}

/** A quantidade é sempre SHARES_PER_TICKER (100), regra da carteira. */
export type ScheduleInput = {
  ticker: string;
  /** Preço máximo que aceita pagar. */
  limitPrice: number;
  /** YYYY-MM-DD opcional; sem data = vale até cancelar. */
  validUntil?: string | null;
};

export async function scheduleOrder(input: ScheduleInput): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    const ticker = normalizeTicker(input?.ticker);
    if (!ticker) return fail("Ticker inválido (use, por exemplo, PETR4).");
    if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0 || input.limitPrice >= 1e9)
      return fail("Preço desejado inválido.");
    const validUntil = input.validUntil ? input.validUntil : null;
    if (validUntil && (!isIsoDate(validUntil) || validUntil < todaySP()))
      return fail("A validade precisa ser hoje ou uma data futura.");

    const supabase = await createClient();
    const slotError = await checkTickerSlot(supabase, ticker);
    if (slotError) return fail(slotError);

    const { error } = await supabase.from("scheduled_orders").insert({
      ticker,
      quantity: SHARES_PER_TICKER,
      limit_price: Math.round(input.limitPrice * 10000) / 10000,
      valid_until: validUntil,
      created_by: user.id,
    });
    if (error) {
      if (/scheduled_orders/.test(error.message) && /does not exist|schema cache/i.test(error.message)) {
        return fail("Tabela de agendamentos não encontrada: rode supabase/migrations/0002_scheduled_orders.sql.");
      }
      return fail(friendlyDbError(error));
    }

    refresh();
    const market = marketStatus();
    return {
      ok: true,
      message:
        `Compra agendada: ${SHARES_PER_TICKER} ações de ${ticker} a até ${formatBRL(input.limitPrice)}` +
        (validUntil ? `, válida até ${formatDate(validUntil)}` : "") +
        `. Será executada no horário do pregão (${market.openTime}–${market.closeTime}) quando a cotação estiver nesse preço ou abaixo.`,
    };
  } catch (err) {
    return guard(err);
  }
}

export async function cancelOrder(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return fail("Agendamento inválido.");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("scheduled_orders")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("status", "pending")
      .select("id");
    if (error) return fail(friendlyDbError(error));
    if (!data?.length) return fail("Só é possível cancelar agendamentos pendentes.");
    refresh();
    return { ok: true, message: "Agendamento cancelado." };
  } catch (err) {
    return guard(err);
  }
}

/** Verifica agora as compras agendadas (só no horário do pregão). */
export async function runOrdersNow(): Promise<ActionResult<OrderRunResult[]>> {
  try {
    await requireAdmin(); // valida admin ANTES de usar service role
    const run = await executeDueOrders();
    if (!run.ran) return fail(run.reason ?? "Pregão fechado.");
    refresh();
    const executed = run.results.filter((r) => r.outcome === "executed").length;
    const waiting = run.results.filter((r) => r.outcome === "waiting").length;
    return {
      ok: true,
      data: run.results,
      message: run.results.length
        ? `${executed} executada(s), ${waiting} aguardando o preço.`
        : "Nenhuma compra agendada pendente.",
      warnings: run.results
        .filter((r) => r.outcome === "failed" || r.outcome === "skipped")
        .map((r) => `${r.ticker}: ${r.detail}`),
    };
  } catch (err) {
    return guard(err);
  }
}
