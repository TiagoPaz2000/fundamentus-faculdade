import "server-only";
import * as cheerio from "cheerio";
import { cacheLife } from "next/cache";

export type TickerOption = {
  ticker: string;
  /** Nome comercial (ex.: "PETROBRAS") */
  name: string;
};

const LIST_URL = "https://www.fundamentus.com.br/detalhes.php";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/**
 * Lista de todos os papéis do Fundamentus (≈1000), para o campo de busca da compra.
 * Fica em cache por um dia.
 */
export async function getTickerList(): Promise<TickerOption[]> {
  "use cache";
  cacheLife("days");

  const res = await fetch(LIST_URL, {
    headers: { "User-Agent": USER_AGENT, "Accept-Language": "pt-BR,pt;q=0.9" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Fundamentus: HTTP ${res.status} ao listar papéis`);
  const html = new TextDecoder("windows-1252").decode(await res.arrayBuffer());
  const $ = cheerio.load(html);

  const seen = new Set<string>();
  const list: TickerOption[] = [];
  $("tr").each((_, tr) => {
    const tds = $(tr).find("td");
    const ticker = tds.eq(0).find("a").text().trim().toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(ticker) || seen.has(ticker)) return;
    seen.add(ticker);
    const name = (tds.eq(1).text().trim() || tds.eq(2).text().trim()).replace(/\s+/g, " ");
    list.push({ ticker, name });
  });
  if (list.length < 50) throw new Error("Fundamentus: lista de papéis vazia ou em formato inesperado");
  return list.sort((a, b) => a.ticker.localeCompare(b.ticker));
}
