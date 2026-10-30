import "server-only";
import { runBuyFollowups } from "@/lib/buy-followup";
import { todaySP } from "@/lib/dates";
import { SHARES_PER_TICKER, errorMessage, friendlyDbError } from "@/lib/errors";
import { marketStatus } from "@/lib/market-hours";
import { fetchCurrentQuote, upsertQuotes } from "@/lib/quotes";
import { createAdminClient } from "@/lib/supabase/admin";

export type OrderRunResult = {
  id: string;
  ticker: string;
  outcome: "executed" | "waiting" | "expired" | "failed" | "skipped";
  detail: string;
};

export type OrdersRun = {
  ran: boolean;
  reason?: string;
  results: OrderRunResult[];
};

/**
 * Executa as compras agendadas cujo preço-limite foi atingido.
 * Só roda no horário do pregão e só com cotação de HOJE (evita feriados).
 * Usa service role: quem chama precisa ter validado admin ou CRON_SECRET.
 */
export async function executeDueOrders(): Promise<OrdersRun> {
  const market = marketStatus();
  if (!market.open) return { ran: false, reason: market.label, results: [] };

  const admin = createAdminClient();
  const today = todaySP();
  const nowIso = new Date().toISOString();
  const results: OrderRunResult[] = [];

  // Ordens vencidas
  const { data: expired, error: expErr } = await admin
    .from("scheduled_orders")
    .update({ status: "expired", error: "Prazo de validade encerrado sem atingir o preço." })
    .eq("status", "pending")
    .lt("valid_until", today)
    .select("id, ticker");
  if (expErr) throw new Error(friendlyDbError(expErr));
  for (const o of expired ?? []) results.push({ id: o.id, ticker: o.ticker, outcome: "expired", detail: "vencida" });

  const { data: pending, error } = await admin
    .from("scheduled_orders")
    .select("*")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(friendlyDbError(error));
  if (!pending?.length) return { ran: true, results };

  // Uma cotação por ticker
  const tickers = [...new Set(pending.map((o) => o.ticker))];
  const quotes = new Map<string, { price: number; date: string } | { error: string }>();
  await Promise.all(
    tickers.map(async (t) => {
      try {
        const { quote } = await fetchCurrentQuote(t);
        quotes.set(t, { price: quote.price, date: quote.quoteDate });
        await upsertQuotes([quote]).catch(() => {});
      } catch (e) {
        quotes.set(t, { error: errorMessage(e) });
      }
    }),
  );

  // Executa em sequência (cada compra abre um Chromium para o print)
  for (const order of pending) {
    const q = quotes.get(order.ticker);
    if (!q || "error" in q) {
      const detail = q && "error" in q ? q.error : "sem cotação";
      await admin
        .from("scheduled_orders")
        .update({ last_checked_at: nowIso, error: `Cotação indisponível: ${detail}` })
        .eq("id", order.id);
      results.push({ id: order.id, ticker: order.ticker, outcome: "skipped", detail });
      continue;
    }
    if (q.date !== today) {
      const detail = `cotação de ${q.date}, não de hoje (feriado ou pregão ainda sem negócios?)`;
      await admin
        .from("scheduled_orders")
        .update({ last_checked_at: nowIso, last_check_price: q.price, error: null })
        .eq("id", order.id);
      results.push({ id: order.id, ticker: order.ticker, outcome: "skipped", detail });
      continue;
    }
    if (q.price > Number(order.limit_price)) {
      await admin
        .from("scheduled_orders")
        .update({ last_checked_at: nowIso, last_check_price: q.price, error: null })
        .eq("id", order.id);
      results.push({
        id: order.id,
        ticker: order.ticker,
        outcome: "waiting",
        detail: `cotação ${q.price} acima do limite ${order.limit_price}`,
      });
      continue;
    }

    // Reserva a ordem (evita execução dupla entre cron e botão)
    const { data: claimed } = await admin
      .from("scheduled_orders")
      .update({ status: "executing", last_checked_at: nowIso, last_check_price: q.price })
      .eq("id", order.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;

    const { data: pos, error: insErr } = await admin
      .from("positions")
      .insert({
        ticker: order.ticker,
        quantity: SHARES_PER_TICKER, // regra: sempre 100 ações por papel
        buy_date: today,
        buy_price: q.price,
        created_by: order.created_by,
      })
      .select("id")
      .single();

    if (insErr || !pos) {
      const msg = friendlyDbError(insErr);
      await admin.from("scheduled_orders").update({ status: "failed", error: msg }).eq("id", order.id);
      results.push({ id: order.id, ticker: order.ticker, outcome: "failed", detail: msg });
      continue;
    }

    const warnings = await runBuyFollowups(admin, order.ticker, pos.id, today);
    await admin
      .from("scheduled_orders")
      .update({
        status: "executed",
        position_id: pos.id,
        executed_price: q.price,
        executed_at: new Date().toISOString(),
        error: warnings.length ? warnings.join(" ") : null,
      })
      .eq("id", order.id);
    results.push({
      id: order.id,
      ticker: order.ticker,
      outcome: "executed",
      detail: `comprado a ${q.price}${warnings.length ? ` (avisos: ${warnings.join(" ")})` : ""}`,
    });
  }

  return { ran: true, results };
}
