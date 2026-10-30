"use client";

import { useState, useTransition } from "react";
import { buyPosition, lookupQuote, type QuoteLookup } from "@/app/actions/positions";
import { MAX_PER_USER, SHARES_PER_TICKER, USER_LIMIT_MESSAGE } from "@/lib/errors";
import { formatBRL, formatDate, formatPct, signClass } from "@/lib/format";
import { FeedbackBox, type Feedback } from "./modal";
import { TickerCombobox } from "./ticker-combobox";

/**
 * Compra: escolhe o papel na lista → aparece a cotação e as 100 ações →
 * "Comprar" registra pela cotação buscada no momento do clique e tira o print do
 * Fundamentus. A compra é aceita a qualquer hora: fora do pregão a cotação é a do
 * último fechamento (o formulário mostra "fechamento de dd/mm").
 * Qualquer membro usa; a compra é sempre em nome do usuário logado.
 * Limites: carteira com maxTickers papéis e cada membro com maxPerUser posições
 * abertas. O servidor valida de novo.
 */
export function BuyForm({
  slotsAvailable,
  maxTickers,
  takenTickers,
  cashBalance,
  marketOpen,
  marketLabel,
  userSlotsUsed = 0,
  maxPerUser = MAX_PER_USER,
}: {
  /** Vagas de papel livres: MAX_TICKERS − papéis abertos */
  slotsAvailable: number;
  maxTickers: number;
  /** Papéis já abertos (não podem ser escolhidos). */
  takenTickers: string[];
  cashBalance: number;
  marketOpen: boolean;
  marketLabel: string;
  /** Papéis do usuário logado: posições abertas dele. */
  userSlotsUsed?: number;
  maxPerUser?: number;
}) {
  const [ticker, setTicker] = useState("");
  const [quote, setQuote] = useState<QuoteLookup | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [looking, startLookup] = useTransition();
  const [saving, startSave] = useTransition();

  const used = maxTickers - Math.max(0, slotsAvailable);
  const portfolioFull = slotsAvailable <= 0;
  const userFull = userSlotsUsed >= maxPerUser;
  const blockedReason = userFull
    ? USER_LIMIT_MESSAGE
    : portfolioFull
      ? `A carteira já tem ${maxTickers} papéis abertos. Espere uma venda para escolher outro.`
      : null;

  const total = quote ? quote.price * SHARES_PER_TICKER : null;
  const balanceAfter = total !== null ? cashBalance - total : null;
  // "cotação atual" ou "fechamento de dd/mm" (calculado no servidor na consulta).
  const basis = quote?.priceBasis ?? (marketOpen ? "cotação atual" : "último fechamento");
  const basisTitle = basis.charAt(0).toUpperCase() + basis.slice(1);

  function selectTicker(t: string) {
    setTicker(t);
    setQuote(null);
    setQuoteError(null);
    setFeedback(null);
    if (!t) return;
    startLookup(async () => {
      const res = await lookupQuote(t);
      if (!res.ok) {
        setQuoteError(res.error);
        return;
      }
      setQuote(res.data!);
    });
  }

  function submit() {
    if (!ticker) return;
    setFeedback(null);
    startSave(async () => {
      const res = await buyPosition({ ticker });
      if (!res.ok) return setFeedback({ kind: "error", text: res.error });
      setFeedback({ kind: "success", text: res.message ?? "Compra registrada.", extra: res.warnings });
      setTicker("");
      setQuote(null);
    });
  }

  return (
    <section className="card space-y-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="font-semibold">Comprar</h2>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
          <span className={userFull ? "text-amber-700 dark:text-amber-400" : undefined}>
            Seus papéis: <strong>{Math.min(userSlotsUsed, maxPerUser)}</strong>/{maxPerUser}
          </span>
          <span className={portfolioFull ? "text-amber-700 dark:text-amber-400" : undefined}>
            Carteira: <strong>{used}</strong>/{maxTickers}
          </span>
          <span>cada compra = {SHARES_PER_TICKER} ações</span>
        </div>
      </div>

      <p
        className={`flex items-start gap-2 text-xs ${marketOpen ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
      >
        <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${marketOpen ? "bg-emerald-500" : "bg-amber-500"}`} />
        <span>
          {marketLabel}
          {marketOpen
            ? ". A compra usa a cotação atual."
            : ". Dá para comprar mesmo assim: a compra usa o valor de fechamento do último pregão."}
        </span>
      </p>

      {blockedReason ? (
        <FeedbackBox feedback={{ kind: "warning", text: blockedReason }} />
      ) : (
        <>
          <div>
            <label className="label">Papel</label>
            <TickerCombobox
              value={ticker}
              onChange={selectTicker}
              disabledTickers={takenTickers}
              disabled={saving}
            />
          </div>

          {ticker ? (
            <div className="space-y-4 rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold">{ticker}</div>
                  <div className="text-xs text-zinc-500">
                    {looking
                      ? "Buscando cotação…"
                      : quote
                        ? `${quote.source === "fundamentus" ? "Fundamentus" : "InfoMoney"} · ${formatDate(quote.quoteDate)}${quote.note ? ` · ${quote.note}` : ""}`
                        : (quoteError ?? "")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500">{looking ? "Cotação" : basisTitle}</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {looking ? <span className="animate-pulse text-zinc-400">…</span> : formatBRL(quote?.price)}
                  </div>
                  {quote && !quote.stale && quote.changePct !== null ? (
                    <div className={`text-sm tabular-nums ${signClass(quote.changePct)}`}>
                      {formatPct(quote.changePct)} {quote.marketOpen ? "hoje" : "no dia"}
                    </div>
                  ) : null}
                </div>
              </div>

              {quote?.stale ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {ticker} não tem negociação recente (última cotação em {formatDate(quote.quoteDate)}). Escolha outro
                  papel.
                </p>
              ) : quote ? (
                <p className="text-xs text-zinc-500">
                  Preço da compra: <strong>{basis}</strong>
                  {quote.marketOpen ? " (buscada de novo no momento do clique)" : ""}.
                </p>
              ) : null}

              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Quantidade</dt>
                  <dd className="whitespace-nowrap text-sm font-semibold tabular-nums sm:text-base">{SHARES_PER_TICKER}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Total</dt>
                  <dd className="whitespace-nowrap text-sm font-semibold tabular-nums sm:text-base">{formatBRL(total)}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Caixa depois</dt>
                  <dd className={`whitespace-nowrap text-sm font-semibold tabular-nums sm:text-base ${balanceAfter !== null && balanceAfter < 0 ? "text-red-600" : ""}`}>
                    {formatBRL(balanceAfter)}
                  </dd>
                </div>
              </dl>

              {balanceAfter !== null && balanceAfter < 0 ? (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  O saldo em caixa vai ficar negativo. Dá para continuar mesmo assim.
                </p>
              ) : null}

              <button
                type="button"
                className="btn-primary w-full whitespace-normal py-3 text-base"
                onClick={submit}
                disabled={saving || looking || !quote || quote.stale}
              >
                {saving
                  ? "Comprando e tirando o print…"
                  : `Comprar ${SHARES_PER_TICKER} ${ticker}${quote ? ` por ${formatBRL(quote.price)}` : ""}`}
              </button>
              {saving ? (
                <p className="text-center text-xs text-zinc-500">
                  O preço final é a cotação buscada no momento da compra
                  {quote && !quote.marketOpen ? " (fora do pregão, o último fechamento)" : ""}. O print do Fundamentus
                  pode levar até 1 minuto.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      <FeedbackBox feedback={feedback} />
    </section>
  );
}
