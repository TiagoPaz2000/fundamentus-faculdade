// Teste manual: npx tsx scripts/test-fundamentus.ts [TICKER ...]
import { scrapeFundamentus } from "../lib/scrapers/fundamentus";

const tickers = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["PETR4", "VALE3", "ITUB4", " mxrf11 ", "XPTO99"];

async function main() {
  let failures = 0;
  for (const t of tickers) {
    try {
      const q = await scrapeFundamentus(t);
      console.log(`OK   ${JSON.stringify(t)}`, JSON.stringify(q, null, 2));
    } catch (err) {
      failures++;
      console.log(`ERRO ${JSON.stringify(t)}: ${(err as Error).message}`);
    }
  }
  console.log(`\n${tickers.length - failures}/${tickers.length} ok`);
}

main();
