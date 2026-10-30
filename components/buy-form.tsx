"use client";

import { useState, useTransition } from "react";
import { buyPosition, lookupQuote } from "@/app/actions/positions";
import { formatBRL, formatDate, formatPct, parseDecimal } from "@/lib/format";
import { FeedbackBox, type Feedback } from "./modal";

const TICKER_RE = /^[A-Z0-9]{4,12}$/;

export function BuyForm({
  maxQty,
  cashBalance,
  today,
}: {
  maxQty: number;
  cashBalance: number;
  today: string;
}) {
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [buyDate, setBuyDate] = useState(today);
  const [price, setPrice] = useState("");
  const [quoteInfo, setQuoteInfo] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [looking, startLookup] = useTransition();
  const [saving, startSave] = useTransition();

  const t = ticker.trim().toUpperCase();
  const qty = Number(quantity);
  const priceNum = parseDecimal(price);
  const total = Number.isFinite(priceNum) && Number.isInteger(qty) ? priceNum * qty : null;
  const balanceAfter = total !== null ? cashBalance - total : null;
  const disabled = maxQty <= 0;

  function onLookup() {
    if (!TICKER_RE.test(t)) {
      setFeedback({ kind: "error", text: "Digite um ticker válido (ex: PETR4)." });
      return;
    }
    setFeedback(null);
    setQuoteInfo(null);
    startLookup(async () => {
      const res = await lookupQuote(t);
      if (!res.ok) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      const q = res.data!;
      setPrice(q.price.toFixed(2).replace(".", ","));
      setQuoteInfo(
        `${q.source === "fundamentus" ? "Fundamentus" : "InfoMoney"} em ${formatDate(q.quoteDate)}: ${formatBRL(q.price)}` +
          (q.changePct !== null ? ` (${formatPct(q.changePct)} no dia)` : "") +
          (q.note ? ` · ${q.note}` : ""),
      );
    });
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!TICKER_RE.test(t)) return setFeedback({ kind: "error", text: "Ticker inválido." });
    if (!Number.isInteger(qty) || qty < 1 || qty > maxQty)
      return setFeedback({ kind: "error", text: `Quantidade deve ser entre 1 e ${maxQty}.` });
    if (!Number.isFinite(priceNum) || priceNum <= 0)
      return setFeedback({ kind: "error", text: "Informe um preço de compra válido." });
    if (!buyDate || buyDate > today) return setFeedback({ kind: "error", text: "Data de compra inválida." });

    setFeedback(null);
    startSave(async () => {
      const res = await buyPosition({ ticker: t, quantity: qty, buyDate, buyPrice: priceNum });
      if (!res.ok) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setFeedback({ kind: "success", text: res.message ?? "Compra registrada.", extra: res.warnings });
      setTicker("");
      setQuantity("1");
      setPrice("");
      setBuyDate(today);
      setQuoteInfo(null);
    });
  }

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Nova compra</h2>
        <span className="text-xs text-zinc-500">
          Disponível para comprar: <strong>{maxQty}</strong> ação(ões)
        </span>
      </div>

      {disabled ? (
        <FeedbackBox
          feedback={{ kind: "warning", text: "A carteira já tem 100 ações abertas. Feche alguma posição para comprar." }}
        />
      ) : null}

      <fieldset disabled={disabled || saving} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label className="label" htmlFor="buy-ticker">
            Papel (ticker)
          </label>
          <div className="flex gap-2">
            <input
              id="buy-ticker"
              className="input uppercase"
              placeholder="PETR4"
              value={ticker}
              onChange={(e) => {
                setTicker(e.target.value.toUpperCase());
                setQuoteInfo(null);
              }}
              maxLength={12}
              autoComplete="off"
              required
            />
            <button
              type="button"
              className="btn-secondary shrink-0"
              onClick={onLookup}
              disabled={looking || !TICKER_RE.test(t)}
              title="Buscar cotação atual (Fundamentus, com fallback InfoMoney)"
            >
              {looking ? "Buscando…" : "Buscar cotação atual"}
            </button>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="buy-qty">
            Quantidade (máx. {Math.max(0, maxQty)})
          </label>
          <input
            id="buy-qty"
            className="input"
            type="number"
            min={1}
            max={Math.max(1, maxQty)}
            step={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="buy-date">
            Data da compra
          </label>
          <input
            id="buy-date"
            className="input"
            type="date"
            max={today}
            value={buyDate}
            onChange={(e) => setBuyDate(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="buy-price">
            Preço de compra (R$)
          </label>
          <input
            id="buy-price"
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            required
          />
        </div>
      </fieldset>

      {quoteInfo ? <p className="text-xs text-zinc-500">{quoteInfo}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          Total: <strong>{formatBRL(total)}</strong>
          {balanceAfter !== null ? (
            <>
              {" "}
              · Caixa após a compra:{" "}
              <strong className={balanceAfter < 0 ? "text-red-600" : ""}>{formatBRL(balanceAfter)}</strong>
            </>
          ) : null}
        </div>
        <button type="submit" className="btn-primary" disabled={disabled || saving}>
          {saving ? "Salvando e tirando print…" : "Registrar compra"}
        </button>
      </div>

      {balanceAfter !== null && balanceAfter < 0 && !saving ? (
        <FeedbackBox
          feedback={{
            kind: "warning",
            text: "Essa compra deixa o saldo em caixa negativo. Você pode continuar mesmo assim.",
          }}
        />
      ) : null}
      {saving ? (
        <p className="text-xs text-zinc-500">
          Registrando a compra, tirando o print do Fundamentus e importando o histórico. Pode levar até 1 minuto.
        </p>
      ) : null}
      <FeedbackBox feedback={feedback} />
    </form>
  );
}
