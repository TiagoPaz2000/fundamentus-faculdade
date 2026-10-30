"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { cancelOrder, runOrdersNow } from "@/app/actions/orders";
import type { ScheduledOrder } from "@/lib/database.types";
import { formatBRL, formatDate, formatDateTime, formatInt } from "@/lib/format";
import { FeedbackBox, type Feedback } from "./modal";

const STATUS: Record<ScheduledOrder["status"], { label: string; cls: string }> = {
  pending: { label: "Aguardando", cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" },
  executing: { label: "Executando", cls: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300" },
  executed: { label: "Executada", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" },
  cancelled: { label: "Cancelada", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  expired: { label: "Vencida", cls: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
  failed: { label: "Falhou", cls: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" },
};

/**
 * Nome de quem agendou (displayName do membro, vindo de memberNames), "ex-membro"
 * se saiu da carteira ou "—" sem autor / sem a lista de nomes.
 */
function ownerLabel(createdBy: string | null, memberNames: Record<string, string> | undefined): string {
  if (!createdBy || !memberNames) return "—";
  return memberNames[createdBy] ?? "ex-membro";
}

/**
 * Lista de compras agendadas. Qualquer membro vê todas e pode pedir "Verificar agora";
 * cancelar só aparece para o dono da ordem ou para o admin (o servidor confere de novo).
 */
export function ScheduledOrders({
  orders,
  isAdmin,
  marketOpen,
  currentUserId,
  memberNames,
}: {
  orders: ScheduledOrder[];
  isAdmin: boolean;
  marketOpen: boolean;
  /** Usuário logado: pode cancelar as próprias ordens pendentes. */
  currentUserId?: string;
  /** id → nome de exibição dos membros atuais. */
  memberNames?: Record<string, string>;
}) {
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, start] = useTransition();
  const [showAll, setShowAll] = useState(false);

  const active = orders.filter((o) => o.status === "pending" || o.status === "executing");
  const rows = showAll ? orders : active;
  const canCancel = (o: ScheduledOrder) =>
    o.status === "pending" && (isAdmin || (currentUserId !== undefined && o.created_by === currentUserId));
  const showActions = orders.some((o) => isAdmin || (currentUserId !== undefined && o.created_by === currentUserId));

  function checkNow() {
    setFeedback(null);
    start(async () => {
      const res = await runOrdersNow();
      setFeedback(
        res.ok
          ? { kind: "success", text: res.message ?? "Verificado.", extra: res.warnings }
          : { kind: "error", text: res.error },
      );
    });
  }

  function cancel(id: string) {
    if (!window.confirm("Cancelar este agendamento?")) return;
    setFeedback(null);
    start(async () => {
      const res = await cancelOrder(id);
      setFeedback(res.ok ? { kind: "success", text: res.message ?? "Cancelado." } : { kind: "error", text: res.error });
    });
  }

  if (orders.length === 0) return null;

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <div>
          <h2 className="font-semibold">Compras agendadas</h2>
          <p className="text-xs text-zinc-500">
            Executadas no horário do pregão quando a cotação fica no preço desejado ou abaixo (verificação automática 3x
            por dia útil).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-secondary btn-xs" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "Só pendentes" : `Histórico (${orders.length})`}
          </button>
          {active.length ? (
            <button
              type="button"
              className="btn-primary btn-xs"
              onClick={checkNow}
              disabled={pending || !marketOpen}
              title={marketOpen ? "Verifica a cotação e executa as que atingiram o preço" : "Pregão fechado"}
            >
              {pending ? "Verificando…" : "Verificar agora"}
            </button>
          ) : null}
        </div>
      </div>
      {feedback ? (
        <div className="px-4 pt-3">
          <FeedbackBox feedback={feedback} />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-zinc-500">Nenhum agendamento pendente.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60">
              <tr>
                <th className="px-3 py-2">Papel</th>
                <th className="px-3 py-2">Agendada por</th>
                <th className="px-3 py-2 text-right">Qtd.</th>
                <th className="px-3 py-2 text-right">Preço desejado</th>
                <th className="px-3 py-2">Validade</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Última verificação</th>
                <th className="px-3 py-2">Agendada em</th>
                {showActions ? <th className="px-3 py-2 text-right">Ações</th> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {rows.map((o) => (
                <tr key={o.id} className="align-top">
                  <td className="px-3 py-2 font-semibold">
                    <Link href={`/papel/${o.ticker}`} className="hover:underline">
                      {o.ticker}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    {ownerLabel(o.created_by, memberNames)}
                    {currentUserId && o.created_by === currentUserId ? (
                      <span className="ml-1 text-xs text-zinc-500">(você)</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(o.quantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    até {formatBRL(o.limit_price)}
                    {o.status === "executed" && o.executed_price !== null ? (
                      <div className="text-xs text-emerald-600">comprado a {formatBRL(o.executed_price)}</div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{o.valid_until ? formatDate(o.valid_until) : "até cancelar"}</td>
                  <td className="px-3 py-2">
                    <span className={`badge ${STATUS[o.status].cls}`}>{STATUS[o.status].label}</span>
                    {o.error ? <div className="mt-1 max-w-64 text-xs text-zinc-500">{o.error}</div> : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-xs text-zinc-500">
                    {o.last_checked_at ? (
                      <>
                        {formatDateTime(o.last_checked_at)}
                        {o.last_check_price !== null ? <div>cotação {formatBRL(o.last_check_price)}</div> : null}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-xs text-zinc-500">{formatDateTime(o.created_at)}</td>
                  {showActions ? (
                    <td className="px-3 py-2 text-right">
                      {canCancel(o) ? (
                        <button
                          type="button"
                          className="btn-secondary btn-xs text-red-600"
                          disabled={pending}
                          onClick={() => cancel(o.id)}
                        >
                          Cancelar
                        </button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
