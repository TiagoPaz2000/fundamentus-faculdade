/**
 * Scraper do InfoMoney.
 *
 * As páginas de cotação (https://www.infomoney.com.br/cotacoes/b3/acao/<slug>/) NÃO trazem o
 * preço atual no HTML: tudo é carregado no navegador a partir da API de market data do
 * InfoMoney/XP (Azure API Management atrás do Akamai). Usamos essa mesma API JSON:
 *
 *   GET {BASE}b3/quotes/intraday/last?symbols=PETR4
 *       -> cotação atual (price, open, high, low, close = fechamento anterior, change %, volume R$)
 *   GET {BASE}b3/quotes/daily/PETR4?Page=1&PageSize=1000&StartDate=...&EndDate=...&Order=Asc
 *       -> histórico diário OHLC (é o que alimenta a seção "Histórico de PETR4" da página)
 *
 *   BASE = https://api-infomoney.xpi.com.br/infomoney-services-marketdata/v1/api/v1/
 *
 * Requisitos da API (descobertos empiricamente):
 *   - header `Ocp-Apim-Subscription-Key` (chave pública embutida nas páginas em
 *     window.InfoMoneyPage.api_marketdata.ocp_apim_subscription_key);
 *   - header `Origin: https://www.infomoney.com.br` e um User-Agent de navegador —
 *     sem eles o Akamai responde 403 "Access Denied" (HTML).
 *
 * Se a chave for rotacionada, ela é redescoberta automaticamente lendo o HTML de uma página
 * de cotação (ou definida via env INFOMONEY_API_KEY).
 *
 * A URL pública da página (o slug não é só o ticker: "petrobras-petr4",
 * "fundos-imobiliarios-mxrf11") é resolvida pela API REST do WordPress do site:
 *   GET https://www.infomoney.com.br/wp-json/wp/v2/cotacoes?search=PETR4&_fields=slug,link,title
 * Ela é só informativa (vai em raw.url); a API de market data usa apenas o ticker, então
 * ações, FIIs, ETFs e BDRs funcionam do mesmo jeito.
 */
import type { HistoryScraper, ScrapedQuote, Scraper } from "./types";

const SITE = "https://www.infomoney.com.br";
const DEFAULT_API_BASE = "https://api-infomoney.xpi.com.br/infomoney-services-marketdata/v1/api/v1/";
const DEFAULT_API_KEY = "9d461117ea1d4075adcc7e19340e4695";
const KEY_DISCOVERY_PAGE = `${SITE}/cotacoes/b3/acao/petrobras-petr4/`;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;
const HISTORY_PAGE_SIZE = 1000;
const HISTORY_MAX_PAGES = 20;

let apiBase = DEFAULT_API_BASE;
let apiKey = process.env.INFOMONEY_API_KEY || DEFAULT_API_KEY;
let keyRefreshed = false;

// ---------- tipos da API ----------

interface IntradayLastItem {
  symbol: string;
  tradeDate: string; // "2026-10-29T17:05:32" (horário de Brasília)
  close: number | null; // fechamento anterior
  open: number | null;
  price: number | null;
  change: number | null; // variação do dia em %
  changeMonth?: number | null;
  changeYear?: number | null;
  change52w?: number | null;
  high: number | null;
  low: number | null;
  avgPrice?: number | null;
  volume: number | null; // volume financeiro (R$)
  trade?: number | null; // nº de negócios
}

interface DailyItem {
  symbol: string;
  exchange?: string;
  tradeDate: string;
  open: number | null;
  high: number | null;
  close: number | null;
  low: number | null;
  change: number | null;
  tradeVolume?: number | null; // qtd. de ações (no pregão corrente vem o nº de negócios)
  financialVolume?: number | null; // volume financeiro (R$)
}

interface ApiList<T> {
  result?: T[];
  pageInfo?: { hasNextPage?: boolean };
}

// ---------- helpers ----------

function normalizeTicker(ticker: string): string {
  const t = (ticker ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(t)) {
    throw new Error(`InfoMoney: ticker inválido "${ticker}"`);
  }
  return t;
}

/** Data de hoje (YYYY-MM-DD) em America/Sao_Paulo. */
function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** "2026-10-29T17:05:32" | "29/10/2026" -> "2026-10-29" */
function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9", ...init.headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
}

/** Relê a chave/base da API a partir do JSON window.InfoMoneyPage embutido numa página. */
async function refreshApiKey(): Promise<boolean> {
  if (keyRefreshed) return false;
  keyRefreshed = true;
  try {
    const res = await fetchWithTimeout(KEY_DISCOVERY_PAGE, { headers: { Accept: "text/html" } });
    if (!res.ok) return false;
    const html = await res.text();
    const block = /"api_marketdata":\{([^}]*)\}/.exec(html)?.[1];
    if (!block) return false;
    const key = /"ocp_apim_subscription_key":"([^"]+)"/.exec(block)?.[1];
    const base = /"base_api_marketdata":"([^"]+)"/.exec(block)?.[1]?.replace(/\\\//g, "/");
    if (!key) return false;
    const changed = key !== apiKey || (!!base && base !== apiBase);
    apiKey = key;
    if (base) apiBase = base.endsWith("/") ? base : `${base}/`;
    return changed;
  } catch {
    return false;
  }
}

/** GET na API de market data. Retorna null em 204 (sem conteúdo = papel desconhecido). */
async function apiGet<T>(path: string, retry = true): Promise<T | null> {
  const url = apiBase + path;
  const res = await fetchWithTimeout(url, {
    headers: {
      Accept: "application/json",
      Origin: SITE,
      Referer: `${SITE}/`,
      "Ocp-Apim-Subscription-Key": apiKey,
    },
  });
  if (res.status === 204) return null;
  if ((res.status === 401 || res.status === 403) && retry && (await refreshApiKey())) {
    return apiGet<T>(path, false);
  }
  const body = await res.text();
  if (!res.ok) {
    const blocked = /Access Denied/i.test(body) ? " (bloqueado pelo Akamai: Access Denied)" : "";
    throw new Error(`InfoMoney API HTTP ${res.status}${blocked} em ${url}: ${body.slice(0, 200)}`);
  }
  if (!body.trim()) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error(`InfoMoney API: resposta não-JSON em ${url}: ${body.slice(0, 200)}`);
  }
}

/** Resolve ticker -> URL da página de cotação via WP REST do site. Best-effort (null se falhar). */
export async function resolveInfomoneyUrl(ticker: string): Promise<string | null> {
  const t = normalizeTicker(ticker);
  try {
    const res = await fetchWithTimeout(
      `${SITE}/wp-json/wp/v2/cotacoes?search=${encodeURIComponent(t)}&_fields=slug,link&per_page=20`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const items = (await res.json()) as { slug?: string; link?: string }[];
    if (!Array.isArray(items)) return null;
    const suffix = `-${t.toLowerCase()}`;
    const hit = items.find((i) => i.slug?.endsWith(suffix) || i.slug === t.toLowerCase());
    return hit?.link ?? null;
  } catch {
    return null;
  }
}

async function fetchLast(ticker: string): Promise<IntradayLastItem | null> {
  const data = await apiGet<ApiList<IntradayLastItem>>(
    `b3/quotes/intraday/last?symbols=${encodeURIComponent(ticker)}`,
  );
  return data?.result?.find((r) => r.symbol?.toUpperCase() === ticker) ?? null;
}

// ---------- scrapers ----------

export const scrapeInfomoney: Scraper = async (rawTicker) => {
  const ticker = normalizeTicker(rawTicker);
  const [last, url] = await Promise.all([fetchLast(ticker), resolveInfomoneyUrl(ticker)]);

  if (!last) {
    throw new Error(`InfoMoney: papel "${ticker}" não encontrado`);
  }
  const price = num(last.price);
  if (price === null || price <= 0) {
    throw new Error(`InfoMoney: cotação sem preço para "${ticker}"`);
  }

  return {
    ticker,
    source: "infomoney",
    quoteDate: toIsoDate(last.tradeDate) ?? todaySaoPaulo(),
    price,
    open: num(last.open),
    high: num(last.high),
    low: num(last.low),
    volume: num(last.volume),
    changePct: num(last.change),
    raw: {
      url,
      tradeDateTime: last.tradeDate,
      previousClose: num(last.close),
      avgPrice: num(last.avgPrice),
      trades: num(last.trade),
      changeMonthPct: num(last.changeMonth),
      changeYearPct: num(last.changeYear),
      change52wPct: num(last.change52w),
      volumeUnit: "BRL",
    },
  };
};

export const fetchInfomoneyHistory: HistoryScraper = async (rawTicker, fromDate) => {
  const ticker = normalizeTicker(rawTicker);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate ?? "")) {
    throw new Error(`InfoMoney: fromDate inválido "${fromDate}" (esperado YYYY-MM-DD)`);
  }
  const today = todaySaoPaulo();
  if (fromDate > today) return [];

  const byDate = new Map<string, ScrapedQuote>();
  for (let page = 1; page <= HISTORY_MAX_PAGES; page++) {
    const qs = new URLSearchParams({
      Page: String(page),
      PageSize: String(HISTORY_PAGE_SIZE),
      StartDate: `${fromDate}T00:00:00`,
      EndDate: `${today}T23:59:59`,
      Order: "Asc",
    });
    const data = await apiGet<ApiList<DailyItem>>(
      `b3/quotes/daily/${encodeURIComponent(ticker)}?${qs}`,
    );
    const rows = data?.result ?? [];
    for (const r of rows) {
      const date = toIsoDate(r.tradeDate);
      const close = num(r.close);
      if (!date || close === null || close <= 0 || date < fromDate) continue;
      byDate.set(date, {
        ticker,
        source: "infomoney",
        quoteDate: date,
        price: close,
        open: num(r.open),
        high: num(r.high),
        low: num(r.low),
        // financialVolume (R$) é consistente entre dias; tradeVolume muda de significado no pregão corrente.
        volume: num(r.financialVolume),
        changePct: num(r.change),
      });
    }
    if (!data?.pageInfo?.hasNextPage || rows.length === 0) break;
  }

  if (byDate.size === 0) {
    // 204/vazio: distingue papel inexistente de papel sem pregões no período.
    if (!(await fetchLast(ticker))) {
      throw new Error(`InfoMoney: papel "${ticker}" não encontrado`);
    }
    return [];
  }

  return [...byDate.values()].sort((a, b) => a.quoteDate.localeCompare(b.quoteDate));
};
