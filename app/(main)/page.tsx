import { Suspense } from "react";
import { BuyForm } from "@/components/buy-form";
import { ErrorBlock, LoadingBlock } from "@/components/page-states";
import { PositionsTable } from "@/components/positions-table";
import { SummaryCards } from "@/components/summary-cards";
import { requireUser } from "@/lib/auth";
import { todaySP } from "@/lib/dates";
import { Alert } from "@/components/modal";
import { ScheduledOrders } from "@/components/scheduled-orders";
import { marketStatus } from "@/lib/market-hours";
import { loadPortfolio, loadScheduledOrders, type PortfolioData } from "@/lib/portfolio";
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
  let orders: Awaited<ReturnType<typeof loadScheduledOrders>>;
  try {
    [data, orders] = await Promise.all([loadPortfolio(supabase), loadScheduledOrders(supabase)]);
  } catch (err) {
    return <ErrorBlock error={err} />;
  }
  const today = todaySP();
  const market = marketStatus();
  const { summary, positions } = data;
  const openTickers = positions.filter((p) => p.status === "open").map((p) => p.ticker);
  const pendingTickers = (orders ?? [])
    .filter((o) => o.status === "pending" || o.status === "executing")
    .map((o) => o.ticker);
  const takenTickers = [...new Set([...openTickers, ...pendingTickers])];

  return (
    <div className="flex flex-col gap-6">
      <SummaryCards summary={summary} />
      {user.isAdmin ? (
        // No celular a compra vem primeiro; em telas grandes, depois dos cards.
        <div className="order-first md:order-none">
          <BuyForm
          slotsAvailable={summary.maxTickers - takenTickers.length}
          maxTickers={summary.maxTickers}
          takenTickers={takenTickers}
          cashBalance={summary.cashBalance}
          today={today}
          marketOpen={market.open}
          marketLabel={market.label}
          />
        </div>
      ) : null}
      {orders === null && user.isAdmin ? (
        <Alert kind="warning">
          Compras agendadas indisponíveis: rode <code>supabase/migrations/0002_scheduled_orders.sql</code> no SQL
          Editor do Supabase.
        </Alert>
      ) : null}
      {orders?.length ? <ScheduledOrders orders={orders} isAdmin={user.isAdmin} marketOpen={market.open} /> : null}
      <PositionsTable positions={positions} isAdmin={user.isAdmin} today={today} />
    </div>
  );
}
