// Formatação pt-BR (sem dependências de servidor: usado também em Client Components).

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const num2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

export function formatBRL(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : brl.format(value);
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return digits === 2
    ? num2.format(value)
    : new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
}

export function formatInt(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "—" : int.format(value);
}

/** Recebe o percentual já em "pontos" (ex: -1.23 => "-1,23%"). */
export function formatPct(value: number | null | undefined, withSign = true): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = withSign && value > 0 ? "+" : "";
  return `${sign}${num2.format(value)}%`;
}

/** "2026-10-29" (ou timestamp ISO) -> "29/10/2026" */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return value;
  if (value.length > 10) {
    // timestamp: converte para o fuso de Brasília
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(d);
    }
  }
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(d);
}

/** Classe Tailwind de cor para valores positivos/negativos. */
export function signClass(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value) || value === 0) return "text-zinc-500";
  return value > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

/** Converte "1.234,56" ou "1234.56" em número. */
export function parseDecimal(input: string): number {
  const s = input.trim().replace(/\s|R\$/g, "");
  if (s === "") return Number.NaN;
  const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return Number(normalized);
}
