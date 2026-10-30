// Horário do pregão da B3 (America/Sao_Paulo). Compras só são aceitas dentro dele;
// fora dele o admin agenda uma ordem com preço-limite.
//
// Padrão: segunda a sexta, 10:00–17:00. A B3 ajusta o horário em alguns períodos
// (ex.: horário de verão nos EUA), então dá para sobrescrever com as envs
// MARKET_OPEN / MARKET_CLOSE no formato HH:MM. Feriados da B3 não são considerados
// aqui; a execução de ordens agendadas exige uma cotação com a data de hoje.

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
  openTime: string;
  closeTime: string;
  /** Texto curto para a interface. */
  label: string;
};

export function marketStatus(now: Date = new Date()): MarketStatus {
  const openTime = process.env.MARKET_OPEN ?? DEFAULT_OPEN;
  const closeTime = process.env.MARKET_CLOSE ?? DEFAULT_CLOSE;
  const openMin = toMinutes(openTime, DEFAULT_OPEN);
  const closeMin = toMinutes(closeTime, DEFAULT_CLOSE);
  const { weekday, minutes } = spParts(now);
  const weekdayOk = !["Sat", "Sun"].includes(weekday);
  const open = weekdayOk && minutes >= openMin && minutes < closeMin;
  const label = open
    ? `Pregão aberto (até ${closeTime})`
    : `Pregão fechado: compras só de segunda a sexta, das ${openTime} às ${closeTime} (Brasília)`;
  return { open, openTime, closeTime, label };
}
