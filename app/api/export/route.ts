import ExcelJS from "exceljs";
import { getCurrentUserOrNull } from "@/lib/auth";
import { todaySP } from "@/lib/dates";
import { loadCashMovements, loadPortfolio } from "@/lib/portfolio";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 30;

const SEVEN_DAYS = 7 * 24 * 60 * 60;
const BRL = '"R$" #,##0.00;[Red]-"R$" #,##0.00';
const PCT = "0.00%;[Red]-0.00%";
const DATE = "dd/mm/yyyy";
const DATETIME = "dd/mm/yyyy hh:mm";

/** "2026-10-29" -> Date em UTC (o Excel guarda só o dia). */
function excelDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Timestamp -> Date "de parede" em Brasília (o Excel não tem fuso). */
function excelDateTimeSP(ts: string): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute")));
}

function link(url: string | null, text: string): ExcelJS.CellValue {
  return url ? { text, hyperlink: url } : null;
}

export async function GET() {
  const user = await getCurrentUserOrNull().catch(() => null);
  if (!user) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }

  const supabase = await createClient();
  let portfolio: Awaited<ReturnType<typeof loadPortfolio>>;
  let movements: Awaited<ReturnType<typeof loadCashMovements>>;
  try {
    [portfolio, movements] = await Promise.all([
      loadPortfolio(supabase, { signedUrlSeconds: SEVEN_DAYS }),
      loadCashMovements(supabase),
    ]);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Carteira da Turma";
  wb.created = new Date();

  // ---------------- Carteira ----------------
  const ws = wb.addWorksheet("Carteira", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Papel", key: "ticker", width: 10 },
    { header: "Quantidade", key: "qty", width: 11 },
    { header: "Data compra", key: "buyDate", width: 12, style: { numFmt: DATE } },
    { header: "Preço compra (unit.)", key: "buyPrice", width: 18, style: { numFmt: BRL } },
    { header: "Valor compra (total)", key: "buyTotal", width: 18, style: { numFmt: BRL } },
    { header: "Cotação atual", key: "current", width: 15, style: { numFmt: BRL } },
    { header: "Data última cotação", key: "currentDate", width: 18, style: { numFmt: DATE } },
    { header: "Fonte cotação", key: "source", width: 13 },
    { header: "Variação do dia %", key: "dayPct", width: 16, style: { numFmt: PCT } },
    { header: "Variação desde a compra %", key: "varPct", width: 22, style: { numFmt: PCT } },
    { header: "Variação desde a compra R$", key: "varBRL", width: 23, style: { numFmt: BRL } },
    { header: "Status", key: "status", width: 10 },
    { header: "Preço venda", key: "sellPrice", width: 14, style: { numFmt: BRL } },
    { header: "Data venda", key: "sellDate", width: 12, style: { numFmt: DATE } },
    { header: "Print compra", key: "buyShot", width: 14 },
    { header: "Print venda", key: "sellShot", width: 14 },
  ];

  for (const p of portfolio.positions) {
    ws.addRow({
      ticker: p.ticker,
      qty: p.quantity,
      buyDate: excelDate(p.buy_date),
      buyPrice: p.buy_price,
      buyTotal: p.buyTotal,
      current: p.current?.price ?? null,
      currentDate: excelDate(p.current?.date),
      source: p.current?.source ?? null,
      dayPct: p.current?.changePct === null || p.current?.changePct === undefined ? null : p.current.changePct / 100,
      varPct: p.varPct === null ? null : p.varPct / 100,
      varBRL: p.varBRL,
      status: p.status === "open" ? "Aberta" : "Fechada",
      sellPrice: p.sell_price,
      sellDate: excelDate(p.sell_date),
      buyShot: link(p.buyScreenshotUrl, "abrir print"),
      sellShot: link(p.sellScreenshotUrl, "abrir print"),
    });
  }

  const s = portfolio.summary;
  ws.addRow({});
  const summaryRows: [string, number, string][] = [
    ["Saldo em caixa", s.cashBalance, BRL],
    ["Valor investido (abertas)", s.investedOpen, BRL],
    ["Valor de mercado (abertas)", s.marketValueOpen, BRL],
    ["Resultado total", s.totalResult, BRL],
    ["Ações abertas", s.openShares, `0"/${s.limit}"`],
  ];
  for (const [label, value, fmt] of summaryRows) {
    const row = ws.addRow({ ticker: label });
    ws.mergeCells(row.number, 1, row.number, 4);
    const cell = row.getCell(5);
    cell.value = value;
    cell.numFmt = fmt;
    row.font = { bold: true };
  }

  styleHeader(ws);
  for (const key of ["buyShot", "sellShot"]) {
    ws.getColumn(key).eachCell((cell, rowNumber) => {
      if (rowNumber > 1 && cell.value && typeof cell.value === "object") {
        cell.font = { color: { argb: "FF0563C1" }, underline: true };
      }
    });
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };

  // ---------------- Caixa ----------------
  const cash = wb.addWorksheet("Caixa", { views: [{ state: "frozen", ySplit: 1 }] });
  const kindLabel = { deposit: "Aporte", withdraw: "Retirada", adjust: "Ajuste", buy: "Compra", sell: "Venda" };
  cash.columns = [
    { header: "Data", key: "date", width: 17, style: { numFmt: DATETIME } },
    { header: "Tipo", key: "kind", width: 11 },
    { header: "Papel", key: "ticker", width: 10 },
    { header: "Descrição", key: "note", width: 36 },
    { header: "Valor", key: "amount", width: 16, style: { numFmt: BRL } },
    { header: "Saldo", key: "balance", width: 16, style: { numFmt: BRL } },
  ];
  for (const m of movements) {
    cash.addRow({
      date: excelDateTimeSP(m.created_at),
      kind: kindLabel[m.kind],
      ticker: m.ticker,
      note: m.note,
      amount: m.amount,
      balance: m.balanceAfter,
    });
  }
  styleHeader(cash);

  const buffer = await wb.xlsx.writeBuffer();
  const filename = `carteira-${todaySP()}.xlsx`;
  return new Response(new Uint8Array(buffer as ArrayBuffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.height = 30;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } };
  });
}
