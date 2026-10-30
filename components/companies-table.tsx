"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useMemo, useState } from "react";
import { formatDate, formatInt, formatPct, signClass } from "@/lib/format";
import type { CompanyName, Loaded, MonthPerformance, SectorMap } from "@/lib/companies";

const PAGE_SIZE = 50;
const NO_SECTOR = "__sem__";

type SortKey = "ticker" | "name" | "legalName" | "sector" | "month" | "day";
type SortDir = "asc" | "desc";
type Top = "" | "10" | "20" | "50" | "alta";

const TOPS: { key: Top; label: string }[] = [
  { key: "", label: "Todas" },
  { key: "10", label: "Top 10" },
  { key: "20", label: "Top 20" },
  { key: "50", label: "Top 50" },
  { key: "alta", label: "Só em alta" },
];
const SORT_KEYS: SortKey[] = ["ticker", "name", "legalName", "sector", "month", "day"];
const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

type Row = CompanyName & {
  sector: string | null;
  liquidity: number | null;
  monthPct: number | null; dayPct: number | null; held: boolean; rank: number | null };

function parseTop(v: string | null): Top {
  return v === "10" || v === "20" || v === "50" || v === "alta" ? v : "";
}

export function CompaniesTable({
  companies,
  held,
  sectors,
  performance,
}: {
  companies: CompanyName[];
  /** Papéis com posição aberta na carteira. */
  held: string[];
  /** Setores: chegam depois (streaming). Nunca rejeita. */
  sectors: Promise<Loaded<SectorMap>>;
  /** Mês %: chega depois (streaming). Nunca rejeita. */
  performance: Promise<Loaded<MonthPerformance>>;
}) {
  const params = useSearchParams();
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [sector, setSector] = useState(() => params.get("setor") ?? "");
  const [top, setTop] = useState<Top>(() => parseTop(params.get("top")));
  const [activeOnly, setActiveOnly] = useState(() => params.get("ativos") === "1");
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>(() => {
    const [k, d] = (params.get("ordem") ?? "").split("-");
    if (SORT_KEYS.includes(k as SortKey)) return { key: k as SortKey, dir: d === "desc" ? "desc" : "asc" };
    return parseTop(params.get("top")) ? { key: "month", dir: "desc" } : { key: "ticker", dir: "asc" };
  });
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("pagina")) || 1));
  const [perf, setPerf] = useState<Loaded<MonthPerformance> | null>(null);
  const [sectorsRes, setSectorsRes] = useState<Loaded<SectorMap> | null>(null);

  // Estado → URL (link compartilhado já abre filtrado). replaceState não recarrega a página.
  useEffect(() => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (sector) p.set("setor", sector);
    if (top) p.set("top", top);
    if (activeOnly) p.set("ativos", "1");
    const defaultSort = top ? "month-desc" : "ticker-asc";
    if (`${sort.key}-${sort.dir}` !== defaultSort) p.set("ordem", `${sort.key}-${sort.dir}`);
    if (page > 1) p.set("pagina", String(page));
    const qs = p.toString();
    if (qs !== window.location.search.replace(/^\?/, "")) {
      window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
    }
  }, [query, sector, top, activeOnly, sort, page]);

  const heldSet = useMemo(() => new Set(held), [held]);
  const perfData: MonthPerformance | null = perf?.ok ? perf.data : null;
  const sectorMap: SectorMap | null = sectorsRes?.ok ? sectorsRes.data : null;
  const sectorsPending = sectorsRes === null;
  const sectorsFailed = sectorsRes === null ? 0 : sectorsRes.ok ? sectorsRes.data.total - sectorsRes.data.ok : -1;

  const allRows: Row[] = useMemo(
    () =>
      companies.map((c) => {
        const p = perfData?.rows[c.ticker];
        const s = sectorMap?.byTicker[c.ticker];
        return {
          ...c,
          sector: s?.sector ?? null,
          liquidity: s?.liquidity ?? null,
          monthPct: p?.monthPct ?? null,
          dayPct: p?.dayPct ?? null,
          held: heldSet.has(c.ticker),
          rank: null,
        };
      }),
    [companies, perfData, sectorMap, heldSet],
  );

  // Contagem por setor (sobre a busca/negociação, sem o próprio filtro de setor).
  const textFiltered = useMemo(() => {
    const q = normalize(query.trim());
    return allRows.filter((r) => {
      // Sem os setores ainda não sabemos a liquidez: não esconde nada.
      if (activeOnly && sectorMap && !(r.liquidity && r.liquidity > 0)) return false;
      if (!q) return true;
      return (
        normalize(r.ticker).includes(q) || normalize(r.name).includes(q) || normalize(r.legalName ?? "").includes(q)
      );
    });
  }, [allRows, query, activeOnly, sectorMap]);

  const sectorOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of textFiltered) {
      const k = r.sector ?? NO_SECTOR;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) =>
      a[0] === NO_SECTOR ? 1 : b[0] === NO_SECTOR ? -1 : a[0].localeCompare(b[0], "pt-BR"),
    );
  }, [textFiltered]);

  const sectorFiltered = useMemo(
    () => (sector ? textFiltered.filter((r) => (r.sector ?? NO_SECTOR) === sector) : textFiltered),
    [textFiltered, sector],
  );

  // Top N / Só em alta: só papéis com Mês % calculado.
  const filtered = useMemo(() => {
    if (!top) return sectorFiltered;
    const ranked = sectorFiltered
      .filter((r) => r.monthPct !== null && (top !== "alta" || r.monthPct > 0))
      .sort((a, b) => b.monthPct! - a.monthPct! || a.ticker.localeCompare(b.ticker));
    const cut = top === "alta" ? ranked : ranked.slice(0, Number(top));
    return cut.map((r, i) => ({ ...r, rank: i + 1 }));
  }, [sectorFiltered, top]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: Row) => (sort.key === "month" ? r.monthPct : sort.key === "day" ? r.dayPct : r[sort.key]);
    return [...filtered].sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      // Vazios sempre no fim.
      if (va === null || va === "") return vb === null || vb === "" ? a.ticker.localeCompare(b.ticker) : 1;
      if (vb === null || vb === "") return -1;
      const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), "pt-BR");
      return c * dir || a.ticker.localeCompare(b.ticker);
    });
  }, [filtered, sort]);

  const highlights = useMemo(() => {
    const withPct = sectorFiltered
      .filter((r) => r.monthPct !== null)
      .sort((a, b) => b.monthPct! - a.monthPct!);
    return {
      up: withPct.filter((r) => r.monthPct! > 0).slice(0, 5),
      down: withPct.filter((r) => r.monthPct! < 0).slice(-5).reverse(),
    };
  }, [sectorFiltered]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const pageRows = sorted.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const from = sorted.length ? (current - 1) * PAGE_SIZE + 1 : 0;
  const to = Math.min(current * PAGE_SIZE, sorted.length);

  // Qualquer mudança de filtro/ordem volta para a página 1.
  function withReset<T>(set: (v: T) => void) {
    return (v: T) => {
      set(v);
      setPage(1);
    };
  }
  function changeTop(t: Top) {
    setTop(t);
    if (t) setSort({ key: "month", dir: "desc" });
    setPage(1);
  }
  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "month" || key === "day" ? "desc" : "asc" },
    );
    setPage(1);
  }
  function goTo(p: number) {
    setPage(p);
    document.getElementById("empresas-topo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const showRank = Boolean(top);
  const perfPending = perf === null;

  return (
    <div className="space-y-4" id="empresas-topo">
      <Suspense fallback={null}>
        <PromiseLoader promise={performance} onLoad={setPerf} />
      </Suspense>
      <Suspense fallback={null}>
        <PromiseLoader promise={sectors} onLoad={setSectorsRes} />
      </Suspense>

      <PerformanceSummary
        perf={perf}
        highlights={highlights}
        sectorLabel={sector ? (sector === NO_SECTOR ? "Sem setor" : sector) : null}
      />

      <div className="card overflow-hidden">
        <div className="space-y-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={query}
              onChange={(e) => withReset(setQuery)(e.target.value)}
              placeholder="Buscar por código ou nome…"
              aria-label="Buscar por código ou nome"
              className="input w-full sm:w-64"
            />
            <select
              value={sector}
              onChange={(e) => withReset(setSector)(e.target.value)}
              aria-label="Filtrar por setor"
              disabled={sectorsPending}
              className="input w-full sm:w-auto sm:max-w-xs"
            >
              <option value="">
                {sectorsPending ? "Carregando setores…" : `Todos os setores (${textFiltered.length})`}
              </option>
              {sectorOptions.map(([s, n]) => (
                <option key={s} value={s}>
                  {s === NO_SECTOR ? "Sem setor" : s} ({n})
                </option>
              ))}
              {sector && !sectorOptions.some(([s]) => s === sector) ? (
                <option value={sector}>{sector === NO_SECTOR ? "Sem setor" : sector} (0)</option>
              ) : null}
            </select>
            <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-300">
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => withReset(setActiveOnly)(e.target.checked)}
              />
              Só com negociação recente
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">Desempenho do mês</span>
              <div className="inline-flex flex-wrap rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700" role="tablist" aria-label="Desempenho do mês">
                {TOPS.map((o) => (
                  <button
                    key={o.key || "todas"}
                    type="button"
                    role="tab"
                    aria-selected={top === o.key}
                    onClick={() => changeTop(o.key)}
                    className={`rounded px-3 py-1 text-sm ${
                      top === o.key
                        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <span className="text-sm text-zinc-500">
              <strong className="text-zinc-800 dark:text-zinc-200">{formatInt(sorted.length)}</strong>{" "}
              {sorted.length === 1 ? "empresa" : "empresas"}
            </span>
          </div>
          {sectorsFailed === -1 ? (
            <p className="text-xs text-amber-600">
              Não foi possível consultar os setores no Fundamentus agora; os papéis aparecem sem setor.
            </p>
          ) : sectorsFailed > 0 ? (
            <p className="text-xs text-amber-600">
              {sectorsFailed} {sectorsFailed === 1 ? "setor não pôde ser consultado" : "setores não puderam ser consultados"} no
              Fundamentus; esses papéis aparecem sem setor.
            </p>
          ) : null}
        </div>

        {(top && perfPending) || (sector && sectorsPending) ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-500">
            <span className="animate-pulse">
              {sector && sectorsPending ? "Carregando os setores…" : "Calculando o desempenho do mês…"}
            </span>
          </p>
        ) : sorted.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-500">
            {top && perf && !perf.ok ? "Desempenho do mês indisponível no momento." : "Nenhuma empresa encontrada."}
          </p>
        ) : (
          <>
            {/* Celular: cartões */}
            <ul className="divide-y divide-zinc-100 md:hidden dark:divide-zinc-800">
              {pageRows.map((r) => (
                <li key={r.ticker} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {showRank ? <span className="text-xs tabular-nums text-zinc-500">#{r.rank}</span> : null}
                      <Link href={`/papel/${r.ticker}`} className="font-semibold hover:underline">
                        {r.ticker}
                      </Link>
                      {r.held ? <HeldBadge /> : null}
                    </div>
                    <div className="truncate text-sm">{r.name}</div>
                    {r.legalName && r.legalName !== r.name ? (
                      <div className="truncate text-xs text-zinc-500">{r.legalName}</div>
                    ) : null}
                    <div className="text-xs text-zinc-500">{r.sector ?? (sectorsPending ? "…" : "—")}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className={`font-medium tabular-nums ${signClass(r.monthPct)}`}>
                      {perfPending ? <span className="text-zinc-400">…</span> : formatPct(r.monthPct)}
                    </div>
                    <div className="text-xs text-zinc-500">no mês</div>
                    {r.dayPct !== null ? (
                      <div className={`text-xs tabular-nums ${signClass(r.dayPct)}`}>{formatPct(r.dayPct)} hoje</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            {/* Tela grande: tabela */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60">
                  <tr>
                    {showRank ? <th className="px-3 py-2 text-right">#</th> : null}
                    <SortTh label="Código" k="ticker" sort={sort} onSort={toggleSort} />
                    <SortTh label="Empresa" k="name" sort={sort} onSort={toggleSort} />
                    <SortTh label="Razão social" k="legalName" sort={sort} onSort={toggleSort} />
                    <SortTh label="Setor" k="sector" sort={sort} onSort={toggleSort} />
                    <SortTh label="Mês %" k="month" sort={sort} onSort={toggleSort} right />
                    <SortTh label="Dia %" k="day" sort={sort} onSort={toggleSort} right />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {pageRows.map((r) => (
                    <tr key={r.ticker} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/40">
                      {showRank ? <td className="px-3 py-2 text-right tabular-nums text-zinc-500">#{r.rank}</td> : null}
                      <td className="whitespace-nowrap px-3 py-2">
                        <Link href={`/papel/${r.ticker}`} className="font-semibold hover:underline">
                          {r.ticker}
                        </Link>
                        {r.held ? <span className="ml-2"><HeldBadge /></span> : null}
                      </td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2 text-zinc-600 dark:text-zinc-400">{r.legalName ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.sector ?? <span className="text-zinc-400">{sectorsPending ? "…" : "—"}</span>}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${signClass(r.monthPct)}`}>
                        {perfPending ? <span className="text-zinc-400">…</span> : formatPct(r.monthPct)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${signClass(r.dayPct)}`}>
                        {perfPending ? <span className="text-zinc-400">…</span> : formatPct(r.dayPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={current}
              pageCount={pageCount}
              from={from}
              to={to}
              total={sorted.length}
              onPage={goTo}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Espera uma Promise do servidor (dentro de Suspense) e entrega o resultado ao estado da tabela. */
function PromiseLoader<T>({ promise, onLoad }: { promise: Promise<T>; onLoad: (r: T) => void }) {
  const result = use(promise);
  useEffect(() => onLoad(result), [result, onLoad]);
  return null;
}

function PerformanceSummary({
  perf,
  highlights,
  sectorLabel,
}: {
  perf: Loaded<MonthPerformance> | null;
  highlights: { up: Row[]; down: Row[] };
  sectorLabel: string | null;
}) {
  if (perf === null) {
    return (
      <div className="card px-4 py-3 text-sm text-zinc-500">
        <span className="animate-pulse">Calculando o desempenho do mês…</span>
      </div>
    );
  }
  if (!perf.ok) {
    return (
      <div className="card px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
        Desempenho do mês indisponível no momento ({perf.error}). A lista de empresas continua abaixo.
      </div>
    );
  }
  const { month, asOf, computed } = perf.data;
  const [y, m] = month.split("-");
  const title = `Desempenho de ${MONTHS[Number(m) - 1]}/${y}, até ${formatDate(asOf).slice(0, 5)}`;

  return (
    <div className="card space-y-3 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          {title}
          {sectorLabel ? <span className="font-normal text-zinc-500"> · {sectorLabel}</span> : null}
        </h2>
        <span className="text-xs text-zinc-500">
          Variação desde o último fechamento do mês anterior, calculada para os {formatInt(computed)} papéis de
          maior volume negociados no mês. Fonte: InfoMoney.
        </span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <HighlightList title="Maiores altas" rows={highlights.up} empty="Nenhum papel em alta." />
        <HighlightList title="Maiores quedas" rows={highlights.down} empty="Nenhum papel em queda." />
      </div>
    </div>
  );
}

function HighlightList({ title, rows, empty }: { title: string; rows: Row[]; empty: string }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{title}</div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{empty}</p>
      ) : (
        <ol className="space-y-0.5 text-sm">
          {rows.map((r) => (
            <li key={r.ticker} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                <Link href={`/papel/${r.ticker}`} className="font-semibold hover:underline">
                  {r.ticker}
                </Link>{" "}
                <span className="text-zinc-500">{r.name}</span>
              </span>
              <span className={`shrink-0 tabular-nums ${signClass(r.monthPct)}`}>{formatPct(r.monthPct)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function SortTh({
  label,
  k,
  sort,
  onSort,
  right = false,
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = sort.key === k;
  return (
    <th
      className={`px-3 py-2 ${right ? "text-right" : ""}`}
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`inline-flex items-center gap-1 uppercase hover:text-zinc-900 dark:hover:text-zinc-100 ${
          active ? "text-zinc-900 dark:text-zinc-100" : ""
        }`}
      >
        {label}
        <span aria-hidden className="text-[10px]">
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </th>
  );
}

function Pagination({
  page,
  pageCount,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  from: number;
  to: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const btn =
    "min-w-8 rounded-md border border-zinc-200 px-2 py-1 text-sm disabled:opacity-40 dark:border-zinc-700";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-800">
      <span className="text-sm text-zinc-500">
        Mostrando {formatInt(from)}–{formatInt(to)} de {formatInt(total)}
      </span>
      {pageCount > 1 ? (
        <nav className="flex flex-wrap items-center gap-1" aria-label="Paginação">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Anterior
          </button>
          {pageList(page, pageCount).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1 text-zinc-400">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={`${btn} ${
                  p === page ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : ""
                }`}
              >
                {p}
              </button>
            ),
          )}
          <button type="button" className={btn} disabled={page >= pageCount} onClick={() => onPage(page + 1)}>
            Próxima
          </button>
        </nav>
      ) : null}
    </div>
  );
}

/** 1 … 4 5 [6] 7 8 … 20 */
function pageList(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const pages = new Set([1, count, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => pages.add(p));
  if (page >= count - 2) [count - 3, count - 2, count - 1].forEach((p) => pages.add(p));
  const sorted = [...pages].filter((p) => p >= 1 && p <= count).sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push(null);
    out.push(p);
  });
  return out;
}

function HeldBadge() {
  return (
    <span className="badge bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
      Na carteira
    </span>
  );
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}
