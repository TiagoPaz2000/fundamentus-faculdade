// Horário do pregão da B3 (America/Sao_Paulo). Serve só para a interface: o rótulo
// "pregão aberto/fechado" e para dizer se o preço da compra é a cotação atual ou o
// último fechamento. A compra é aceita a qualquer hora; fora do pregão a cotação
// raspada já é a do último fechamento.
//
// Padrão: segunda a sexta, 10:00–17:00. A B3 ajusta o horário em alguns períodos
// (ex.: horário de verão nos EUA), então dá para sobrescrever com as envs
// MARKET_OPEN / MARKET_CLOSE no formato HH:MM. Feriados da B3 não são considerados.

const DEFAULT_OPEN = "10:00";
const DEFAULT_CLOSE = "17:00";

function toMinutes(hhmm: string | undefined, fallback: string): number {
  const m = (hhmm ?? "").match(/^(\d{1,2}):(\d{2})$/) ?? fallback.match(/^(\d{1,2}):(\d{2})$/)!;
  return Number(m[1]) * 60 + Number(m[2]);
}

function spParts(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { weekday: get("weekday"), minutes: (Number(get("hour")) % 24) * 60 + Number(get("minute")) };
}

export type MarketStatus = {
  open: boolean;
  /** Texto curto para a interface. */
  label: string;
};

export function marketStatus(now: Date = new Date()): MarketStatus {
  const openTime = process.env.MARKET_OPEN ?? DEFAULT_OPEN;
  const closeTime = process.env.MARKET_CLOSE ?? DEFAULT_CLOSE;
  const { weekday, minutes } = spParts(now);
  const open =
    !["Sat", "Sun"].includes(weekday) &&
    minutes >= toMinutes(openTime, DEFAULT_OPEN) &&
    minutes < toMinutes(closeTime, DEFAULT_CLOSE);
  const label = open
    ? `Pregão aberto (até ${closeTime})`
    : `Pregão fechado (segunda a sexta, das ${openTime} às ${closeTime}, Brasília)`;
  return { open, label };
}

/**
 * Qual preço a compra usa: "cotação atual" dentro do pregão (com cotação de hoje);
 * fora dele, ou se a cotação ainda é de um dia anterior (feriado, atraso da fonte),
 * "fechamento de dd/mm" com a data da cotação.
 */
export function priceBasisLabel(quoteDate: string, today: string, marketOpen: boolean): string {
  if (marketOpen && quoteDate === today) return "cotação atual";
  const m = quoteDate.match(/^\d{4}-(\d{2})-(\d{2})/);
  return `fechamento de ${m ? `${m[2]}/${m[1]}` : quoteDate}`;
}
