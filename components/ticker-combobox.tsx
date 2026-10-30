"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

export type TickerOption = { ticker: string; name: string };

const TICKER_RE = /^[A-Z0-9]{4,12}$/;
const MAX_RESULTS = 40;

// Lista compartilhada entre instâncias (carregada uma vez por sessão da página).
let cache: Promise<TickerOption[]> | null = null;
function loadTickers(): Promise<TickerOption[]> {
  cache ??= fetch("/api/tickers")
    .then((r) => r.json())
    .then((j: { tickers?: TickerOption[] }) => j.tickers ?? [])
    .catch(() => {
      cache = null;
      return [];
    });
  return cache;
}

function normalize(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/**
 * Campo para escrever e escolher o papel numa lista (Fundamentus).
 * `value` é o ticker escolhido ("" = nenhum).
 */
export function TickerCombobox({
  value,
  onChange,
  disabledTickers = [],
  disabled = false,
  autoFocus = false,
}: {
  value: string;
  onChange: (ticker: string) => void;
  /** Papéis que não podem ser escolhidos (já na carteira/agendados). */
  disabledTickers?: string[];
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<TickerOption[] | null>(null);
  const [active, setActive] = useState(0);

  // Mantém o texto em sincronia quando o valor é limpo de fora (ex.: após comprar).
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setQuery(value);
  }

  useEffect(() => {
    let alive = true;
    loadTickers().then((list) => {
      if (alive) setOptions(list);
    });
    return () => {
      alive = false;
    };
  }, []);

  const q = normalize(query.trim());
  const results = useMemo(() => {
    if (!options) return [];
    if (!q) return options.slice(0, MAX_RESULTS);
    // Ordem: ticker começa com · nome começa com · palavra do nome começa com · contém
    const buckets: TickerOption[][] = [[], [], [], []];
    for (const o of options) {
      const name = normalize(o.name);
      if (o.ticker.startsWith(q)) buckets[0].push(o);
      else if (name.startsWith(q)) buckets[1].push(o);
      else if (name.split(/[\s./-]+/).some((w) => w.startsWith(q))) buckets[2].push(o);
      else if (o.ticker.includes(q) || name.includes(q)) buckets[3].push(o);
    }
    return buckets.flat().slice(0, MAX_RESULTS);
  }, [options, q]);

  const exactInList = results.some((o) => o.ticker === q);
  const canUseTyped = TICKER_RE.test(q) && !exactInList;
  const blocked = new Set(disabledTickers);

  function choose(ticker: string) {
    if (blocked.has(ticker)) return;
    setQuery(ticker);
    setOpen(false);
    onChange(ticker);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(a + 1, Math.max(0, results.length - 1)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = results[active]?.ticker ?? (canUseTyped ? q : null);
      if (pick) choose(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        className="input scroll-mt-20 pr-10 uppercase"
        placeholder="Digite o papel ou a empresa (ex.: PETR4, Itaú)"
        value={query}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        enterKeyHint="search"
        onFocus={() => {
          setOpen(true);
          // No celular, sobe o campo para a lista caber acima do teclado.
          if (window.matchMedia("(max-width: 767px)").matches) {
            setTimeout(() => inputRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }), 250);
          }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
          if (value) onChange(""); // texto mudou: desfaz a escolha anterior
        }}
        onKeyDown={onKeyDown}
      />
      {value ? (
        <button
          type="button"
          aria-label="Limpar papel"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-zinc-400 hover:text-zinc-700"
          onClick={() => {
            setQuery("");
            onChange("");
            inputRef.current?.focus();
          }}
        >
          ✕
        </button>
      ) : null}

      {open && !disabled ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto overscroll-contain rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options === null ? (
            <li className="px-3 py-3 text-sm text-zinc-500">Carregando papéis…</li>
          ) : null}
          {options !== null && results.length === 0 && !canUseTyped ? (
            <li className="px-3 py-3 text-sm text-zinc-500">Nenhum papel encontrado.</li>
          ) : null}
          {results.map((o, i) => {
            const isBlocked = blocked.has(o.ticker);
            return (
              <li
                key={o.ticker}
                role="option"
                aria-selected={i === active}
                aria-disabled={isBlocked}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.ticker)}
                className={`flex min-h-12 cursor-pointer items-center justify-between gap-3 px-3 py-2 ${
                  isBlocked ? "cursor-not-allowed opacity-40" : i === active ? "bg-emerald-50 dark:bg-emerald-950/40" : ""
                }`}
              >
                <span className="font-semibold tabular-nums">{o.ticker}</span>
                <span className="truncate text-right text-sm text-zinc-500">
                  {isBlocked ? "já na carteira" : o.name}
                </span>
              </li>
            );
          })}
          {canUseTyped ? (
            <li
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(q)}
              className="flex min-h-12 cursor-pointer items-center px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300"
            >
              Usar “{q}”
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
