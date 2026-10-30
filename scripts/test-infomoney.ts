/**
 * Teste manual do scraper do InfoMoney.
 * Uso: npx tsx scripts/test-infomoney.ts
 */
import { fetchInfomoneyHistory, scrapeInfomoney } from "../lib/scrapers/infomoney";

function daysAgo(n: number): string {
  const d = new Date(Date.now() - n * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

async function main() {
  for (const t of ["PETR4", "VALE3", "ITUB4", "MXRF11", " petr4 ", "XXXX9"]) {
    try {
      const q = await scrapeInfomoney(t);
      console.log(`\n[OK] ${JSON.stringify(t)}`);
      console.log(q);
    } catch (e) {
      console.log(`\n[ERRO] ${JSON.stringify(t)}: ${(e as Error).message}`);
    }
  }

  const from = daysAgo(90);
  console.log(`\n=== Histórico PETR4 desde ${from} ===`);
  const hist = await fetchInfomoneyHistory("PETR4", from);
  console.log(`candles: ${hist.length}`);
  console.log("primeiros:", hist.slice(0, 3));
  console.log("últimos:", hist.slice(-3));
  const sorted = hist.every((h, i) => i === 0 || hist[i - 1].quoteDate < h.quoteDate);
  console.log(`ordem crescente e sem duplicatas: ${sorted}`);

  try {
    await fetchInfomoneyHistory("XXXX9", from);
    console.log("[ERRO] histórico de XXXX9 deveria falhar");
  } catch (e) {
    console.log(`histórico XXXX9 -> erro esperado: ${(e as Error).message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
