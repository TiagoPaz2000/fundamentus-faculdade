import { formatBRL, formatPct, signClass } from "@/lib/format";
import type { PositionView } from "@/lib/portfolio";

type Row = {
  id: string;
  name: string;
  open: number;
  invested: number;
  result: number;
  isExMember?: boolean;
};

/**
 * Mini-placar por membro: papéis abertos (de MAX_PER_USER), resultado em R$ e %
 * de todas as posições que ele comprou (abertas pela cotação, fechadas pela venda).
 * Posições de quem saiu da carteira somam numa linha "ex-membro".
 */
export function MemberScoreboard({
  positions,
  memberNames,
  currentUserId,
  maxPerUser,
  adminIds = [],
}: {
  positions: PositionView[];
  memberNames: Record<string, string>;
  currentUserId: string;
  maxPerUser: number;
  /** Admins não compram: ficam fora do placar (salvo se tiverem posições). */
  adminIds?: string[];
}) {
  const buyers = new Set(positions.map((p) => p.created_by));
  const rows = new Map<string, Row>();
  for (const [id, name] of Object.entries(memberNames)) {
    if (adminIds.includes(id) && !buyers.has(id)) continue;
    rows.set(id, { id, name, open: 0, invested: 0, result: 0 });
  }
  const EX = "__ex__";
  for (const p of positions) {
    const key = p.created_by && rows.has(p.created_by) ? p.created_by : EX;
    let row = rows.get(key);
    if (!row) {
      row = { id: EX, name: "ex-membro", open: 0, invested: 0, result: 0, isExMember: true };
      rows.set(EX, row);
    }
    if (p.status === "open") row.open += 1;
    row.invested += p.buyTotal;
    row.result += p.varBRL ?? 0;
  }

  const list = [...rows.values()].sort((a, b) => {
    if (a.isExMember !== b.isExMember) return a.isExMember ? 1 : -1;
    return b.result - a.result || a.name.localeCompare(b.name, "pt-BR");
  });
  if (!list.length) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Placar por membro</h2>
        <span className="text-xs text-zinc-500">até {maxPerUser} papéis por pessoa · resultado de tudo que comprou</span>
      </div>
      <ul className="grid divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-3 xl:grid-cols-4 dark:divide-zinc-800">
        {list.map((r) => {
          const pct = r.invested > 0 ? (r.result / r.invested) * 100 : null;
          const me = r.id === currentUserId;
          return (
            <li
              key={r.id}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${me ? "bg-emerald-50/60 dark:bg-emerald-950/20" : ""}`}
            >
              <div className="min-w-0">
                <div className={`truncate ${me ? "font-semibold" : "font-medium"} ${r.isExMember ? "text-zinc-500" : ""}`}>
                  {r.name}
                  {me ? <span className="text-xs font-normal text-zinc-500"> (você)</span> : null}
                </div>
                <div className="text-xs text-zinc-500 tabular-nums">
                  {r.isExMember ? `${r.open} aberto(s)` : `${r.open}/${maxPerUser} abertos`}
                </div>
              </div>
              <div className={`text-right tabular-nums ${signClass(r.invested > 0 ? r.result : null)}`}>
                <div>{r.invested > 0 ? formatBRL(r.result) : "—"}</div>
                <div className="text-xs">{formatPct(pct)}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
