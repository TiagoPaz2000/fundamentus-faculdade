"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { formatBRL, formatDate, formatInt, formatPct, signClass } from "@/lib/format";
import { memberLabel } from "@/lib/member-names";
import type { PositionView } from "@/lib/portfolio";
import { ClosePositionButton, ManagePositionButton } from "./position-actions";
import { ScreenshotLink } from "./screenshot-link";

type Filter = "open" | "closed" | "all";
type Owner = "mine" | "all";


export function PositionsTable({
  positions,
  isAdmin,
  today,
  showFilter = true,
  initialFilter = "open",
  currentUserId,
  memberNames,
}: {
  positions: PositionView[];
  isAdmin: boolean;
  today: string;
  showFilter?: boolean;
  initialFilter?: Filter;
  /** Usuário logado (filtro "Meus papéis"). */
  currentUserId: string;
  /** id → nome dos membros atuais (para "vendido por"). */
  memberNames: Record<string, string>;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [owner, setOwner] = useState<Owner>("all");

  const ownerCounts = useMemo(
    () => ({ mine: positions.filter((p) => p.created_by === currentUserId).length, all: positions.length }),
    [positions, currentUserId],
  );
  const owned = useMemo(
    () => (owner === "all" ? positions : positions.filter((p) => p.created_by === currentUserId)),
    [positions, owner, currentUserId],
  );
  const counts = useMemo(
    () => ({
      open: owned.filter((p) => p.status === "open").length,
      closed: owned.filter((p) => p.status === "closed").length,
      all: owned.length,
    }),
    [owned],
  );
  const rows = useMemo(
    () => (filter === "all" ? owned : owned.filter((p) => p.status === filter)),
    [owned, filter],
  );
  const owners: { key: Owner; label: string }[] = [
    { key: "mine", label: "Meus papéis" },
    { key: "all", label: "Todos" },
  ];

  const filters: { key: Filter; label: string }[] = [
    { key: "open", label: "Abertas" },
    { key: "closed", label: "Fechadas" },
    { key: "all", label: "Todas" },
  ];

  return (
    <div className="card overflow-hidden">
      {showFilter ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented label="Dono das posições" options={owners} value={owner} counts={ownerCounts} onChange={setOwner} />
            <Segmented label="Status das posições" options={filters} value={filter} counts={counts} onChange={setFilter} />
          </div>
          <span className="text-xs text-zinc-500">Clique numa linha para ver o gráfico do papel.</span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="px-4 py-12 text-center text-sm text-zinc-500">
          {positions.length === 0
            ? "Nenhuma posição ainda." + (isAdmin ? " Use o formulário acima para registrar a primeira compra." : "")
            : owner === "mine" && ownerCounts.mine === 0
              ? "Você ainda não comprou nenhum papel."
              : "Nenhuma posição neste filtro."}
        </div>
      ) : (
        <>
        {/* Celular: cartões */}
        <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">
          {rows.map((p) => (
            <li key={p.id} className="space-y-3 px-4 py-4" onClick={() => router.push(`/papel/${p.ticker}`)}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-semibold">{p.ticker}</span>
                    <StatusBadge status={p.status} />
                  </div>
                  <div className="text-xs text-zinc-500">
                    {formatInt(p.quantity)} × {formatBRL(p.buy_price)} em {formatDate(p.buy_date)}
                  </div>
                  <div className="text-xs text-zinc-500">
                    <Who position={p} currentUserId={currentUserId} memberNames={memberNames} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">
                    {p.status === "closed" ? formatBRL(p.sell_price) : formatBRL(p.current?.price)}
                  </div>
                  <div className={`text-xs tabular-nums ${signClass(p.current?.changePct)}`}>
                    {p.status === "closed" ? `venda ${formatDate(p.sell_date)}` : `${formatPct(p.current?.changePct)} hoje`}
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Desde a compra</span>
                <span className={`tabular-nums ${signClass(p.varPct)}`}>
                  {formatBRL(p.varBRL)} ({formatPct(p.varPct)})
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3" onClick={(e) => e.stopPropagation()}>
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
                {isAdmin ? (
                  <div className="ml-auto flex gap-2">
                    {p.status === "open" ? <ClosePositionButton position={p} today={today} /> : null}
                    <ManagePositionButton position={p} today={today} />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>

        {/* Tela grande: tabela */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60">
              <tr>
                <th className="px-3 py-2">Papel</th>
                <th className="px-3 py-2">Comprado por</th>
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
                return (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/papel/${p.ticker}`)}
                    className="cursor-pointer align-top hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
                  >
                    <td className="px-3 py-2.5 font-semibold">{p.ticker}</td>
                    <td className="px-3 py-2.5">
                      <div className={p.created_by === currentUserId ? "font-medium" : ""}>
                        {memberLabel(p.created_by, memberNames)}
                        {p.created_by === currentUserId ? <span className="text-xs text-zinc-500"> (você)</span> : null}
                      </div>
                      {p.status === "closed" ? (
                        <div className="text-xs text-zinc-500">vendido por {memberLabel(p.closed_by, memberNames)}</div>
                      ) : null}
                    </td>
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
                          <ManagePositionButton position={p} today={today} />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}

function Who({
  position: p,
  currentUserId,
  memberNames,
}: {
  position: PositionView;
  currentUserId: string;
  memberNames: Record<string, string>;
}) {
  return (
    <>
      comprado por{" "}
      <span className="font-medium text-zinc-700 dark:text-zinc-300">
        {memberLabel(p.created_by, memberNames)}
        {p.created_by === currentUserId ? " (você)" : ""}
      </span>
      {p.status === "closed" ? (
        <>
          {" · "}vendido por{" "}
          <span className="font-medium text-zinc-700 dark:text-zinc-300">{memberLabel(p.closed_by, memberNames)}</span>
        </>
      ) : null}
    </>
  );
}

function Segmented<K extends string>({
  label,
  options,
  value,
  counts,
  onChange,
}: {
  label: string;
  options: { key: K; label: string }[];
  value: K;
  counts: Record<K, number>;
  onChange: (key: K) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded px-3 py-1 text-sm ${
            value === o.key
              ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
              : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          }`}
        >
          {o.label} <span className="opacity-60">({counts[o.key]})</span>
        </button>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: PositionView["status"] }) {
  return status === "open" ? (
    <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">Aberta</span>
  ) : (
    <span className="badge bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">Fechada</span>
  );
}
