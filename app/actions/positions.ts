"use server";

import { refresh } from "next/cache";
import type { ActionResult } from "@/lib/action-result";
import { fail } from "@/lib/action-result";
import { AuthError, requireAdmin } from "@/lib/auth";
import { addDays, isIsoDate, todaySP } from "@/lib/dates";
import { PORTFOLIO_LIMIT, errorMessage, friendlyDbError } from "@/lib/errors";
import { formatBRL, formatDate } from "@/lib/format";
import { getCashBalance, getOpenShares } from "@/lib/portfolio";
import {
  captureFundamentusScreenshot,
  fetchCurrentQuote,
  importInfomoneyHistory,
  normalizeTicker,
  refreshCurrentQuotes,
  removeScreenshots,
  upsertQuotes,
} from "@/lib/quotes";
import { createClient } from "@/lib/supabase/server";

const HISTORY_DAYS_BEFORE_BUY = 180;

function guard(err: unknown): { ok: false; error: string } {
  if (err instanceof AuthError) return fail(err.message);
  console.error(err);
  return fail(errorMessage(err));
}

function validPrice(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v < 1e9;
}

function validQty(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= PORTFOLIO_LIMIT;
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
};

export async function lookupQuote(tickerInput: string): Promise<ActionResult<QuoteLookup>> {
  try {
    await requireAdmin();
    const ticker = normalizeTicker(tickerInput);
    if (!ticker) return fail("Ticker inválido.");
    const { quote, fallbackFrom } = await fetchCurrentQuote(ticker);
    // Aproveita para gravar a cotação (não bloqueia em caso de erro).
    await upsertQuotes([quote]).catch((e) => console.error("upsert cotação:", e));
    return {
      ok: true,
      data: {
        ticker,
        price: quote.price,
        quoteDate: quote.quoteDate,
        source: quote.source,
        changePct: quote.changePct,
        note: fallbackFrom ? "Fundamentus indisponível; cotação do InfoMoney." : undefined,
      },
    };
  } catch (err) {
    return guard(err);
  }
}

// ---------------------------------------------------------------------------
// Compra
// ---------------------------------------------------------------------------

export type BuyInput = { ticker: string; quantity: number; buyDate: string; buyPrice: number };

export async function buyPosition(input: BuyInput): Promise<ActionResult<{ id: string }>> {
  try {
    const user = await requireAdmin();
    const ticker = normalizeTicker(input?.ticker);
    if (!ticker) return fail("Ticker inválido (use, por exemplo, PETR4).");
    if (!validQty(input.quantity)) return fail("Quantidade deve ser um número inteiro entre 1 e 100.");
    if (!isIsoDate(input.buyDate)) return fail("Data de compra inválida.");
    if (input.buyDate > todaySP()) return fail("A data de compra não pode ser no futuro.");
    if (!validPrice(input.buyPrice)) return fail("Preço de compra inválido.");

    const supabase = await createClient();

    const open = await getOpenShares(supabase);
    if (open + input.quantity > PORTFOLIO_LIMIT) {
      return fail(
        `Limite de ${PORTFOLIO_LIMIT} ações abertas: a carteira já tem ${open}, então você pode comprar no máximo ${Math.max(0, PORTFOLIO_LIMIT - open)}.`,
      );
    }

    // a) insere a posição (o banco valida o limite de novo e debita o caixa)
    const { data: inserted, error } = await supabase
      .from("positions")
      .insert({
        ticker,
        quantity: input.quantity,
        buy_date: input.buyDate,
        buy_price: input.buyPrice,
        created_by: user.id,
      })
      .select("id")
      .single();
    if (error || !inserted) return fail(friendlyDbError(error));
    const id = inserted.id;

    // b) print, c) histórico e d) cotação atual. Falhas não desfazem a compra.
    const warnings: string[] = [];
    const [shot, quotes] = await Promise.allSettled([
      (async () => {
        const path = await captureFundamentusScreenshot(ticker, id, "buy");
        const { error: upErr } = await supabase.from("positions").update({ buy_screenshot_path: path }).eq("id", id);
        if (upErr) throw new Error(friendlyDbError(upErr));
      })(),
      (async () => {
        // histórico primeiro, cotação atual depois (para não sobrescrever a variação do dia)
        let historyError: string | null = null;
        try {
          await importInfomoneyHistory(ticker, addDays(input.buyDate, -HISTORY_DAYS_BEFORE_BUY));
        } catch (e) {
          historyError = errorMessage(e);
        }
        const current = await refreshCurrentQuotes(ticker);
        return { historyError, currentErrors: current.errors };
      })(),
    ]);

    if (shot.status === "rejected") {
      console.error(`[compra ${ticker}] print falhou:`, shot.reason);
      warnings.push(`Não foi possível tirar o print (${errorMessage(shot.reason)}). Use "Tirar print novamente".`);
    }
    if (quotes.status === "rejected") {
      console.error(`[compra ${ticker}] cotações falharam:`, quotes.reason);
      warnings.push(`Falha ao gravar cotações (${errorMessage(quotes.reason)}). Use "Reimportar histórico".`);
    } else {
      if (quotes.value.historyError) {
        console.error(`[compra ${ticker}] histórico falhou:`, quotes.value.historyError);
        warnings.push(`Histórico do InfoMoney não importado (${quotes.value.historyError}). Use "Reimportar histórico".`);
      }
      if (quotes.value.currentErrors.length) {
        console.error(`[compra ${ticker}] cotação atual:`, quotes.value.currentErrors);
        warnings.push(`Cotação atual parcial: ${quotes.value.currentErrors.join("; ")}`);
      }
    }

    try {
      const balance = await getCashBalance(supabase);
      if (balance < 0) warnings.push(`Atenção: o saldo em caixa ficou negativo (${formatBRL(balance)}).`);
    } catch {
      // só um aviso; ignora
    }

    refresh();
    return { ok: true, data: { id }, message: `Compra de ${input.quantity} ${ticker} registrada.`, warnings };
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

    const open = await getOpenShares(supabase);
    if (open + pos.quantity > PORTFOLIO_LIMIT) {
      return fail(
        `Reabrir ultrapassaria o limite de ${PORTFOLIO_LIMIT} ações abertas (abertas: ${open}, esta posição: ${pos.quantity}).`,
      );
    }

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

export type UpdateInput = {
  id: string;
  quantity: number;
  buyDate: string;
  buyPrice: number;
  sellDate?: string | null;
  sellPrice?: number | null;
};

export async function updatePosition(input: UpdateInput): Promise<ActionResult> {
  try {
    await requireAdmin();
    if (!validId(input?.id)) return fail("Posição inválida.");
    if (!validQty(input.quantity)) return fail("Quantidade deve ser um número inteiro entre 1 e 100.");
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
      quantity: number;
      buy_date: string;
      buy_price: number;
      sell_date?: string;
      sell_price?: number;
    } = { quantity: input.quantity, buy_date: input.buyDate, buy_price: input.buyPrice };

    if (pos.status === "closed") {
      if (!input.sellDate || !isIsoDate(input.sellDate)) return fail("Data de venda inválida.");
      if (!validPrice(input.sellPrice)) return fail("Preço de venda inválido.");
      if (input.sellDate < input.buyDate) return fail("A data de venda não pode ser anterior à data de compra.");
      patch.sell_date = input.sellDate;
      patch.sell_price = input.sellPrice;
    } else {
      const open = await getOpenShares(supabase, pos.id);
      if (open + input.quantity > PORTFOLIO_LIMIT) {
        return fail(
          `Limite de ${PORTFOLIO_LIMIT} ações abertas: as outras posições somam ${open}, então esta pode ter no máximo ${Math.max(0, PORTFOLIO_LIMIT - open)}.`,
        );
      }
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
