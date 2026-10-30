"use server";

import { refresh } from "next/cache";
import { fail, type ActionResult } from "@/lib/action-result";
import { AuthError, requireUser } from "@/lib/auth";
import { MAX_QUOTE_AGE_DAYS, daysBetween, isIsoDate, todaySP } from "@/lib/dates";
import { SHARES_PER_TICKER, errorMessage, friendlyDbError } from "@/lib/errors";
import { formatBRL, formatDate } from "@/lib/format";
import { marketStatus } from "@/lib/market-hours";
import { checkTickerSlot } from "@/lib/portfolio";
import { fetchCurrentQuote, normalizeTicker } from "@/lib/quotes";
import { executeDueOrders, type OrderRunResult } from "@/lib/scheduled-orders";
import { createAdminClient } from "@/lib/supabase/admin";
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

/** Qualquer membro agenda, sempre em nome próprio (created_by = usuário logado). */
export async function scheduleOrder(input: ScheduleInput): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const ticker = normalizeTicker(input?.ticker);
    if (!ticker) return fail("Ticker inválido (use, por exemplo, PETR4).");
    if (!Number.isFinite(input.limitPrice) || input.limitPrice <= 0 || input.limitPrice >= 1e9)
      return fail("Preço desejado inválido.");
    const validUntil = input.validUntil ? input.validUntil : null;
    if (validUntil && (!isIsoDate(validUntil) || validUntil < todaySP()))
      return fail("A validade precisa ser hoje ou uma data futura.");

    const supabase = await createClient();
    // Carteira (10 papéis, um por vez) + limite do membro (2 abertos/agendados).
    const slotError = await checkTickerSlot(supabase, ticker, { userId: user.id });
    if (slotError) return fail(slotError);

    // Não deixa agendar papel sem negociação (ocuparia uma vaga para sempre).
    // Se os sites estiverem fora do ar, agenda mesmo assim.
    const warnings: string[] = [];
    try {
      const { quote } = await fetchCurrentQuote(ticker);
      if (daysBetween(quote.quoteDate, todaySP()) > MAX_QUOTE_AGE_DAYS) {
        return fail(`${ticker} não tem negociação recente (última cotação em ${formatDate(quote.quoteDate)}). Escolha outro papel.`);
      }
    } catch (e) {
      warnings.push(`Não deu para conferir a cotação de ${ticker} agora (${errorMessage(e)}).`);
    }

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
      warnings,
    };
  } catch (err) {
    return guard(err);
  }
}

/** Admin cancela qualquer ordem pendente; membro, só as próprias. */
export async function cancelOrder(id: string): Promise<ActionResult> {
  try {
    const user = await requireUser();
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) return fail("Agendamento inválido.");
    const supabase = await createClient();
    const { data: order, error: getErr } = await supabase
      .from("scheduled_orders")
      .select("id, status, created_by")
      .eq("id", id)
      .maybeSingle();
    if (getErr) return fail(friendlyDbError(getErr));
    if (!order) return fail("Agendamento não encontrado.");
    if (!user.isAdmin && order.created_by !== user.id) {
      return fail("Você só pode cancelar os seus próprios agendamentos.");
    }
    if (order.status !== "pending") return fail("Só é possível cancelar agendamentos pendentes.");

    // Service role (o RLS só deixa admin alterar ordens); dono já validado acima
    // e reforçado no próprio UPDATE. Só muda o status para 'cancelled'.
    let q = createAdminClient().from("scheduled_orders").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
    if (!user.isAdmin) q = q.eq("created_by", user.id);
    const { data, error } = await q.select("id");
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
    // Qualquer membro pode pedir a verificação. Valida ANTES de usar service role;
    // cada posição criada herda created_by da ordem (ver executeDueOrders).
    await requireUser();
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
