import "server-only";
import type { Json, QuoteSource, TablesInsert } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";
import { scrapeFundamentus } from "@/lib/scrapers/fundamentus";
import { fetchInfomoneyHistory, scrapeInfomoney } from "@/lib/scrapers/infomoney";
import type { ScrapedQuote } from "@/lib/scrapers/types";
import { screenshotFundamentus } from "@/lib/screenshot";
import { errorMessage } from "@/lib/errors";

export const SCREENSHOT_BUCKET = "screenshots";

export function normalizeTicker(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const t = input.trim().toUpperCase();
  return /^[A-Z0-9]{4,12}$/.test(t) ? t : null;
}

function num(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function scrapedToRow(q: ScrapedQuote): TablesInsert<"quotes"> {
  return {
    ticker: q.ticker.toUpperCase(),
    source: q.source,
    quote_date: q.quoteDate,
    price: q.price,
    open: num(q.open),
    high: num(q.high),
    low: num(q.low),
    volume: num(q.volume),
    change_pct: num(q.changePct),
    raw: (q.raw ?? null) as Json | null,
    scraped_at: new Date().toISOString(),
  };
}

/** Upsert em quotes com service role (onConflict ticker,source,quote_date). Retorna nº de linhas. */
export async function upsertQuotes(quotes: ScrapedQuote[]): Promise<number> {
  const byKey = new Map<string, TablesInsert<"quotes">>();
  for (const q of quotes) {
    if (!q || !Number.isFinite(q.price) || !q.quoteDate) continue;
    const row = scrapedToRow(q);
    byKey.set(`${row.ticker}|${row.source}|${row.quote_date}`, row);
  }
  const rows = [...byKey.values()];
  if (rows.length === 0) return 0;

  const admin = createAdminClient();
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const { error } = await admin
      .from("quotes")
      .upsert(rows.slice(i, i + CHUNK), { onConflict: "ticker,source,quote_date" });
    if (error) throw new Error(`Erro ao gravar cotações: ${error.message}`);
  }
  return rows.length;
}

export type CurrentQuoteResult = {
  quote: ScrapedQuote;
  /** Erro da fonte principal quando foi preciso usar o fallback. */
  fallbackFrom?: string;
};

/** Cotação atual: Fundamentus, com fallback para InfoMoney. */
export async function fetchCurrentQuote(ticker: string): Promise<CurrentQuoteResult> {
  try {
    return { quote: await scrapeFundamentus(ticker) };
  } catch (fundErr) {
    try {
      return { quote: await scrapeInfomoney(ticker), fallbackFrom: errorMessage(fundErr) };
    } catch (infoErr) {
      throw new Error(
        `Não foi possível obter a cotação de ${ticker}. Fundamentus: ${errorMessage(fundErr)} | InfoMoney: ${errorMessage(infoErr)}`,
      );
    }
  }
}

/** Raspa as duas fontes e grava o que der certo. */
export async function refreshCurrentQuotes(ticker: string) {
  const sources: QuoteSource[] = ["fundamentus", "infomoney"];
  const settled = await Promise.allSettled([scrapeFundamentus(ticker), scrapeInfomoney(ticker)]);
  const ok: ScrapedQuote[] = [];
  const errors: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") ok.push(r.value);
    else errors.push(`${sources[i]}: ${errorMessage(r.reason)}`);
  });
  const saved = ok.length ? await upsertQuotes(ok) : 0;
  return { saved, errors };
}

/** Importa o histórico diário do InfoMoney desde `fromDate` e grava em quotes. */
export async function importInfomoneyHistory(ticker: string, fromDate: string): Promise<number> {
  const history = await fetchInfomoneyHistory(ticker, fromDate);
  return upsertQuotes(history);
}

/**
 * Tira o print da página do Fundamentus e sobe para o bucket privado.
 * Caminho: <TICKER>/<positionId>-<kind>-<timestamp>.png
 */
export async function captureFundamentusScreenshot(
  ticker: string,
  positionId: string,
  kind: "buy" | "sell",
): Promise<string> {
  const png = await screenshotFundamentus(ticker);
  const path = `${ticker}/${positionId}-${kind}-${Date.now()}.png`;
  const admin = createAdminClient();
  const { error } = await admin.storage
    .from(SCREENSHOT_BUCKET)
    .upload(path, png, { contentType: "image/png", upsert: false });
  if (error) throw new Error(`Erro ao enviar o print: ${error.message}`);
  return path;
}

export async function removeScreenshots(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => Boolean(p));
  if (!list.length) return;
  try {
    await createAdminClient().storage.from(SCREENSHOT_BUCKET).remove(list);
  } catch (err) {
    console.error("Falha ao remover prints:", err);
  }
}
