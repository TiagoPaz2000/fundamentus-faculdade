"use client";

import { useState, useTransition } from "react";
import { scheduleOrder } from "@/app/actions/orders";
import { buyPosition, lookupQuote, type QuoteLookup } from "@/app/actions/positions";
import { formatBRL, formatDate, formatPct, parseDecimal, signClass } from "@/lib/format";
import { FeedbackBox, type Feedback } from "./modal";
import { TickerCombobox } from "./ticker-combobox";

/** Regra da carteira: cada papel é comprado com exatamente 100 ações. */
const SHARES_PER_TICKER = 100;

type Mode = "buy" | "schedule";

/**
 * Compra: escolhe o papel na lista → aparece a cotação atual e as 100 ações →
 * "Comprar" registra pela cotação do momento e tira o print do Fundamentus.
 * Fora do pregão: agenda com o preço desejado.
 */
export function BuyForm({
  slotsAvailable,
  maxTickers,
  takenTickers,
  cashBalance,
  today,
  marketOpen,
  marketLabel,
}: {
  /** Vagas de papel livres: MAX_TICKERS − abertos − agendados */
  slotsAvailable: number;
  maxTickers: number;
  /** Papéis já abertos ou com compra agendada (não podem ser escolhidos). */
  takenTickers: string[];
  cashBalance: number;
  today: string;
  marketOpen: boolean;
  marketLabel: string;
}) {
  const [mode, setMode] = useState<Mode>(marketOpen ? "buy" : "schedule");
  const [ticker, setTicker] = useState("");
  const [quote, setQuote] = useState<QuoteLookup | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [limitPrice, setLimitPrice] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [looking, startLookup] = useTransition();
  const [saving, startSave] = useTransition();

  const isBuy = marketOpen && mode === "buy";
  const full = slotsAvailable <= 0;
  const used = maxTickers - Math.max(0, slotsAvailable);

  const unitPrice = isBuy ? (quote?.price ?? null) : parseDecimal(limitPrice);
  const total = unitPrice !== null && Number.isFinite(unitPrice) ? unitPrice * SHARES_PER_TICKER : null;
  const balanceAfter = total !== null ? cashBalance - total : null;

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
      setLimitPrice(res.data!.price.toFixed(2).replace(".", ","));
    });
  }

  function submit() {
    if (!ticker) return;
    setFeedback(null);
    startSave(async () => {
      if (isBuy) {
        const res = await buyPosition({ ticker });
        if (!res.ok) return setFeedback({ kind: "error", text: res.error });
        setFeedback({ kind: "success", text: res.message ?? "Compra registrada.", extra: res.warnings });
      } else {
        const price = parseDecimal(limitPrice);
        if (!Number.isFinite(price) || price <= 0) return setFeedback({ kind: "error", text: "Informe o preço desejado." });
        if (validUntil && validUntil < today)
          return setFeedback({ kind: "error", text: "A validade precisa ser hoje ou uma data futura." });
        const res = await scheduleOrder({ ticker, limitPrice: price, validUntil: validUntil || null });
        if (!res.ok) return setFeedback({ kind: "error", text: res.error });
        setFeedback({ kind: "success", text: res.message ?? "Compra agendada." });
      }
      setTicker("");
      setQuote(null);
      setLimitPrice("");
      setValidUntil("");
    });
  }

  const tab = (active: boolean) =>
    `flex-1 rounded-md px-3 py-2.5 text-sm font-medium sm:flex-none sm:py-1.5 ${
      active
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-600 disabled:opacity-40 dark:text-zinc-300"
    }`;

  return (
    <section className="card space-y-4 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-zinc-200 p-1 dark:border-zinc-700">
          <button
            type="button"
            className={tab(isBuy)}
            onClick={() => setMode("buy")}
            disabled={!marketOpen || saving}
          >
            Comprar agora
          </button>
          <button type="button" className={tab(!isBuy)} onClick={() => setMode("schedule")} disabled={saving}>
            Agendar compra
          </button>
        </div>
        <div className="text-xs text-zinc-500">
          Papéis: <strong>{used}</strong>/{maxTickers} (abertos + agendados) · cada compra = {SHARES_PER_TICKER} ações
        </div>
      </div>

      <p
        className={`flex items-start gap-2 text-xs ${marketOpen ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
      >
        <span className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${marketOpen ? "bg-emerald-500" : "bg-amber-500"}`} />
        <span>
          {marketLabel}
          {!marketOpen ? ". Agende com o preço desejado: a compra é feita no pregão quando a cotação chegar nele." : ""}
        </span>
      </p>

      {full ? (
        <FeedbackBox
          feedback={{
            kind: "warning",
            text: `A carteira já tem ${maxTickers} papéis (abertos + agendados). Feche uma posição ou cancele um agendamento para escolher outro.`,
          }}
        />
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
                      ? "Buscando cotação atual…"
                      : quote
                        ? `${quote.source === "fundamentus" ? "Fundamentus" : "InfoMoney"} · ${formatDate(quote.quoteDate)}${quote.note ? ` · ${quote.note}` : ""}`
                        : (quoteError ?? "")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-zinc-500">Valor atual</div>
                  <div className="text-2xl font-semibold tabular-nums">
                    {looking ? <span className="animate-pulse text-zinc-400">…</span> : formatBRL(quote?.price)}
                  </div>
                  {quote && !quote.stale && quote.changePct !== null ? (
                    <div className={`text-sm tabular-nums ${signClass(quote.changePct)}`}>{formatPct(quote.changePct)} hoje</div>
                  ) : null}
                </div>
              </div>

              {quote?.stale ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
                  {ticker} não tem negociação recente (última cotação em {formatDate(quote.quoteDate)}). Escolha outro
                  papel.
                </p>
              ) : null}

              {!isBuy ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="limit-price">
                      Preço desejado (máximo por ação)
                    </label>
                    <input
                      id="limit-price"
                      className="input"
                      inputMode="decimal"
                      placeholder="0,00"
                      value={limitPrice}
                      onChange={(e) => setLimitPrice(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="valid-until">
                      Válida até (opcional)
                    </label>
                    <input
                      id="valid-until"
                      className="input"
                      type="date"
                      min={today}
                      value={validUntil}
                      onChange={(e) => setValidUntil(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                </div>
              ) : null}

              <dl className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">Quantidade</dt>
                  <dd className="whitespace-nowrap text-sm font-semibold tabular-nums sm:text-base">{SHARES_PER_TICKER}</dd>
                </div>
                <div className="rounded-md bg-zinc-50 p-2 dark:bg-zinc-800/60">
                  <dt className="text-[11px] uppercase tracking-wide text-zinc-500">{isBuy ? "Total" : "Total máx."}</dt>
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
                disabled={saving || looking || (isBuy && !quote) || Boolean(quote?.stale)}
              >
                {saving
                  ? isBuy
                    ? "Comprando e tirando o print…"
                    : "Agendando…"
                  : isBuy
                    ? `Comprar ${SHARES_PER_TICKER} ${ticker}${quote ? ` por ${formatBRL(quote.price)}` : ""}`
                    : `Agendar ${SHARES_PER_TICKER} ${ticker}`}
              </button>
              {saving && isBuy ? (
                <p className="text-center text-xs text-zinc-500">
                  O preço final é a cotação no momento da compra. O print do Fundamentus pode levar até 1 minuto.
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
