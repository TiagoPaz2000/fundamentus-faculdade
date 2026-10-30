import "server-only";
import * as cheerio from "cheerio";
import { cacheLife } from "next/cache";
import { allSettledLimit } from "@/lib/concurrency";

/**
 * Dados da aba "Empresas". Três partes independentes, cada uma com seu cache, para a
 * tabela aparecer logo (nomes) e o resto chegar por streaming:
 *
 * 1) Nomes — getCompanyNames() (cache "days"), 1 requisição:
 *    https://www.fundamentus.com.br/detalhes.php → todos os papéis (≈1000) com
 *    nome comercial e razão social.
 *
 * 2) Setores — getSectors() (cache "days"; "minutes" se algum setor falhou):
 *    https://www.fundamentus.com.br/buscaavancada.php → <select name="setor"> (≈43 setores)
 *    https://www.fundamentus.com.br/resultado.php?setor=N → papéis do setor + Liq.2meses
 *    O Fundamentus (LiteSpeed) devolve corpo VAZIO com HTTP 200 quando recebe mais de ~4
 *    requisições em poucos segundos, e o bloqueio dura enquanto as requisições continuam.
 *    Por isso as páginas de setor vão uma por vez, com FUNDAMENTUS_GAP_MS entre elas
 *    (≈2–3 min sem cache), e um setor que falhar fica sem setor ("—") sem derrubar a lista.
 *    O subsetor ("segmento") só aparece na página de cada papel (não há lista de
 *    segmentos na busca): seria 1 requisição por papel, então não é mostrado.
 *
 * 3) Desempenho do mês — getMonthPerformance() (cache "hours"), API do InfoMoney
 *    (a mesma de lib/scrapers/infomoney.ts):
 *    GET b3/quotes/intraday/last?symbols=A,B,C… aceita centenas de símbolos por chamada →
 *      cotação atual, variação do dia, volume e data do último negócio (≈5 requisições).
 *      O campo `changeMonth` dessa API NÃO serve: é medido contra o fechamento do 1º
 *      pregão do mês (no dia 1 vale 0), não contra o último fechamento do mês anterior.
 *    GET b3/quotes/daily/<TICKER>?StartDate&EndDate (um símbolo por chamada) →
 *      fechamento do último pregão do mês anterior. Não muda no mês: cache por papel/mês.
 *      Só para os MONTH_LIMIT papéis de maior volume que negociaram no mês.
 *    Mês % = cotação atual / fechamento do mês anterior − 1 (a mesma conta do campo "Mês"
 *    em Oscilações na página do papel no Fundamentus).
 */

export type CompanyName = {
  ticker: string;
  /** Nome comercial (ex.: "PETROBRAS"). */
  name: string;
  /** Razão social (ex.: "PETRÓLEO BRASILEIRO S.A. - PETROBRAS"), se houver. */
  legalName: string | null;
};

export type SectorInfo = {
  sector: string;
  /** Liquidez média diária dos últimos 2 meses (R$), do Fundamentus. */
  liquidity: number | null;
};

export type SectorMap = {
  byTicker: Record<string, SectorInfo>;
  /** Setores consultados com sucesso / total. */
  ok: number;
  total: number;
};

export type PerfRow = {
  /** Variação no mês em % (ex.: 4.8 = +4,8%). null = não calculado. */
  monthPct: number | null;
  /** Variação do dia em %, só se o último negócio foi no pregão mais recente. */
  dayPct: number | null;
  price: number | null;
};

export type MonthPerformance = {
  /** "2026-10" */
  month: string;
  /** Data do pregão mais recente das cotações ("2026-10-29"). */
  asOf: string;
  rows: Record<string, PerfRow>;
  /** Papéis com Mês % calculado. */
  computed: number;
  limit: number;
};

export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

const FUNDAMENTUS = "https://www.fundamentus.com.br/";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** Intervalo entre requisições ao Fundamentus nesta varredura (2 s já é bloqueado; 3 s não). */
const FUNDAMENTUS_GAP_MS = 3_000;
/** Espera antes de repetir uma página que veio vazia (bloqueio temporário). */
const FUNDAMENTUS_RETRY_MS = 10_000;

/** Quantos papéis (os de maior volume que negociaram no mês) têm o Mês % calculado. */
export const MONTH_LIMIT = 400;
const PERF_CONCURRENCY = 6;
const QUOTE_CHUNK = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const TICKER_RE = /^[A-Z0-9]{4,12}$/;

class EmptyPageError extends Error {}

async function fetchFundamentus(path: string): Promise<string> {
  const res = await fetch(FUNDAMENTUS + path, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Fundamentus: HTTP ${res.status} em ${path}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength === 0) throw new EmptyPageError(`Fundamentus: resposta vazia em ${path} (limite de requisições)`);
  return new TextDecoder("windows-1252").decode(buf);
}

/** Uma nova tentativa, mais tarde, se a página vier vazia por bloqueio temporário. */
async function fetchFundamentusRetry(path: string): Promise<string> {
  try {
    return await fetchFundamentus(path);
  } catch (err) {
    if (!(err instanceof EmptyPageError)) throw err;
    await sleep(FUNDAMENTUS_RETRY_MS);
    return fetchFundamentus(path);
  }
}

/** "1.234.567,89" → 1234567.89 */
function parseBR(s: string): number | null {
  const t = s.replace(/[.%\s]/g, "").replace(",", ".");
  if (!t || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

// ---------------- 1) Nomes ----------------

/** Todos os papéis com nome e razão social. Cache de 1 dia. */
export async function getCompanyNames(): Promise<CompanyName[]> {
  "use cache";
  cacheLife("days");

  const $ = cheerio.load(await fetchFundamentusRetry("detalhes.php"));
  const seen = new Set<string>();
  const list: CompanyName[] = [];
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    const ticker = clean(tds.eq(0).find("a").text()).toUpperCase();
    if (!TICKER_RE.test(ticker) || seen.has(ticker)) return;
    seen.add(ticker);
    const name = clean(tds.eq(1).text());
    const legal = clean(tds.eq(2).text());
    list.push({ ticker, name: name || legal || ticker, legalName: legal || null });
  });
  if (list.length < 50) throw new Error("Fundamentus: lista de papéis vazia ou em formato inesperado");
  return list.sort((a, b) => a.ticker.localeCompare(b.ticker));
}

// ---------------- 2) Setores ----------------

async function fetchSectorOptions(): Promise<{ id: string; name: string }[]> {
  const $ = cheerio.load(await fetchFundamentusRetry("buscaavancada.php"));
  const out: { id: string; name: string }[] = [];
  $('select[name="setor"] option').each((_, el) => {
    const id = $(el).attr("value")?.trim();
    const name = clean($(el).text());
    if (id && /^\d+$/.test(id) && name) out.push({ id, name });
  });
  if (out.length === 0) throw new Error("Fundamentus: lista de setores vazia ou em formato inesperado");
  return out;
}

async function fetchSector(id: string): Promise<{ ticker: string; liquidity: number | null }[]> {
  const $ = cheerio.load(await fetchFundamentusRetry(`resultado.php?setor=${id}`));
  const headers = $("table thead th")
    .map((_, th) => clean($(th).text()))
    .get();
  const liqIdx = headers.findIndex((h) => /^Liq\.?\s*2\s*meses/i.test(h));
  const rows: { ticker: string; liquidity: number | null }[] = [];
  $("table tbody tr").each((_, tr) => {
    const tds = $(tr).find("td");
    const ticker = clean(tds.eq(0).text()).toUpperCase();
    if (!TICKER_RE.test(ticker)) return;
    rows.push({ ticker, liquidity: liqIdx >= 0 ? parseBR(clean(tds.eq(liqIdx).text())) : null });
  });
  return rows;
}

/** ticker → setor (+ Liq.2meses). Varredura lenta e educada; cache de 1 dia. */
export async function getSectors(): Promise<SectorMap> {
  "use cache";

  const sectors = await fetchSectorOptions();
  const byTicker: Record<string, SectorInfo> = {};
  let ok = 0;
  // Uma por vez, com intervalo: o Fundamentus bloqueia rajadas (ver comentário no topo).
  const results = await allSettledLimit(sectors, 1, async (s) => {
    await sleep(FUNDAMENTUS_GAP_MS);
    return fetchSector(s.id);
  });
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      console.error(`Fundamentus: setor ${sectors[i].id} (${sectors[i].name}) falhou:`, r.reason);
      return;
    }
    ok++;
    for (const row of r.value) {
      byTicker[row.ticker] ??= { sector: sectors[i].name, liquidity: row.liquidity };
    }
  });
  if (ok === 0) throw new Error("Fundamentus: nenhum setor pôde ser consultado.");
  // Resultado incompleto fica pouco tempo em cache, para tentar de novo logo.
  if (ok === sectors.length) cacheLife("days");
  else cacheLife("minutes");
  return { byTicker, ok, total: sectors.length };
}

// ---------------- 3) Desempenho do mês (InfoMoney) ----------------

const IM_SITE = "https://www.infomoney.com.br";
const IM_BASE = "https://api-infomoney.xpi.com.br/infomoney-services-marketdata/v1/api/v1/";
// Chave pública embutida nas páginas do InfoMoney (a mesma de lib/scrapers/infomoney.ts).
const IM_KEY = process.env.INFOMONEY_API_KEY || "9d461117ea1d4075adcc7e19340e4695";

type IntradayLast = {
  symbol: string;
  tradeDate: string;
  price: number | null;
  change: number | null;
  volume: number | null;
};
type DailyRow = { tradeDate: string; close: number | null };

async function imGet<T>(path: string): Promise<T | null> {
  const res = await fetch(IM_BASE + path, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
      Origin: IM_SITE,
      Referer: `${IM_SITE}/`,
      "Ocp-Apim-Subscription-Key": IM_KEY,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 204) return null;
  const body = await res.text();
  if (!res.ok) throw new Error(`InfoMoney API HTTP ${res.status}: ${body.slice(0, 120)}`);
  return body.trim() ? (JSON.parse(body) as T) : null;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Cotação mais recente de vários papéis (QUOTE_CHUNK por requisição). */
async function fetchLastQuotes(tickers: string[]): Promise<Map<string, IntradayLast>> {
  const chunks: string[][] = [];
  for (let i = 0; i < tickers.length; i += QUOTE_CHUNK) chunks.push(tickers.slice(i, i + QUOTE_CHUNK));
  const results = await allSettledLimit(chunks, 3, (chunk) =>
    imGet<{ result?: IntradayLast[] }>(`b3/quotes/intraday/last?symbols=${chunk.join(",")}`),
  );
  const map = new Map<string, IntradayLast>();
  let failed = 0;
  for (const r of results) {
    if (r.status === "rejected") {
      failed++;
      console.error("InfoMoney: lote de cotações falhou:", r.reason);
      continue;
    }
    for (const q of r.value?.result ?? []) if (q.symbol) map.set(q.symbol.toUpperCase(), q);
  }
  if (failed === chunks.length) throw new Error("InfoMoney: não foi possível obter as cotações.");
  return map;
}

/**
 * Fechamento do último pregão antes de `monthStart` (YYYY-MM-01). Não muda no mês: cache de 1 dia.
 * (A API não devolve o último dia de EndDate; por isso a janela passa do dia 1 e filtramos.)
 */
export async function getPrevMonthClose(ticker: string, monthStart: string): Promise<number | null> {
  "use cache";
  cacheLife("days");
  const qs = new URLSearchParams({
    Page: "1",
    PageSize: "60",
    StartDate: `${addDays(monthStart, -20)}T00:00:00`,
    EndDate: `${addDays(monthStart, 3)}T23:59:59`,
    Order: "Asc",
  });
  const data = await imGet<{ result?: DailyRow[] }>(`b3/quotes/daily/${encodeURIComponent(ticker)}?${qs}`);
  let close: number | null = null;
  for (const r of data?.result ?? []) {
    const d = r.tradeDate?.slice(0, 10);
    const c = num(r.close);
    if (d && d < monthStart && c !== null && c > 0) close = c;
  }
  return close;
}

async function computeMonthPerformance(): Promise<MonthPerformance> {
  const names = await getCompanyNames();
  const quotes = await fetchLastQuotes(names.map((c) => c.ticker));

  let asOf = "";
  for (const q of quotes.values()) {
    const d = q.tradeDate?.slice(0, 10) ?? "";
    if (d > asOf) asOf = d;
  }
  if (!asOf) throw new Error("InfoMoney: nenhuma cotação recente.");
  const month = asOf.slice(0, 7);
  const monthStart = `${month}-01`;

  // Candidatos: negociaram neste mês; maior volume (R$) primeiro.
  const candidates = [...quotes.values()]
    .filter((q) => (q.tradeDate?.slice(0, 10) ?? "") >= monthStart && (num(q.price) ?? 0) > 0)
    .sort((a, b) => (num(b.volume) ?? 0) - (num(a.volume) ?? 0))
    .slice(0, MONTH_LIMIT);

  const bases = await allSettledLimit(candidates, PERF_CONCURRENCY, (q) =>
    getPrevMonthClose(q.symbol.toUpperCase(), monthStart),
  );

  const rows: Record<string, PerfRow> = {};
  for (const [ticker, q] of quotes) {
    rows[ticker] = {
      monthPct: null,
      dayPct: q.tradeDate?.slice(0, 10) === asOf ? num(q.change) : null,
      price: num(q.price),
    };
  }
  let computed = 0;
  candidates.forEach((q, i) => {
    const r = bases[i];
    const price = num(q.price);
    if (r.status !== "fulfilled" || !r.value || !price) return;
    rows[q.symbol.toUpperCase()].monthPct = Math.round((price / r.value - 1) * 10000) / 100;
    computed++;
  });

  return { month, asOf, rows, computed, limit: MONTH_LIMIT };
}

/** Mês % dos papéis de maior volume. Cache de horas (uma falha não entra no cache). */
export async function getMonthPerformance(): Promise<MonthPerformance> {
  "use cache";
  cacheLife("hours");
  return computeMonthPerformance();
}

// ---------------- Para a página: nunca rejeitam (vão como Promise ao cliente) ----------------

async function settle<T>(label: string, fn: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    console.error(`${label}:`, err);
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const loadSectors = () => settle("Setores (Fundamentus)", getSectors);
export const loadMonthPerformance = () => settle("Desempenho do mês", getMonthPerformance);
