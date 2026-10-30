import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CandleChart, type Candle, type PriceMark } from "@/components/candle-chart";
import { ErrorBlock, LoadingBlock } from "@/components/page-states";
import { PositionsTable } from "@/components/positions-table";
import { ReimportButton } from "@/components/reimport-button";
import { ScreenshotLink } from "@/components/screenshot-link";
import { requireUser } from "@/lib/auth";
import type { Quote } from "@/lib/database.types";
import { todaySP } from "@/lib/dates";
import { MAX_TICKERS } from "@/lib/errors";
import { formatBRL, formatDate, formatInt, formatNumber, formatPct, signClass } from "@/lib/format";
import { fetchAll, getOpenTickers, loadPortfolio } from "@/lib/portfolio";
import { normalizeTicker } from "@/lib/quotes";
import { loadMemberNames, memberLabel, type MemberNames } from "@/lib/member-names";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 60;

export default function PapelPage({ params }: PageProps<"/papel/[ticker]">) {
  return (
    <div className="space-y-6">
      <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
        ← Voltar para a carteira
      </Link>
      <Suspense fallback={<LoadingBlock label="Carregando papel…" height="h-[480px]" />}>
        <PapelContent params={params} />
      </Suspense>
    </div>
  );
}

type Indicators = {
  empresa?: string;
  setor?: string;
  pl?: number;
  pvp?: number;
  divYield?: number;
  roe?: number;
  min52?: number;
  max52?: number;
};

async function PapelContent({ params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: rawTicker } = await params;
  const ticker = normalizeTicker(decodeURIComponent(rawTicker));
  if (!ticker) notFound();

  const user = await requireUser();
  const supabase = await createClient();

  let quotes: Pick<Quote, "quote_date" | "open" | "high" | "low" | "price" | "volume">[];
  let fundamentus: Pick<Quote, "quote_date" | "price" | "change_pct" | "raw"> | null;
  let portfolio: Awaited<ReturnType<typeof loadPortfolio>>;
  let openTickers: string[];
  let names: MemberNames;
  try {
    [quotes, fundamentus, portfolio, openTickers, names] = await Promise.all([
      fetchAll<Pick<Quote, "quote_date" | "open" | "high" | "low" | "price" | "volume">>((from, to) =>
        supabase
          .from("quotes")
          .select("quote_date, open, high, low, price, volume")
          .eq("ticker", ticker)
          .eq("source", "infomoney")
          .order("quote_date", { ascending: true })
          .range(from, to),
      ),
      supabase
        .from("quotes")
        .select("quote_date, price, change_pct, raw")
        .eq("ticker", ticker)
        .eq("source", "fundamentus")
        .order("quote_date", { ascending: false })
        .limit(1)
        .maybeSingle()
        .then(({ data }) => data),
      loadPortfolio(supabase, { ticker }),
      getOpenTickers(supabase),
      loadMemberNames(supabase),
    ]);
  } catch (err) {
    return <ErrorBlock error={err} />;
  }

  const positions = portfolio.positions;
  const memberNames = names;
  const current = positions[0]?.current ?? null;

  const candles: Candle[] = quotes.map((q) => {
    const close = Number(q.price);
    const open = q.open === null ? close : Number(q.open);
    const high = q.high === null ? Math.max(open, close) : Number(q.high);
    const low = q.low === null ? Math.min(open, close) : Number(q.low);
    return { time: q.quote_date, open, high, low, close, volume: q.volume === null ? null : Number(q.volume) };
  });

  const marks: PriceMark[] = positions.flatMap((p) => {
    const out: PriceMark[] = [
      { kind: "buy", date: p.buy_date, price: p.buy_price, label: `Compra ${formatDate(p.buy_date).slice(0, 5)}` },
    ];
    if (p.status === "closed" && p.sell_date && p.sell_price !== null) {
      out.push({ kind: "sell", date: p.sell_date, price: p.sell_price, label: `Venda ${formatDate(p.sell_date).slice(0, 5)}` });
    }
    return out;
  });

  const ind = (fundamentus?.raw ?? {}) as Indicators;
  const openQty = positions.filter((p) => p.status === "open").reduce((s, p) => s + p.quantity, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{ticker}</h1>
          <p className="text-sm text-zinc-500">
            {[ind.empresa, ind.setor].filter(Boolean).join(" · ") || "Sem dados cadastrais do Fundamentus ainda."}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{formatBRL(current?.price)}</div>
          <div className="text-sm">
            <span className={signClass(current?.changePct)}>{formatPct(current?.changePct)}</span>
            <span className="text-zinc-500"> · {current ? formatDate(current.date) : "sem cotação"}</span>
          </div>
        </div>
      </div>

      <section className="card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Gráfico diário (InfoMoney)</h2>
          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0 w-4 border-t-2 border-dashed border-blue-600" /> compra
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-0 w-4 border-t-2 border-dashed border-orange-600" /> venda
            </span>
          </div>
        </div>
        {candles.length >= 2 ? (
          <CandleChart candles={candles} marks={marks} />
        ) : (
          <div className="flex h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-zinc-300 text-center text-sm text-zinc-500 dark:border-zinc-700">
            <p>
              Ainda não há histórico suficiente para desenhar o gráfico de {ticker}.
              <br />O histórico é importado do InfoMoney na compra e atualizado pelo cron diário.
            </p>
            {user.isAdmin ? <ReimportButton ticker={ticker} /> : null}
          </div>
        )}
        {candles.length >= 2 && user.isAdmin ? (
          <div className="mt-3 flex justify-end">
            <ReimportButton ticker={ticker} />
          </div>
        ) : null}
      </section>

      <section className="card p-4">
        <h2 className="mb-3 font-semibold">
          Indicadores (Fundamentus)
          {fundamentus ? (
            <span className="ml-2 text-xs font-normal text-zinc-500">em {formatDate(fundamentus.quote_date)}</span>
          ) : null}
        </h2>
        {fundamentus ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4 lg:grid-cols-7">
            <Indicator label="P/L" value={formatNumber(ind.pl)} />
            <Indicator label="P/VP" value={formatNumber(ind.pvp)} />
            <Indicator label="Div. Yield" value={formatPct(ind.divYield, false)} />
            <Indicator label="ROE" value={formatPct(ind.roe, false)} />
            <Indicator label="Mín. 52 sem" value={formatBRL(ind.min52)} />
            <Indicator label="Máx. 52 sem" value={formatBRL(ind.max52)} />
            <Indicator label="Setor" value={ind.setor ?? "—"} />
          </dl>
        ) : (
          <p className="text-sm text-zinc-500">Nenhuma cotação do Fundamentus registrada para {ticker}.</p>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Posições em {ticker}</h2>
          <span className="text-sm text-zinc-500">
            {formatInt(openQty)} ação(ões) aberta(s) neste papel · carteira com {openTickers.length}/{MAX_TICKERS} papéis
          </span>
        </div>
        {positions.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {positions.map((p) => (
              <div key={p.id} className="card flex flex-wrap gap-4 p-4">
                <div className="min-w-48 flex-1 space-y-1 text-sm">
                  <div className="flex items-center gap-2">
                    <strong>
                      {p.quantity} × {formatBRL(p.buy_price)}
                    </strong>
                    <span
                      className={`badge ${p.status === "open" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"}`}
                    >
                      {p.status === "open" ? "Aberta" : "Fechada"}
                    </span>
                  </div>
                  <div className="text-zinc-500">
                    Compra em {formatDate(p.buy_date)} por{" "}
                    <span className="font-medium text-zinc-700 dark:text-zinc-300">
                      {memberLabel(p.created_by, memberNames)}
                      {p.created_by === user.id ? " (você)" : ""}
                    </span>
                  </div>
                  {p.status === "closed" ? (
                    <div className="text-zinc-500">
                      Venda em {formatDate(p.sell_date)} a {formatBRL(p.sell_price)} por{" "}
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">{memberLabel(p.closed_by, memberNames)}</span>
                    </div>
                  ) : null}
                  <div className={signClass(p.varBRL)}>
                    {formatBRL(p.varBRL)} ({formatPct(p.varPct)})
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {p.buyScreenshotUrl ? (
                    <ScreenshotLink thumbnail url={p.buyScreenshotUrl} label="Print da compra" title={`${ticker} · print da compra`} />
                  ) : (
                    <EmptyThumb label="Sem print da compra" />
                  )}
                  {p.status === "closed" ? (
                    p.sellScreenshotUrl ? (
                      <ScreenshotLink thumbnail url={p.sellScreenshotUrl} label="Print da venda" title={`${ticker} · print da venda`} />
                    ) : (
                      <EmptyThumb label="Sem print da venda" />
                    )
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="card p-4 text-sm text-zinc-500">Nenhuma posição registrada para {ticker}.</p>
        )}

        {positions.length && user.isAdmin ? (
          <PositionsTable
            positions={positions}
            isAdmin
            today={todaySP()}
            initialFilter="all"
            showFilter={false}
            currentUserId={user.id}
            memberNames={memberNames}
          />
        ) : null}
      </section>
    </div>
  );
}

function Indicator({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function EmptyThumb({ label }: { label: string }) {
  return (
    <div className="flex h-[164px] w-56 items-center justify-center rounded-md border border-dashed border-zinc-300 text-xs text-zinc-500 dark:border-zinc-700">
      {label}
    </div>
  );
}
