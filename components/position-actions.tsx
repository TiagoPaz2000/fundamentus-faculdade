"use client";

import { useState, useTransition } from "react";
import {
  closePosition,
  deletePosition,
  lookupQuote,
  reimportHistory,
  reopenPosition,
  retakeScreenshot,
  updatePosition,
} from "@/app/actions/positions";
import { formatBRL, formatDate, formatPct, parseDecimal } from "@/lib/format";
import type { PositionView } from "@/lib/portfolio";
import { FeedbackBox, Modal, type Feedback } from "./modal";

type Props = { position: PositionView; today: string; maxQtyForEdit: number };

function priceToInput(n: number | null | undefined) {
  return n === null || n === undefined ? "" : String(Number(n.toFixed(4))).replace(".", ",");
}

// ---------------------------------------------------------------------------
// Fechar posição
// ---------------------------------------------------------------------------

export function ClosePositionButton({ position, today }: { position: PositionView; today: string }) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [sellDate, setSellDate] = useState(today);
  const [quoteInfo, setQuoteInfo] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [looking, startLookup] = useTransition();
  const [saving, startSave] = useTransition();

  function fetchQuote() {
    setQuoteInfo(null);
    startLookup(async () => {
      const res = await lookupQuote(position.ticker);
      if (!res.ok) {
        setFeedback({ kind: "warning", text: `${res.error} Informe o preço manualmente.` });
        return;
      }
      const q = res.data!;
      setPrice(priceToInput(q.price));
      setQuoteInfo(
        `${q.source === "fundamentus" ? "Fundamentus" : "InfoMoney"} em ${formatDate(q.quoteDate)}` +
          (q.changePct !== null ? ` · ${formatPct(q.changePct)} no dia` : "") +
          (q.note ? ` · ${q.note}` : ""),
      );
    });
  }

  function openDialog() {
    setOpen(true);
    setFeedback(null);
    setSellDate(today);
    setPrice(priceToInput(position.current?.price));
    fetchQuote();
  }

  const sellNum = parseDecimal(price);
  const result = Number.isFinite(sellNum) ? (sellNum - position.buy_price) * position.quantity : null;

  function confirm(e: React.FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(sellNum) || sellNum <= 0) return setFeedback({ kind: "error", text: "Preço de venda inválido." });
    if (!sellDate || sellDate > today || sellDate < position.buy_date)
      return setFeedback({ kind: "error", text: "Data de venda inválida." });
    setFeedback(null);
    startSave(async () => {
      const res = await closePosition({ id: position.id, sellDate, sellPrice: sellNum });
      if (!res.ok) return setFeedback({ kind: "error", text: res.error });
      if (res.warnings?.length) {
        setFeedback({ kind: "success", text: res.message ?? "Posição fechada.", extra: res.warnings });
      } else {
        setOpen(false);
      }
    });
  }

  return (
    <>
      <button type="button" className="btn-primary btn-xs" onClick={openDialog}>
        Fechar posição
      </button>
      <Modal open={open} onClose={() => !saving && setOpen(false)} title={`Fechar posição · ${position.ticker}`}>
        <form onSubmit={confirm} className="space-y-4">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {position.quantity} ação(ões) compradas a {formatBRL(position.buy_price)} em {formatDate(position.buy_date)}.
          </p>
          <fieldset disabled={saving} className="grid grid-cols-2 gap-3">
            <div>
              <label className="label" htmlFor={`sell-price-${position.id}`}>
                Preço de venda (R$)
              </label>
              <input
                id={`sell-price-${position.id}`}
                className="input"
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={looking ? "Buscando…" : "0,00"}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor={`sell-date-${position.id}`}>
                Data da venda
              </label>
              <input
                id={`sell-date-${position.id}`}
                className="input"
                type="date"
                min={position.buy_date}
                max={today}
                value={sellDate}
                onChange={(e) => setSellDate(e.target.value)}
                required
              />
            </div>
          </fieldset>
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{looking ? "Buscando cotação atual…" : (quoteInfo ?? "")}</span>
            <button type="button" className="btn-secondary btn-xs" onClick={fetchQuote} disabled={looking || saving}>
              Atualizar cotação
            </button>
          </div>
          {result !== null ? (
            <p className="text-sm">
              Resultado da operação:{" "}
              <strong className={result >= 0 ? "text-emerald-600" : "text-red-600"}>{formatBRL(result)}</strong>
            </p>
          ) : null}
          <FeedbackBox feedback={feedback} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)} disabled={saving}>
              {feedback?.kind === "success" ? "Fechar" : "Cancelar"}
            </button>
            {feedback?.kind !== "success" ? (
              <button type="submit" className="btn-primary" disabled={saving || looking}>
                {saving ? "Fechando e tirando print…" : "Confirmar venda"}
              </button>
            ) : null}
          </div>
        </form>
      </Modal>
    </>
  );
}

// ---------------------------------------------------------------------------
// Gerenciar (editar, reabrir, excluir, prints, histórico)
// ---------------------------------------------------------------------------

export function ManagePositionButton({ position, today, maxQtyForEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [pending, start] = useTransition();
  const closed = position.status === "closed";

  const [qty, setQty] = useState(String(position.quantity));
  const [buyDate, setBuyDate] = useState(position.buy_date);
  const [buyPrice, setBuyPrice] = useState(priceToInput(position.buy_price));
  const [sellDate, setSellDate] = useState(position.sell_date ?? "");
  const [sellPrice, setSellPrice] = useState(priceToInput(position.sell_price));

  function openDialog() {
    setQty(String(position.quantity));
    setBuyDate(position.buy_date);
    setBuyPrice(priceToInput(position.buy_price));
    setSellDate(position.sell_date ?? "");
    setSellPrice(priceToInput(position.sell_price));
    setFeedback(null);
    setOpen(true);
  }

  function run(fn: () => Promise<{ ok: true; message?: string; warnings?: string[] } | { ok: false; error: string }>, closeOnOk = false) {
    setFeedback(null);
    start(async () => {
      const res = await fn();
      if (!res.ok) return setFeedback({ kind: "error", text: res.error });
      if (closeOnOk && !res.warnings?.length) return setOpen(false);
      setFeedback({ kind: "success", text: res.message ?? "Feito.", extra: res.warnings });
    });
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const q = Number(qty);
    if (!Number.isInteger(q) || q < 1 || q > maxQtyForEdit)
      return setFeedback({ kind: "error", text: `Quantidade deve ser entre 1 e ${maxQtyForEdit}.` });
    run(
      () =>
        updatePosition({
          id: position.id,
          quantity: q,
          buyDate,
          buyPrice: parseDecimal(buyPrice),
          sellDate: closed ? sellDate : null,
          sellPrice: closed ? parseDecimal(sellPrice) : null,
        }),
      true,
    );
  }

  return (
    <>
      <button type="button" className="btn-secondary btn-xs" onClick={openDialog} title="Editar, reabrir, excluir…">
        Gerenciar
      </button>
      <Modal open={open} onClose={() => !pending && setOpen(false)} title={`Gerenciar · ${position.ticker}`}>
        <div className="space-y-5">
          <form onSubmit={save} className="space-y-3">
            <h3 className="text-sm font-semibold">Editar valores</h3>
            <fieldset disabled={pending} className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Quantidade (máx. {maxQtyForEdit})</label>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={maxQtyForEdit}
                  value={qty}
                  onChange={(e) => setQty(e.target.value)}
                />
              </div>
              <div>
                <label className="label">Preço de compra (R$)</label>
                <input className="input" inputMode="decimal" value={buyPrice} onChange={(e) => setBuyPrice(e.target.value)} />
              </div>
              <div>
                <label className="label">Data da compra</label>
                <input className="input" type="date" max={today} value={buyDate} onChange={(e) => setBuyDate(e.target.value)} />
              </div>
              {closed ? (
                <>
                  <div>
                    <label className="label">Data da venda</label>
                    <input
                      className="input"
                      type="date"
                      min={buyDate}
                      max={today}
                      value={sellDate}
                      onChange={(e) => setSellDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="label">Preço de venda (R$)</label>
                    <input
                      className="input"
                      inputMode="decimal"
                      value={sellPrice}
                      onChange={(e) => setSellPrice(e.target.value)}
                    />
                  </div>
                </>
              ) : null}
            </fieldset>
            <div className="flex justify-end">
              <button type="submit" className="btn-primary" disabled={pending}>
                Salvar alterações
              </button>
            </div>
          </form>

          <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">Prints e cotações</h3>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-secondary btn-xs"
                disabled={pending}
                onClick={() => run(() => retakeScreenshot(position.id, "buy"))}
              >
                {position.buy_screenshot_path ? "Refazer print da compra" : "Tirar print novamente (compra)"}
              </button>
              {closed ? (
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  disabled={pending}
                  onClick={() => run(() => retakeScreenshot(position.id, "sell"))}
                >
                  {position.sell_screenshot_path ? "Refazer print da venda" : "Tirar print novamente (venda)"}
                </button>
              ) : null}
              <button
                type="button"
                className="btn-secondary btn-xs"
                disabled={pending}
                onClick={() => run(() => reimportHistory(position.ticker))}
              >
                Reimportar histórico
              </button>
            </div>
            <p className="text-xs text-zinc-500">O print registra a página do Fundamentus no momento do clique.</p>
          </div>

          <div className="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h3 className="text-sm font-semibold">Status</h3>
            <div className="flex flex-wrap gap-2">
              {closed ? (
                <button
                  type="button"
                  className="btn-secondary btn-xs"
                  disabled={pending}
                  onClick={() => {
                    if (window.confirm(`Reabrir ${position.ticker}? A venda e o crédito no caixa serão desfeitos.`))
                      run(() => reopenPosition(position.id), true);
                  }}
                >
                  Reabrir posição
                </button>
              ) : null}
              <button
                type="button"
                className="btn-danger btn-xs"
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      `Excluir a posição de ${position.ticker}? Os lançamentos de caixa dela e os prints também serão apagados.`,
                    )
                  )
                    run(() => deletePosition(position.id), true);
                }}
              >
                Excluir posição
              </button>
            </div>
          </div>

          {pending ? <p className="text-xs text-zinc-500">Processando…</p> : null}
          <FeedbackBox feedback={feedback} />
        </div>
      </Modal>
    </>
  );
}
