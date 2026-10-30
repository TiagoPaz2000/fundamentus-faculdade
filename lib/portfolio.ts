import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashMovement, Database, Position, Quote } from "@/lib/database.types";
import { PORTFOLIO_LIMIT, friendlyDbError } from "@/lib/errors";
import { SCREENSHOT_BUCKET } from "@/lib/quotes";

type Client = SupabaseClient<Database>;

export type LatestQuote = {
  price: number;
  date: string;
  source: Quote["source"];
  changePct: number | null;
};

export type PositionView = Position & {
  buyTotal: number;
  current: LatestQuote | null;
  /** Preço de referência: venda (fechadas) ou cotação atual (abertas). */
  refPrice: number | null;
  varPct: number | null;
  varBRL: number | null;
  marketValue: number | null;
  buyScreenshotUrl: string | null;
  sellScreenshotUrl: string | null;
};

export type PortfolioSummary = {
  cashBalance: number;
  investedOpen: number;
  marketValueOpen: number;
  unrealized: number;
  realized: number;
  totalResult: number;
  openShares: number;
  limit: number;
};

const PAGE = 1000;

/** Busca todas as linhas paginando (o PostgREST limita a 1000 por request). */
export async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(friendlyDbError(error));
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/**
 * Cotação mais recente de cada ticker. Se InfoMoney e Fundamentus forem do mesmo dia,
 * prefere InfoMoney; senão vale a de data mais recente. Se a escolhida não tiver
 * variação do dia, usa a da outra fonte no mesmo dia.
 */
export async function getLatestQuotes(supabase: Client, tickers: string[]): Promise<Map<string, LatestQuote>> {
  const unique = [...new Set(tickers)];
  const entries = await Promise.all(
    unique.map(async (ticker) => {
      const { data, error } = await supabase
        .from("quotes")
        .select("source, quote_date, price, change_pct")
        .eq("ticker", ticker)
        .order("quote_date", { ascending: false })
        .order("source", { ascending: false }) // "infomoney" > "fundamentus"
        .limit(2);
      if (error || !data?.length) return null;
      const [best, other] = data;
      const changePct =
        best.change_pct ?? (other && other.quote_date === best.quote_date ? other.change_pct : null);
      return [ticker, { price: Number(best.price), date: best.quote_date, source: best.source, changePct }] as const;
    }),
  );
  return new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}

export async function getCashBalance(supabase: Client): Promise<number> {
  const { data, error } = await supabase.from("cash_balance").select("balance").maybeSingle();
  if (error) throw new Error(friendlyDbError(error));
  return Number(data?.balance ?? 0);
}

/** Gera signed URLs (em lote) para os prints. */
export async function signScreenshots(
  supabase: Client,
  paths: (string | null | undefined)[],
  expiresInSeconds: number,
): Promise<Map<string, string>> {
  const list = [...new Set(paths.filter((p): p is string => Boolean(p)))];
  const map = new Map<string, string>();
  if (!list.length) return map;
  const { data, error } = await supabase.storage.from(SCREENSHOT_BUCKET).createSignedUrls(list, expiresInSeconds);
  if (error || !data) {
    console.error("Falha ao assinar URLs dos prints:", error);
    return map;
  }
  for (const item of data) {
    if (item.path && item.signedUrl) map.set(item.path, item.signedUrl);
  }
  return map;
}

export function buildPositionView(
  p: Position,
  current: LatestQuote | null,
  urls: Map<string, string>,
): PositionView {
  const buyPrice = Number(p.buy_price);
  const sellPrice = p.sell_price === null ? null : Number(p.sell_price);
  const buyTotal = buyPrice * p.quantity;
  const refPrice = p.status === "closed" ? sellPrice : (current?.price ?? null);
  const varBRL = refPrice === null ? null : (refPrice - buyPrice) * p.quantity;
  const varPct = refPrice === null ? null : ((refPrice - buyPrice) / buyPrice) * 100;
  return {
    ...p,
    buy_price: buyPrice,
    sell_price: sellPrice,
    buyTotal,
    current,
    refPrice,
    varPct,
    varBRL,
    marketValue: p.status === "open" && current ? current.price * p.quantity : null,
    buyScreenshotUrl: p.buy_screenshot_path ? (urls.get(p.buy_screenshot_path) ?? null) : null,
    sellScreenshotUrl: p.sell_screenshot_path ? (urls.get(p.sell_screenshot_path) ?? null) : null,
  };
}

export function summarize(views: PositionView[], cashBalance: number): PortfolioSummary {
  let investedOpen = 0;
  let marketValueOpen = 0;
  let unrealized = 0;
  let realized = 0;
  let openShares = 0;
  for (const v of views) {
    if (v.status === "open") {
      openShares += v.quantity;
      investedOpen += v.buyTotal;
      // Sem cotação: considera o preço de compra (variação zero).
      marketValueOpen += v.marketValue ?? v.buyTotal;
      unrealized += v.varBRL ?? 0;
    } else {
      realized += v.varBRL ?? 0;
    }
  }
  return {
    cashBalance,
    investedOpen,
    marketValueOpen,
    unrealized,
    realized,
    totalResult: unrealized + realized,
    openShares,
    limit: PORTFOLIO_LIMIT,
  };
}

export type PortfolioData = {
  positions: PositionView[];
  summary: PortfolioSummary;
};

/** Carrega toda a carteira (posições + última cotação + prints assinados + caixa). */
export async function loadPortfolio(
  supabase: Client,
  opts: { ticker?: string; signedUrlSeconds?: number } = {},
): Promise<PortfolioData> {
  const positions = await fetchAll<Position>((from, to) => {
    let q = supabase.from("positions").select("*");
    if (opts.ticker) q = q.eq("ticker", opts.ticker);
    return q
      .order("status", { ascending: false }) // open primeiro
      .order("buy_date", { ascending: false })
      .order("created_at", { ascending: false })
      .range(from, to);
  });

  const [latest, cashBalance, urls] = await Promise.all([
    getLatestQuotes(
      supabase,
      positions.map((p) => p.ticker),
    ),
    getCashBalance(supabase),
    signScreenshots(
      supabase,
      positions.flatMap((p) => [p.buy_screenshot_path, p.sell_screenshot_path]),
      opts.signedUrlSeconds ?? 60 * 60,
    ),
  ]);

  const views = positions.map((p) => buildPositionView(p, latest.get(p.ticker) ?? null, urls));
  return { positions: views, summary: summarize(views, cashBalance) };
}

export async function getOpenShares(supabase: Client, excludeId?: string): Promise<number> {
  let q = supabase.from("positions").select("id, quantity").eq("status", "open");
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw new Error(friendlyDbError(error));
  return (data ?? []).reduce((s, r) => s + r.quantity, 0);
}

export async function loadCashMovements(supabase: Client) {
  const movements = await fetchAll<CashMovement>((from, to) =>
    supabase
      .from("cash_movements")
      .select("*")
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  const { data: pos } = await supabase.from("positions").select("id, ticker");
  const tickerById = new Map((pos ?? []).map((p) => [p.id, p.ticker]));
  let running = 0;
  return movements.map((m) => {
    running += Number(m.amount);
    return {
      ...m,
      amount: Number(m.amount),
      ticker: m.position_id ? (tickerById.get(m.position_id) ?? null) : null,
      balanceAfter: Math.round(running * 100) / 100,
    };
  });
}

export type CashMovementView = Awaited<ReturnType<typeof loadCashMovements>>[number];
