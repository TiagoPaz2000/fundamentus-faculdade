"use server";

import { refresh } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { fail } from "@/lib/action-result";
import { AuthError, requireAdmin, requireUser } from "@/lib/auth";
import { MAX_QUOTE_AGE_DAYS, addDays, daysBetween, isIsoDate, todaySP } from "@/lib/dates";
import { SHARES_PER_TICKER, errorMessage, friendlyDbError } from "@/lib/errors";
import { formatBRL, formatDate } from "@/lib/format";
import { checkTickerSlot, getCashBalance } from "@/lib/portfolio";
import { HISTORY_DAYS_BEFORE_BUY, runBuyFollowups } from "@/lib/buy-followup";
import { marketStatus, priceBasisLabel } from "@/lib/market-hours";
import {
  captureFundamentusScreenshot,
  fetchCurrentQuote,
  importInfomoneyHistory,
  normalizeTicker,
  refreshCurrentQuotes,
  removeScreenshots,
  upsertQuotes,
} from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function guard(err: unknown): { ok: false; error: string } {
  if (err instanceof AuthError) return fail(err.message);
  console.error(err);
  return fail(errorMessage(err));
}

function validPrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e9;
}

function validId(v: unknown): v is string {
  return typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);
}

// ---------------------------------------------------------------------------
// Cotação atual (pré-preenche compra e venda)
// ---------------------------------------------------------------------------

export type QuoteLookup = {
  ticker: string;
  price: number;
  quoteDate: string;
  source: "fundamentus" | "infomoney";
  changePct: number | null;
  note?: string;
  /** Cotação velha demais (papel sem negociação recente): não pode ser comprado. */
  stale: boolean;
  /** Pregão aberto agora (no servidor, no momento da consulta). */
  marketOpen: boolean;
  /** Preço que a compra vai usar: "cotação atual" ou "fechamento de dd/mm". */
  priceBasis: string;
};

export async function lookupQuote(tickerInput: string): Promise<ActionResult<QuoteLookup>> {
  try {
    await requireUser(); // qualquer membro consulta para comprar
    const ticker = normalizeTicker(tickerInput);
    if (!ticker) return fail("Ticker inválido.");
    let current: Awaited<ReturnType<typeof fetchCurrentQuote>>;
    try {
      current = await fetchCurrentQuote(ticker);
    } catch (e) {
      console.error("lookupQuote:", errorMessage(e));
      return fail(`Sem cotação atual para ${ticker}. O papel pode estar fora de negociação ou os sites estão indisponíveis.`);
    }
    const { quote, fallbackFrom } = current;
    // Aproveita para gravar a cotação (não bloqueia em caso de erro).
    await upsertQuotes([quote]).catch((e) => console.error("upsert cotação:", e));
    const today = todaySP();
    const marketOpen = marketStatus().open;
    return {
      ok: true,
      data: {
        ticker,
        price: quote.price,
        quoteDate: quote.quoteDate,
        source: quote.source,
        changePct: quote.changePct,
        note: fallbackFrom ? "Fundamentus indisponível; cotação do InfoMoney." : undefined,
        stale: daysBetween(quote.quoteDate, today) > MAX_QUOTE_AGE_DAYS,
        marketOpen,
        priceBasis: priceBasisLabel(quote.quoteDate, today, marketOpen),
      },
    };
  } catch (err) {
    return guard(err);
  }
}

// ---------------------------------------------------------------------------
// Compra
// ---------------------------------------------------------------------------

/**
 * Compra: aceita a qualquer hora e em qualquer dia. Data sempre hoje, quantidade
 * sempre SHARES_PER_TICKER (100) e preço = cotação buscada AGORA no servidor
 * (Fundamentus, com fallback InfoMoney). Fora do pregão essa cotação já é a do
 * último fechamento (a data vem do próprio site). A carteira tem no máximo 10
 * papéis e cada membro no máximo MAX_PER_USER (2) papéis abertos.
 * Qualquer membro compra, sempre em nome próprio (created_by = usuário logado).
 */
export type BuyInput = { ticker: string };

export async function buyPosition(
  input: BuyInput,
): Promise<ActionResult<{ id: string; price: number; source: "fundamentus" | "infomoney" }>> {
  try {
    const user = await requireUser();
    const ticker = normalizeTicker(input?.ticker);
    if (!ticker) return fail("Ticker inválido (use, por exemplo, PETR4).");
    const quantity = SHARES_PER_TICKER;
    const buyDate = todaySP();

    const supabase = await createClient();

    const slotError = await checkTickerSlot(supabase, ticker, { userId: user.id });
    if (slotError) return fail(slotError);

    // Preço da compra = cotação buscada no momento do clique (fora do pregão,
    // é o último fechamento).
    let price: number;
    let source: "fundamentus" | "infomoney";
    let basis: string;
    try {
      const { quote } = await fetchCurrentQuote(ticker);
      if (!validPrice(quote.price)) return fail(`Cotação inválida para ${ticker}.`);
      if (daysBetween(quote.quoteDate, buyDate) > MAX_QUOTE_AGE_DAYS) {
        return fail(`${ticker} não tem negociação recente (última cotação em ${formatDate(quote.quoteDate)}). Escolha outro papel.`);
      }
      price = quote.price;
      source = quote.source;
      basis = priceBasisLabel(quote.quoteDate, buyDate, marketStatus().open);
      await upsertQuotes([quote]).catch((e) => console.error("upsert cotação:", e));
    } catch (e) {
      return fail(`Não foi possível obter a cotação atual de ${ticker}: ${errorMessage(e)}`);
    }

    // a) insere com service role: o preço/data vêm do servidor (cotação atual),
    //    nunca do cliente, e o RLS só deixa admin inserir direto. created_by é
    //    o usuário logado. O banco valida os limites de novo e debita o caixa.
    const { data: inserted, error } = await createAdminClient()
      .from("positions")
      .insert({
        ticker,
        quantity,
        buy_date: buyDate,
        buy_price: price,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error || !inserted) return fail(friendlyDbError(error));
    const id = inserted.id;

    // b) print, c) histórico e d) cotação atual. Falhas não desfazem a compra.
    // Gravar o caminho do print é UPDATE em positions, que o RLS só libera para
    // admin: usa o service role (membro já validado; a posição acabou de ser criada por ele).
    const warnings = await runBuyFollowups(createAdminClient(), ticker, id, buyDate);

    try {
      const balance = await getCashBalance(supabase);
      if (balance < 0) warnings.push(`Atenção: o saldo em caixa ficou negativo (${formatBRL(balance)}).`);
    } catch {
      // só um aviso; ignora
    }

    refresh();
    return {
      ok: true,
      data: { id, price, source },
      message: `Compradas ${quantity} ações de ${ticker} a ${formatBRL(price)}, ${basis} (total ${formatBRL(price * quantity)}).`,
      warnings,
    };
  } catch (err) {
    return guard(err);
  }
}

// ---------------------------------------------------------------------------
// Fechamento / reabertura / edição / exclusão
// ---------------------------------------------------------------------------

export type CloseInput = { id: string; sellDate: string; sellPrice: number };

export async function closePosition(input: CloseInput): Promise<ActionResult> {
  try {
    const user = await requireAdmin();
    if (!validId(input?.id)) return fail("Posição inválida.");
    if (!isIsoDate(input.sellDate)) return fail("Data de venda inválida.");
    if (input.sellDate > todaySP()) return fail("A data de venda não pode ser no futuro.");
    if (!validPrice(input.sellPrice)) return fail("Preço de venda inválido.");

    const supabase = await createClient();
    const { data: pos, error: getErr } = await supabase
      .from("positions")
      .select("id, ticker, status, buy_date")
      .eq("id", input.id)
      .single();
    if (getErr || !pos) return fail(friendlyDbError(getErr));
    if (pos.status === "closed") return fail("Essa posição já está fechada.");
    if (input.sellDate < pos.buy_date) return fail("A data de venda não pode ser anterior à data de compra.");

    const { error } = await supabase
      .from("positions")
      .update({ status: "closed", sell_date: input.sellDate, sell_price: input.sellPrice, closed_by: user.id })
      .eq("id", pos.id);
    if (error) return fail(friendlyDbError(error));

    const warnings: string[] = [];
    try {
      const path = await captureFundamentusScreenshot(pos.ticker, pos.id, "sell");
      const { error: upErr } = await supabase.from("positions").update({ sell_screenshot_path: path }).eq("id", pos.id);
      if (upErr) throw new Error(friendlyDbError(upErr));
    } catch (e) {
      console.error(`[venda ${pos.ticker}] print falhou:`, e);
      warnings.push(`Não foi possível tirar o print da venda (${errorMessage(e)}). Use "Tirar print novamente".`);
    }

    refresh();
    return { ok: true, message: `Posição de ${pos.ticker} fechada.`, warnings };
  } catch (err) {
    return guard(err);
  }
}

export async function reopenPosition(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!validId(id)) return fail("Posição inválida.");
    const supabase = await createClient();
    const { data: pos, error: getErr } = await supabase
      .from("positions")
      .select("id, ticker, quantity, status, sell_screenshot_path")
      .eq("id", id)
      .single();
    if (getErr || !pos) return fail(friendlyDbError(getErr));
    if (pos.status === "open") return fail("A posição já está aberta.");

    const slotError = await checkTickerSlot(supabase, pos.ticker, { excludePositionId: pos.id });
    if (slotError) return fail(`Não dá para reabrir: ${slotError}`);

    const { error } = await supabase
      .from("positions")
      .update({ status: "open", sell_date: null, sell_price: null, closed_by: null, sell_screenshot_path: null })
      .eq("id", id);
    if (error) return fail(friendlyDbError(error));
    await removeScreenshots([pos.sell_screenshot_path]);

    refresh();
    return { ok: true, message: `Posição de ${pos.ticker} reaberta (o crédito da venda foi removido do caixa).` };
  } catch (err) {
    return guard(err);
  }
}

/** A quantidade não é editável: cada papel tem sempre 100 ações (SHARES_PER_TICKER). */
export type UpdateInput = {
  id: string;
  buyDate: string;
  buyPrice: number;
  sellDate?: string | null;
  sellPrice?: number | null;
};

export async function updatePosition(input: UpdateInput): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!validId(input?.id)) return fail("Posição inválida.");
    if (!isIsoDate(input.buyDate)) return fail("Data de compra inválida.");
    if (input.buyDate > todaySP()) return fail("A data de compra não pode ser no futuro.");
    if (!validPrice(input.buyPrice)) return fail("Preço de compra inválido.");

    const supabase = await createClient();
    const { data: pos, error: getErr } = await supabase
      .from("positions")
      .select("id, ticker, status")
      .eq("id", input.id)
      .single();
    if (getErr || !pos) return fail(friendlyDbError(getErr));

    const patch: {
      buy_date: string;
      buy_price: number;
      sell_date?: string;
      sell_price?: number;
    } = { buy_date: input.buyDate, buy_price: input.buyPrice };

    if (pos.status === "closed") {
      if (!input.sellDate || !isIsoDate(input.sellDate)) return fail("Data de venda inválida.");
      if (!validPrice(input.sellPrice)) return fail("Preço de venda inválido.");
      if (input.sellDate < input.buyDate) return fail("A data de venda não pode ser anterior à data de compra.");
      patch.sell_date = input.sellDate;
      patch.sell_price = input.sellPrice;
    }

    const { error } = await supabase.from("positions").update(patch).eq("id", pos.id);
    if (error) return fail(friendlyDbError(error));

    refresh();
    return { ok: true, message: `Posição de ${pos.ticker} atualizada.` };
  } catch (err) {
    return guard(err);
  }
}

export async function deletePosition(id: string): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!validId(id)) return fail("Posição inválida.");
    const supabase = await createClient();
    const { data: pos, error: getErr } = await supabase
      .from("positions")
      .select("id, ticker, buy_screenshot_path, sell_screenshot_path")
      .eq("id", id)
      .single();
    if (getErr || !pos) return fail(friendlyDbError(getErr));

    const { error } = await supabase.from("positions").delete().eq("id", id);
    if (error) return fail(friendlyDbError(error));
    await removeScreenshots([pos.buy_screenshot_path, pos.sell_screenshot_path]);

    refresh();
    return { ok: true, message: `Posição de ${pos.ticker} excluída (os lançamentos de caixa dela também).` };
  } catch (err) {
    return guard(err);
  }
}

// ---------------------------------------------------------------------------
// Reprocessamento: print e histórico
// ---------------------------------------------------------------------------

export async function retakeScreenshot(id: string, kind: "buy" | "sell"): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!validId(id)) return fail("Posição inválida.");
    if (kind !== "buy" && kind !== "sell") return fail("Tipo de print inválido.");
    const supabase = await createClient();
    const { data: pos, error: getErr } = await supabase
      .from("positions")
      .select("id, ticker, status, buy_screenshot_path, sell_screenshot_path")
      .eq("id", id)
      .single();
    if (getErr || !pos) return fail(friendlyDbError(getErr));
    if (kind === "sell" && pos.status !== "closed") return fail("A posição não está fechada.");

    const path = await captureFundamentusScreenshot(pos.ticker, pos.id, kind);
    const old = kind === "buy" ? pos.buy_screenshot_path : pos.sell_screenshot_path;
    const { error } = await supabase
      .from("positions")
      .update(kind === "buy" ? { buy_screenshot_path: path } : { sell_screenshot_path: path })
      .eq("id", pos.id);
    if (error) return fail(friendlyDbError(error));
    if (old && old !== path) await removeScreenshots([old]);

    refresh();
    return {
      ok: true,
      message: `Novo print de ${pos.ticker} salvo. Ele mostra a página de agora, não a da data original.`,
    };
  } catch (err) {
    return guard(err);
  }
}

export async function reimportHistory(tickerInput: string): Promise<ActionResult<{ rows: number }>> {
  try {
    await requireAdmin();
    const ticker = normalizeTicker(tickerInput);
    if (!ticker) return fail("Ticker inválido.");
    const supabase = await createClient();
    const { data: first, error } = await supabase
      .from("positions")
      .select("buy_date")
      .eq("ticker", ticker)
      .order("buy_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return fail(friendlyDbError(error));
    const from = addDays(first?.buy_date ?? todaySP(), -HISTORY_DAYS_BEFORE_BUY);

    const rows = await importInfomoneyHistory(ticker, from);
    const current = await refreshCurrentQuotes(ticker);

    refresh();
    return {
      ok: true,
      data: { rows },
      message: `${rows} dia(s) de histórico de ${ticker} importados desde ${formatDate(from)}.`,
      warnings: current.errors.length ? [`Cotação atual parcial: ${current.errors.join("; ")}`] : [],
    };
  } catch (err) {
    return guard(err);
  }
}
