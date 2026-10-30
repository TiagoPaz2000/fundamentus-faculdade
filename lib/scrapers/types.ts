export type QuoteSource = "fundamentus" | "infomoney";

/** Mapeia 1:1 para uma linha de public.quotes (unique: ticker, source, quoteDate). */
export interface ScrapedQuote {
  ticker: string; // ex: "PETR4"
  source: QuoteSource;
  quoteDate: string; // YYYY-MM-DD (data informada pelo site, ou hoje em America/Sao_Paulo)
  price: number; // fechamento / último preço em R$
  open?: number | null;
  high?: number | null;
  low?: number | null;
  volume?: number | null;
  changePct: number | null; // variação do dia em %, ex: -1.23
  raw?: Record<string, unknown>; // campos extras úteis (P/L, DY, etc.)
}

/** Cotação atual de um papel. Deve lançar Error se o papel não existir ou o parse falhar. */
export type Scraper = (ticker: string) => Promise<ScrapedQuote>;

/** Histórico diário (OHLC) para os candles. Datas YYYY-MM-DD, ordem crescente. */
export type HistoryScraper = (ticker: string, fromDate: string) => Promise<ScrapedQuote[]>;
