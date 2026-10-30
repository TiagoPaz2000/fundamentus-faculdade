import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { CashForm, DeleteCashButton } from "@/components/cash-form";
import { ErrorBlock, LoadingBlock } from "@/components/page-states";
import { requireUser } from "@/lib/auth";
import { formatBRL, formatDateTime, signClass } from "@/lib/format";
import { loadCashMovements, type CashMovementView } from "@/lib/portfolio";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Caixa" };

const KIND_LABEL: Record<CashMovementView["kind"], string> = {
  deposit: "Aporte",
  withdraw: "Retirada",
  adjust: "Ajuste",
  buy: "Compra",
  sell: "Venda",
};

export default function CaixaPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Caixa</h1>
        <p className="text-sm text-zinc-500">
          Valor disponível. Compras debitam e vendas creditam automaticamente.
        </p>
      </div>
      <Suspense fallback={<LoadingBlock label="Carregando caixa…" />}>
        <CaixaContent />
      </Suspense>
    </div>
  );
}

async function CaixaContent() {
  const user = await requireUser();
  const supabase = await createClient();
  let movements: CashMovementView[];
  try {
    movements = await loadCashMovements(supabase);
  } catch (err) {
    return <ErrorBlock error={err} />;
  }
  const balance = movements.length ? movements[movements.length - 1].balanceAfter : 0;
  const rows = [...movements].reverse();

  return (
    <div className="space-y-6">
      <div className="card p-4">
        <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">Saldo em caixa</div>
        <div className={`mt-1 text-3xl font-semibold tabular-nums ${balance < 0 ? "text-red-600" : ""}`}>
          {formatBRL(balance)}
        </div>
      </div>

      {user.isAdmin ? <CashForm balance={balance} /> : null}

      <div className="card overflow-hidden">
        {rows.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-zinc-500">Nenhuma movimentação ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900/60">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Descrição</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-right">Saldo</th>
                  {user.isAdmin ? <th className="px-3 py-2 text-right">Ações</th> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="px-3 py-2 tabular-nums">{formatDateTime(m.created_at)}</td>
                    <td className="px-3 py-2">{KIND_LABEL[m.kind]}</td>
                    <td className="px-3 py-2">
                      {m.ticker ? (
                        <Link href={`/papel/${m.ticker}`} className="font-medium hover:underline">
                          {m.note ?? m.ticker}
                        </Link>
                      ) : (
                        (m.note ?? <span className="text-zinc-400">—</span>)
                      )}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums ${signClass(m.amount)}`}>{formatBRL(m.amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatBRL(m.balanceAfter)}</td>
                    {user.isAdmin ? (
                      <td className="px-3 py-2 text-right">
                        {m.kind === "deposit" || m.kind === "withdraw" || m.kind === "adjust" ? (
                          <DeleteCashButton id={m.id} />
                        ) : (
                          <span className="text-xs text-zinc-400">automático</span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
