"use client";

import { useState, useTransition } from "react";
import { scheduleOrder } from "@/app/actions/orders";
import { buyPosition, lookupQuote } from "@/app/actions/positions";
import { formatBRL, formatDate, formatPct, parseDecimal } from "@/lib/format";
import { FeedbackBox, type Feedback } from "./modal";

/** Regra da carteira: cada papel é comprado com exatamente 100 ações. */
const SHARES_PER_TICKER = 100;

const TICKER_RE = /^[A-Z0-9]{4,12}$/;

type Mode = "buy" | "schedule";

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
  /** Papéis já abertos ou com compra agendada (não podem ser comprados de novo). */
  takenTickers: string[];
  cashBalance: number;
  today: string;
  marketOpen: boolean;
  marketLabel: string;
}) {
  const [mode, setMode] = useState<Mode>(marketOpen ? "buy" : "schedule");
  const [ticker, setTicker] = useState("");
  const [price, setPrice] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [quoteInfo, setQuoteInfo] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [looking, startLookup] = useTransition();
  const [saving, startSave] = useTransition();

  // Se o pregão fechar com a página aberta, o servidor recusa a compra; aqui só refletimos o estado inicial.
  const effectiveMode: Mode = marketOpen ? mode : "schedule";
  const isBuy = effectiveMode === "buy";

  const t = ticker.trim().toUpperCase();
  const priceNum = parseDecimal(price);
  const total = Number.isFinite(priceNum) ? priceNum * SHARES_PER_TICKER : null;
  const balanceAfter = total !== null ? cashBalance - total : null;
  const disabled = slotsAvailable <= 0;
  const alreadyTaken = takenTickers.includes(t);

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

  function reset() {
    setTicker("");
    setPrice("");
    setValidUntil("");
    setQuoteInfo(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!TICKER_RE.test(t)) return setFeedback({ kind: "error", text: "Ticker inválido." });
    if (alreadyTaken)
      return setFeedback({ kind: "error", text: `${t} já está na carteira (ou agendado). Cada papel entra uma única vez.` });
    if (!Number.isFinite(priceNum) || priceNum <= 0)
      return setFeedback({ kind: "error", text: isBuy ? "Informe um preço de compra válido." : "Informe o preço desejado." });
    if (!isBuy && validUntil && validUntil < today)
      return setFeedback({ kind: "error", text: "A validade precisa ser hoje ou uma data futura." });

    setFeedback(null);
    startSave(async () => {
      const res = isBuy
        ? await buyPosition({ ticker: t, buyPrice: priceNum })
        : await scheduleOrder({ ticker: t, limitPrice: priceNum, validUntil: validUntil || null });
      if (!res.ok) {
        setFeedback({ kind: "error", text: res.error });
        return;
      }
      setFeedback({ kind: "success", text: res.message ?? "Feito.", extra: res.warnings });
      reset();
    });
  }

  const tabClass = (active: boolean) =>
    `rounded px-3 py-1 text-sm ${
      active
        ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
        : "text-zinc-600 hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:text-zinc-300 dark:hover:bg-zinc-800"
    }`;

  return (
    <form onSubmit={onSubmit} className="card space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-md border border-zinc-200 p-0.5 dark:border-zinc-700">
          <button
            type="button"
            className={tabClass(isBuy)}
            onClick={() => setMode("buy")}
            disabled={!marketOpen}
            title={marketOpen ? undefined : marketLabel}
          >
            Comprar agora
          </button>
          <button type="button" className={tabClass(!isBuy)} onClick={() => setMode("schedule")}>
            Agendar compra
          </button>
        </div>
        <span className="text-xs text-zinc-500">
          Vagas ocupadas (abertos + agendados): <strong>{maxTickers - Math.max(0, slotsAvailable)}</strong>/{maxTickers} · livres:{" "}
          <strong>{Math.max(0, slotsAvailable)}</strong> · cada compra = {SHARES_PER_TICKER} ações
        </span>
      </div>

      <div
        className={`flex items-center gap-2 text-xs ${marketOpen ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${marketOpen ? "bg-emerald-500" : "bg-amber-500"}`} />
        {marketLabel}
        {!marketOpen ? ". Defina o preço e agende: a compra é feita no pregão quando a cotação chegar nele." : ""}
      </div>

      {disabled ? (
        <FeedbackBox
          feedback={{
            kind: "warning",
            text: `A carteira já tem ${maxTickers} papéis (abertos + agendados). Feche uma posição ou cancele um agendamento para escolher outro.`,
          }}
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
          <span className="label">Quantidade</span>
          <div className="input bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            {SHARES_PER_TICKER} ações (fixo)
          </div>
        </div>
        <div>
          <label className="label" htmlFor="buy-price">
            {isBuy ? "Preço de compra (R$)" : "Preço desejado (máx., R$)"}
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
        {isBuy ? (
          <div>
            <span className="label">Data da compra</span>
            <div className="input bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">{formatDate(today)}</div>
          </div>
        ) : (
          <div>
            <label className="label" htmlFor="buy-valid">
              Válida até (opcional)
            </label>
            <input
              id="buy-valid"
              className="input"
              type="date"
              min={today}
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        )}
      </fieldset>

      {alreadyTaken ? (
        <p className="text-xs text-red-600">{t} já está na carteira ou tem compra agendada: cada papel entra uma única vez.</p>
      ) : null}
      {quoteInfo ? <p className="text-xs text-zinc-500">{quoteInfo}</p> : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {isBuy ? "Total" : "Total máximo"}: <strong>{formatBRL(total)}</strong>
          {balanceAfter !== null ? (
            <>
              {" "}
              · Caixa {isBuy ? "após a compra" : "se executar"}:{" "}
              <strong className={balanceAfter < 0 ? "text-red-600" : ""}>{formatBRL(balanceAfter)}</strong>
            </>
          ) : null}
        </div>
        <button type="submit" className="btn-primary" disabled={disabled || saving || alreadyTaken}>
          {saving ? (isBuy ? "Salvando e tirando print…" : "Agendando…") : isBuy ? "Registrar compra" : "Agendar compra"}
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
      {saving && isBuy ? (
        <p className="text-xs text-zinc-500">
          Registrando a compra, tirando o print do Fundamentus e importando o histórico. Pode levar até 1 minuto.
        </p>
      ) : null}
      <FeedbackBox feedback={feedback} />
    </form>
  );
}
