import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashMovement, Database, Position, Quote, ScheduledOrder } from "@/lib/database.types";
import { MAX_PER_USER, MAX_TICKERS, SHARES_PER_TICKER, USER_LIMIT_MESSAGE, friendlyDbError } from "@/lib/errors";
import { displayName } from "@/lib/names";
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
  /** Quem comprou (nome do membro; "ex-membro" se saiu da carteira). */
  buyerName: string;
};

/** id do usuário → nome de exibição, para todos os membros atuais. */
export async function loadMemberNames(supabase: Client): Promise<Map<string, string>> {
  // select("*"): funciona com ou sem a coluna profiles.name (0005).
  const { data } = await supabase.from("profiles").select("*");
  return new Map(
    (data ?? []).map((p) => [p.id, displayName(p.email, (p as { name?: string | null }).name ?? null)]),
  );
}

/** Nome de quem comprou/agendou: membro atual, "ex-membro" ou "—" (sem autor). */
export function buyerLabel(userId: string | null, names: Map<string, string>): string {
  if (!userId) return "—";
  return names.get(userId) ?? "ex-membro";
}

export type PortfolioSummary = {
  cashBalance: number;
  investedOpen: number;
  marketValueOpen: number;
  unrealized: number;
  realized: number;
  totalResult: number;
  /** Total de ações em posições abertas. */
  openShares: number;
  /** Papéis com posição aberta (máximo MAX_TICKERS). */
  openTickers: number;
  maxTickers: number;
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
  names: Map<string, string> = new Map(),
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
    buyerName: buyerLabel(p.created_by, names),
  };
}

export function summarize(views: PositionView[], cashBalance: number): PortfolioSummary {
  let investedOpen = 0;
  let marketValueOpen = 0;
  let unrealized = 0;
  let realized = 0;
  let openShares = 0;
  const tickers = new Set<string>();
  for (const v of views) {
    if (v.status === "open") {
      openShares += v.quantity;
      tickers.add(v.ticker);
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
    openTickers: tickers.size,
    maxTickers: MAX_TICKERS,
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

  const [latest, cashBalance, urls, names] = await Promise.all([
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
    loadMemberNames(supabase),
  ]);

  const views = positions.map((p) => buildPositionView(p, latest.get(p.ticker) ?? null, urls, names));
  return { positions: views, summary: summarize(views, cashBalance) };
}

/** Papéis com posição aberta (distintos). */
export async function getOpenTickers(supabase: Client, excludePositionId?: string): Promise<string[]> {
  let q = supabase.from("positions").select("id, ticker").eq("status", "open");
  if (excludePositionId) q = q.neq("id", excludePositionId);
  const { data, error } = await q;
  if (error) throw new Error(friendlyDbError(error));
  return [...new Set((data ?? []).map((r) => r.ticker))];
}

/**
 * Agendamentos: pendentes primeiro, depois os mais recentes.
 * Devolve null se a tabela não existir (migration 0002 não aplicada).
 */
export async function loadScheduledOrders(supabase: Client): Promise<ScheduledOrder[] | null> {
  const { data, error } = await supabase
    .from("scheduled_orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("scheduled_orders:", error.message);
    return null;
  }
  const rank = (s: ScheduledOrder["status"]) => (s === "pending" || s === "executing" ? 0 : 1);
  return (data ?? [])
    .map((o) => ({
      ...o,
      limit_price: Number(o.limit_price),
      executed_price: o.executed_price === null ? null : Number(o.executed_price),
      last_check_price: o.last_check_price === null ? null : Number(o.last_check_price),
    }))
    .sort((a, b) => rank(a.status) - rank(b.status));
}

/** Papéis reservados por compras agendadas ainda não executadas. */
export async function getPendingOrderTickers(supabase: Client, excludeOrderId?: string): Promise<string[]> {
  let q = supabase.from("scheduled_orders").select("id, ticker").in("status", ["pending", "executing"]);
  if (excludeOrderId) q = q.neq("id", excludeOrderId);
  const { data, error } = await q;
  if (error) {
    // Ex.: migration 0002 ainda não aplicada. Não bloqueia o resto do app.
    console.error("scheduled_orders:", error.message);
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.ticker))];
}

// ---------------------------------------------------------------------------
// Vagas: carteira (MAX_TICKERS papéis) e por membro (MAX_PER_USER)
// ---------------------------------------------------------------------------

/** Máximo de papéis abertos/agendados por membro (trigger da 0005). */
export const MAX_SLOTS_PER_USER = MAX_PER_USER;

/**
 * Vagas usadas por um membro: posições abertas que ele comprou + ordens 'pending'
 * dele (mesma conta do trigger da 0005; 'executing' não conta). Vender libera a vaga.
 */
export async function getUserSlotsUsed(
  supabase: Client,
  userId: string,
  opts: { excludePositionId?: string; excludeOrderId?: string } = {},
): Promise<number> {
  let pq = supabase.from("positions").select("id").eq("status", "open").eq("created_by", userId);
  if (opts.excludePositionId) pq = pq.neq("id", opts.excludePositionId);
  let oq = supabase.from("scheduled_orders").select("id").eq("status", "pending").eq("created_by", userId);
  if (opts.excludeOrderId) oq = oq.neq("id", opts.excludeOrderId);
  const [p, o] = await Promise.all([pq, oq]);
  if (p.error) throw new Error(friendlyDbError(p.error));
  // Sem a tabela de agendamentos (0002 não aplicada) conta só as posições.
  return (p.data?.length ?? 0) + (o.error ? 0 : (o.data?.length ?? 0));
}

export type BuySlots = {
  /** Papéis do usuário: posições abertas dele + ordens 'pending' dele. */
  userUsed: number;
  maxPerUser: number;
  /** Papéis da carteira: abertos + agendados (pending/executing), distintos. */
  portfolioUsed: number;
  maxTickers: number;
};

/**
 * Mesma conta de checkTickerSlot/getUserSlotsUsed, a partir de dados já carregados
 * (para a página mostrar "Seus papéis: X/2" e "Carteira: X/10" sem nova consulta).
 */
export function countBuySlots(
  positions: Pick<Position, "status" | "ticker" | "created_by">[],
  orders: Pick<ScheduledOrder, "status" | "ticker" | "created_by">[] | null | undefined,
  userId: string,
): BuySlots {
  const open = positions.filter((p) => p.status === "open");
  const active = (orders ?? []).filter((o) => o.status === "pending" || o.status === "executing");
  const userUsed =
    open.filter((p) => p.created_by === userId).length +
    active.filter((o) => o.status === "pending" && o.created_by === userId).length;
  const portfolioUsed = new Set([...open.map((p) => p.ticker), ...active.map((o) => o.ticker)]).size;
  return { userUsed, maxPerUser: MAX_PER_USER, portfolioUsed, maxTickers: MAX_TICKERS };
}

/**
 * Regra da carteira: até MAX_TICKERS papéis, cada um com uma única posição aberta de
 * SHARES_PER_TICKER ações. Agendamentos pendentes reservam a vaga do papel.
 * Com `userId`, também aplica o limite de MAX_PER_USER papéis por membro.
 * Devolve a mensagem de erro, ou null se o papel pode entrar.
 */
export async function checkTickerSlot(
  supabase: Client,
  ticker: string,
  opts: { excludePositionId?: string; excludeOrderId?: string; userId?: string } = {},
): Promise<string | null> {
  const [open, pending] = await Promise.all([
    getOpenTickers(supabase, opts.excludePositionId),
    getPendingOrderTickers(supabase, opts.excludeOrderId),
  ]);
  if (open.includes(ticker)) {
    return `${ticker} já está na carteira. Cada papel entra uma única vez, com ${SHARES_PER_TICKER} ações.`;
  }
  if (pending.includes(ticker)) {
    return `${ticker} já tem uma compra agendada. Cancele o agendamento antes de comprar de novo.`;
  }
  if (opts.userId) {
    const mine = await getUserSlotsUsed(supabase, opts.userId, opts);
    if (mine >= MAX_PER_USER) return USER_LIMIT_MESSAGE;
  }
  const used = new Set([...open, ...pending]).size;
  if (used >= MAX_TICKERS) {
    return `A carteira já tem ${MAX_TICKERS} papéis (${open.length} abertos` +
      (pending.length ? ` + ${pending.length} agendados` : "") +
      `). Feche uma posição ou cancele um agendamento para escolher outro papel.`;
  }
  return null;
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
