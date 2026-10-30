"use client";

import { useState, useTransition } from "react";
import { addCashMovement, deleteCashMovement } from "@/app/actions/cash";
import { formatBRL, parseDecimal } from "@/lib/format";
import { FeedbackBox, type Feedback } from "./modal";

type Kind = "deposit" | "withdraw" | "adjust";

const KIND_HELP: Record<Kind, string> = {
  deposit: "Entrada de dinheiro no caixa (valor positivo).",
  withdraw: "Saída de dinheiro do caixa (informe o valor positivo; será debitado).",
  adjust: "Correção com sinal: positivo soma, negativo subtrai (ex: -12,50).",
};

export function CashForm({ balance }: { balance: number }) {
  const [kind, setKind] = useState<Kind>("deposit");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, start] = useTransition();

  const value = parseDecimal(amount);
  const signed = !Number.isFinite(value)
    ? null
    : kind === "deposit"
      ? Math.abs(value)
      : kind === "withdraw"
        ? -Math.abs(value)
        : value;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (signed === null || signed === 0) return setFeedback({ kind: "error", text: "Informe um valor válido." });
    setFeedback(null);
    start(async () => {
      const res = await addCashMovement({ kind, amount: value, note });
      if (!res.ok) return setFeedback({ kind: "error", text: res.error });
      setFeedback({ kind: "success", text: res.message ?? "Lançado." });
      setAmount("");
      setNote("");
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="font-semibold">Novo lançamento</h2>
      <fieldset disabled={pending} className="grid gap-3 sm:grid-cols-4">
        <div>
          <label className="label" htmlFor="cash-kind">
            Tipo
          </label>
          <select id="cash-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            <option value="deposit">Aporte</option>
            <option value="withdraw">Retirada</option>
            <option value="adjust">Ajuste</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="cash-amount">
            Valor (R$)
          </label>
          <input
            id="cash-amount"
            className="input"
            inputMode="decimal"
            placeholder={kind === "adjust" ? "-10,00 ou 10,00" : "0,00"}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label" htmlFor="cash-note">
            Observação
          </label>
          <input
            id="cash-note"
            className="input"
            maxLength={300}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Opcional"
          />
        </div>
      </fieldset>
      <p className="text-xs text-zinc-500">{KIND_HELP[kind]}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          Saldo após o lançamento:{" "}
          <strong className={signed !== null && balance + signed < 0 ? "text-red-600" : ""}>
            {formatBRL(signed === null ? balance : balance + signed)}
          </strong>
        </span>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Lançando…" : "Lançar"}
        </button>
      </div>
      <FeedbackBox feedback={feedback} />
    </form>
  );
}

export function DeleteCashButton({ id }: { id: number }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        className="btn-secondary btn-xs text-red-600"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Excluir este lançamento?")) return;
          start(async () => {
            const res = await deleteCashMovement(id);
            setError(res.ok ? null : res.error);
          });
        }}
      >
        {pending ? "Excluindo…" : "Excluir"}
      </button>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
    </span>
  );
}
