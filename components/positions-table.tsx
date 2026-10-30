"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatBRL, formatDate, formatInt, formatPct, signClass } from "@/lib/format";
import type { PositionView } from "@/lib/portfolio";
import { ClosePositionButton, ManagePositionButton } from "./position-actions";
import { ScreenshotLink } from "./screenshot-link";

type Filter = "open" | "closed" | "all";

export function PositionsTable({
  positions,
  isAdmin,
  today,
  openShares,
  limit,
  showFilter = true,
  initialFilter = "open",
}: {
  positions: PositionView[];
  isAdmin: boolean;
  today: string;
  openShares: number;
  limit: number;
  showFilter?: boolean;
  initialFilter?: Filter;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(initialFilter);

  const counts = useMemo(
    () => ({
      open: positions.filter((p) => p.status === "open").length,
      closed: positions.filter((p) => p.status === "closed").length,
      all: positions.length,
    }),
    [positions],
  );
  const rows = useMemo(
    () => (filter === "all" ? positions : positions.filter((p) => p.status === filter)),
    [positions, filter],
  );

  const filters: { key: Filter; label: string }[] = [
    { key: "open", label: "Abertas" },
    { key: "closed", label: "Fechadas" },
    { key: "all", label: "Todas" },
  ];

  return (
    <div className="card overflow-hidden">
      {showFilter ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700" role="tablist">
            {filters.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={`rounded px-3 py-1 text-sm ${
                  filter === f.key
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                }`}
              >
                {f.label} <span className="opacity-60">({counts[f.key]})</span>
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500">Clique numa linha para ver o gráfico do papel.</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-zinc-500">
          {positions.length === 0
            ? "Nenhuma posição ainda." + (isAdmin ? " Use o formulário acima para registrar a primeira compra." : "")
            : "Nenhuma posição neste filtro."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60">
              <tr>
                <th className="px-3 py-2">Papel</th>
                <th className="px-3 py-2 text-right">Qtd.</th>
                <th className="px-3 py-2">Compra</th>
                <th className="px-3 py-2 text-right">Valor compra</th>
                <th className="px-3 py-2 text-right">Cotação atual</th>
                <th className="px-3 py-2 text-right">Var. dia</th>
                <th className="px-3 py-2 text-right">Desde a compra</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Venda</th>
                <th className="px-3 py-2">Prints</th>
                {isAdmin ? <th className="px-3 py-2 text-right">Ações</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((p) => {
                const maxQtyForEdit = p.status === "open" ? limit - (openShares - p.quantity) : limit;
                return (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/papel/${p.ticker}`)}
                    className="cursor-pointer align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    <td className="px-3 py-2.5 font-semibold">{p.ticker}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{formatInt(p.quantity)}</td>
                    <td className="px-3 py-2.5 tabular-nums">{formatDate(p.buy_date)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <div>{formatBRL(p.buy_price)}</div>
                      <div className="text-xs text-zinc-500">total {formatBRL(p.buyTotal)}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {p.current ? (
                        <>
                          <div>{formatBRL(p.current.price)}</div>
                          <div className="text-xs text-zinc-500" title={`Fonte: ${p.current.source}`}>
                            {formatDate(p.current.date)}
                          </div>
                        </>
                      ) : (
                        <span className="text-zinc-400">sem cotação</span>
                      )}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${signClass(p.current?.changePct)}`}>
                      {formatPct(p.current?.changePct)}
                    </td>
                    <td className={`px-3 py-2.5 text-right tabular-nums ${signClass(p.varPct)}`}>
                      <div>{formatPct(p.varPct)}</div>
                      <div className="text-xs">{formatBRL(p.varBRL)}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {p.status === "open" ? (
                        <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                          Aberta
                        </span>
                      ) : (
                        <span className="badge bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Fechada</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {p.status === "closed" ? (
                        <>
                          <div>{formatBRL(p.sell_price)}</div>
                          <div className="text-xs text-zinc-500">{formatDate(p.sell_date)}</div>
                        </>
                      ) : (
                        <span className="text-zinc-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col items-start gap-1">
                        {p.buyScreenshotUrl ? (
                          <ScreenshotLink url={p.buyScreenshotUrl} label="print compra" title={`${p.ticker} · print da compra`} />
                        ) : (
                          <span className="text-xs text-amber-600">sem print compra</span>
                        )}
                        {p.status === "closed" ? (
                          p.sellScreenshotUrl ? (
                            <ScreenshotLink url={p.sellScreenshotUrl} label="print venda" title={`${p.ticker} · print da venda`} />
                          ) : (
                            <span className="text-xs text-amber-600">sem print venda</span>
                          )
                        ) : null}
                      </div>
                    </td>
                    {isAdmin ? (
                      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end gap-1.5">
                          {p.status === "open" ? <ClosePositionButton position={p} today={today} /> : null}
                          <ManagePositionButton position={p} today={today} maxQtyForEdit={Math.max(1, maxQtyForEdit)} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
