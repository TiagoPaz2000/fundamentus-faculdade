// Teste manual do print do Fundamentus.
// Uso: npx tsx --conditions=react-server scripts/test-screenshot.ts [TICKER] [PASTA_SAIDA]
// (--conditions=react-server faz o pacote "server-only" aceitar o import fora do Next)
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { screenshotFundamentus } from "../lib/screenshot";

async function main() {
  const ticker = (process.argv[2] ?? "PETR4").toUpperCase();
  const outDir = process.argv[3] ?? path.join(process.cwd(), "tmp");
  process.env.CHROME_EXECUTABLE_PATH ??=
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

  const started = Date.now();
  const png = await screenshotFundamentus(ticker);
  mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${ticker}-${Date.now()}.png`);
  writeFileSync(file, png);
  console.log(`OK ${ticker}: ${png.byteLength} bytes em ${Date.now() - started} ms -> ${file}`);
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
