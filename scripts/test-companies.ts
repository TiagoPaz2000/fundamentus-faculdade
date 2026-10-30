// Teste manual da aba "Empresas": nomes, setores e desempenho do mês.
// Uso: npx tsx --conditions=react-server scripts/test-companies.ts [TICKER_CONFERENCIA ...]
// (--conditions=react-server faz o pacote "server-only" aceitar o import fora do Next;
//  fora do Next o "use cache" é ignorado e cacheLife vira no-op: tudo é buscado sem cache)
import { createRequire } from "node:module";
import * as cheerio from "cheerio";

// Fora do Next, cacheLife() lança erro: troca next/cache por um stub antes de carregar a lib.
const req = createRequire(__filename);
req.cache[req.resolve("next/cache")] = { exports: { cacheLife: () => {} } } as unknown as NodeJS.Module;
const { getCompanyNames, getSectors, getMonthPerformance } = req("../lib/companies") as typeof import("../lib/companies");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const EXAMPLES = ["PETR4", "VALE3", "ITUB4", "WEGE3", "MGLU3"];

async function main() {
  const checks = process.argv.slice(2).map((t) => t.toUpperCase());
  if (checks.length === 0) checks.push("PETR4", "VALE3");

  // Desempenho do mês primeiro (InfoMoney; não depende dos setores).
  let t0 = Date.now();
  const perf = await getMonthPerformance();
  console.log(`Desempenho do mês: ${Date.now() - t0} ms (sem cache)`);
  console.log(
    `  mês ${perf.month}, até ${perf.asOf}; cotações: ${Object.keys(perf.rows).length}; ` +
      `Mês % calculado: ${perf.computed} (limite ${perf.limit})`,
  );
  const ranked = Object.entries(perf.rows)
    .filter(([, r]) => r.monthPct !== null)
    .sort((a, b) => b[1].monthPct! - a[1].monthPct!);
  console.log("  5 maiores altas:", ranked.slice(0, 5).map(([t, r]) => `${t} ${r.monthPct}%`).join(", "));
  console.log("  5 maiores quedas:", ranked.slice(-5).map(([t, r]) => `${t} ${r.monthPct}%`).join(", "));
  for (const t of EXAMPLES) {
    const r = perf.rows[t];
    console.log(`   ${t}: preço ${r?.price} | Dia ${r?.dayPct}% | Mês ${r?.monthPct}%`);
  }

  // Conferência manual contra o campo "Mês" (Oscilações) da página do papel no Fundamentus.
  for (const check of checks) {
    const res = await fetch(`https://www.fundamentus.com.br/detalhes.php?papel=${check}`, { headers: { "User-Agent": UA } });
    const $ = cheerio.load(new TextDecoder("windows-1252").decode(await res.arrayBuffer()));
    const cell = (label: string) =>
      $("td.label").filter((_, el) => $(el).text().trim().endsWith(label)).first().next("td").text().trim();
    console.log(
      `  Conferência ${check}: Fundamentus Mês = ${cell("Mês") || "?"} (cotação ${cell("Cotação") || "?"}, ` +
        `últ. cot. ${cell("Data últ cot") || "?"}) | nosso Mês % = ${perf.rows[check]?.monthPct}% (cotação ${perf.rows[check]?.price})`,
    );
    await new Promise((r) => setTimeout(r, 3000));
  }

  t0 = Date.now();
  const names = await getCompanyNames();
  console.log(`\nNomes: ${Date.now() - t0} ms — ${names.length} papéis, ${names.filter((c) => c.legalName).length} com razão social`);

  await new Promise((r) => setTimeout(r, 3000));
  t0 = Date.now();
  const sectors = await getSectors();
  const withSector = names.filter((c) => sectors.byTicker[c.ticker]);
  const sectorNames = new Set(Object.values(sectors.byTicker).map((s) => s.sector));
  console.log(`Setores: ${Date.now() - t0} ms (sem cache; consultas ok ${sectors.ok}/${sectors.total})`);
  console.log(`  total de papéis: ${names.length}`);
  console.log(`  com setor: ${withSector.length}`);
  console.log(`  número de setores com papéis: ${sectorNames.size}`);
  console.log(`  com Liq.2meses > 0: ${withSector.filter((c) => (sectors.byTicker[c.ticker].liquidity ?? 0) > 0).length}`);
  console.log("  5 exemplos:");
  for (const t of EXAMPLES) {
    const c = names.find((x) => x.ticker === t);
    const s = sectors.byTicker[t];
    console.log(`   ${t} | ${c?.name} | ${c?.legalName} | ${s?.sector ?? "—"} | Mês ${perf.rows[t]?.monthPct ?? "—"}%`);
  }
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exit(1);
});
