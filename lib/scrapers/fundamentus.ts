import * as cheerio from "cheerio";
import type { ScrapedQuote, Scraper } from "./types";

const BASE_URL = "https://fundamentus.com.br/detalhes.php?papel=";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

/** "1.234,56" | "-0,59%" | "7,0%" -> number; vazio/"-" -> null */
function parseBrNumber(text: string | undefined): number | null {
  if (!text) return null;
  const cleaned = text
    .replace(/\s|%|R\$/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** "29/10/2026" -> "2026-10-29" */
function parseBrDate(text: string | undefined): string | null {
  const m = text?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/**
 * A página (ações e FIIs) usa pares <td class="label">…</td><td class="data">…</td>.
 * Monta um mapa label -> texto do valor; em labels repetidos vale a 1ª ocorrência
 * (ex.: "Receita" aparece em "Últimos 12 meses" e "Últimos 3 meses" nos FIIs).
 */
function extractPairs($: cheerio.CheerioAPI): Map<string, string> {
  const pairs = new Map<string, string>();
  $("td.label").each((_, el) => {
    const label = $(el).find(".txt").text().replace(/\s+/g, " ").trim();
    if (!label || pairs.has(label)) return;
    const data = $(el).next("td.data");
    if (data.length === 0) return;
    pairs.set(label, data.text().replace(/\s+/g, " ").trim());
  });
  return pairs;
}

export const scrapeFundamentus: Scraper = async (input) => {
  const ticker = input.trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/.test(ticker)) {
    throw new Error(`Fundamentus: ticker inválido "${input}"`);
  }

  const res = await fetch(BASE_URL + encodeURIComponent(ticker), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "text/html,application/xhtml+xml",
      "Accept-Language": "pt-BR,pt;q=0.9",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Fundamentus: HTTP ${res.status} ao buscar ${ticker}`);
  }

  const html = new TextDecoder("windows-1252").decode(await res.arrayBuffer());
  if (/Nenhum papel encontrado/i.test(html)) {
    throw new Error(`Fundamentus: papel "${ticker}" não encontrado`);
  }

  const $ = cheerio.load(html);
  const pairs = extractPairs($);
  const isFii = pairs.has("FII");
  const papel = pairs.get("Papel") ?? pairs.get("FII");

  if (!papel || !pairs.has("Cotação")) {
    throw new Error(`Fundamentus: tabela de detalhes não encontrada para "${ticker}"`);
  }

  const price = parseBrNumber(pairs.get("Cotação"));
  if (price === null) {
    throw new Error(`Fundamentus: não foi possível ler a cotação de ${ticker} ("${pairs.get("Cotação")}")`);
  }
  const quoteDate = parseBrDate(pairs.get("Data últ cot"));
  if (!quoteDate) {
    throw new Error(`Fundamentus: data da cotação inválida para ${ticker} ("${pairs.get("Data últ cot")}")`);
  }

  const raw: Record<string, unknown> = {
    tipo: isFii ? "fii" : "acao",
    empresa: pairs.get("Empresa") || pairs.get("Nome") || null,
    setor: pairs.get("Setor") || pairs.get("Segmento") || null,
    pl: parseBrNumber(pairs.get("P/L")),
    pvp: parseBrNumber(pairs.get("P/VP")),
    divYield: parseBrNumber(pairs.get("Div. Yield")),
    roe: parseBrNumber(pairs.get("ROE")),
    min52: parseBrNumber(pairs.get("Min 52 sem")),
    max52: parseBrNumber(pairs.get("Max 52 sem")),
    volMedio2m: parseBrNumber(pairs.get("Vol $ méd (2m)")),
    valorMercado: parseBrNumber(pairs.get("Valor de mercado")),
  };
  if (isFii) raw.ffoYield = parseBrNumber(pairs.get("FFO Yield"));
  for (const k of Object.keys(raw)) if (raw[k] === null || raw[k] === undefined) delete raw[k];

  const quote: ScrapedQuote = {
    ticker,
    source: "fundamentus",
    quoteDate,
    price,
    open: null,
    high: null,
    low: null,
    volume: null,
    changePct: parseBrNumber(pairs.get("Dia")),
    raw,
  };
  return quote;
};
