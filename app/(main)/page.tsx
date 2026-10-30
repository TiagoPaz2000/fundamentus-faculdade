import { Suspense } from "react";
import { BuyForm } from "@/components/buy-form";
import { ErrorBlock, LoadingBlock } from "@/components/page-states";
import { PositionsTable } from "@/components/positions-table";
import { SummaryCards } from "@/components/summary-cards";
import { requireUser } from "@/lib/auth";
import { todaySP } from "@/lib/dates";
import { loadPortfolio, type PortfolioData } from "@/lib/portfolio";
import { createClient } from "@/lib/supabase/server";

// As Server Actions desta página tiram prints (Chromium): precisam de mais tempo.
export const maxDuration = 60;

export default function HomePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Carteira</h1>
          <p className="text-sm text-zinc-500">Posições, cotações e resultado da carteira compartilhada.</p>
        </div>
        <a href="/api/export" className="btn-secondary" download>
          Exportar planilha (.xlsx)
        </a>
      </div>
      <Suspense fallback={<LoadingBlock label="Carregando carteira…" height="h-96" />}>
        <Dashboard />
      </Suspense>
    </div>
  );
}

async function Dashboard() {
  const user = await requireUser();
  const supabase = await createClient();
  let data: PortfolioData;
  try {
    data = await loadPortfolio(supabase);
  } catch (err) {
    return <ErrorBlock error={err} />;
  }
  const today = todaySP();
  const { summary, positions } = data;

  return (
    <div className="space-y-6">
      <SummaryCards summary={summary} />
      {user.isAdmin ? (
        <BuyForm maxQty={summary.limit - summary.openShares} cashBalance={summary.cashBalance} today={today} />
      ) : null}
      <PositionsTable
        positions={positions}
        isAdmin={user.isAdmin}
        today={today}
        openShares={summary.openShares}
        limit={summary.limit}
      />
    </div>
  );
}
