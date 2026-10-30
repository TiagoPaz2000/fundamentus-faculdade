import { formatBRL, formatInt, formatPct, signClass } from "@/lib/format";
import type { PortfolioSummary } from "@/lib/portfolio";

function Card({ label, value, sub, valueClass = "" }: { label: string; value: string; sub?: React.ReactNode; valueClass?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-zinc-500">{sub}</div> : null}
    </div>
  );
}

export function SummaryCards({ summary }: { summary: PortfolioSummary }) {
  const unrealizedPct = summary.investedOpen > 0 ? (summary.unrealized / summary.investedOpen) * 100 : null;
  const usage = Math.min(100, (summary.openTickers / summary.maxTickers) * 100);
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
      <Card
        label="Saldo em caixa"
        value={formatBRL(summary.cashBalance)}
        valueClass={summary.cashBalance < 0 ? "text-red-600" : ""}
        sub={summary.cashBalance < 0 ? "Saldo negativo" : "Valor disponível"}
      />
      <Card label="Valor investido" value={formatBRL(summary.investedOpen)} sub="Custo das posições abertas" />
      <Card
        label="Valor de mercado"
        value={formatBRL(summary.marketValueOpen)}
        sub={
          <span className={signClass(summary.unrealized)}>
            {formatBRL(summary.unrealized)} ({formatPct(unrealizedPct)})
          </span>
        }
      />
      <Card
        label="Resultado total"
        value={formatBRL(summary.totalResult)}
        valueClass={signClass(summary.totalResult)}
        sub={`Realizado ${formatBRL(summary.realized)} · Em aberto ${formatBRL(summary.unrealized)}`}
      />
      <div className="card col-span-2 p-4 md:col-span-1">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Papéis na carteira</div>
        <div className="mt-1 text-xl font-semibold tabular-nums">
          {summary.openTickers}/{summary.maxTickers}
        </div>
        <div className="mt-1 text-xs text-zinc-500">{formatInt(summary.openShares)} ações abertas · 100 por papel</div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full ${usage >= 100 ? "bg-red-500" : usage >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
            style={{ width: `${usage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
