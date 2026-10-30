import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { addDays } from "@/lib/dates";
import { errorMessage, friendlyDbError } from "@/lib/errors";
import { captureFundamentusScreenshot, importInfomoneyHistory, refreshCurrentQuotes } from "@/lib/quotes";

export const HISTORY_DAYS_BEFORE_BUY = 180;

/**
 * Passos depois de inserir uma compra: (b) print do Fundamentus, (c) histórico do
 * InfoMoney e (d) cotação atual das duas fontes. Nunca lança: devolve avisos.
 * `client` precisa poder atualizar positions: o RLS só libera UPDATE para admin,
 * então compras de membros (e ordens agendadas) passam o client de service role.
 */
export async function runBuyFollowups(
  client: SupabaseClient<Database>,
  ticker: string,
  positionId: string,
  buyDate: string,
): Promise<string[]> {
  const warnings: string[] = [];
  const [shot, quotes] = await Promise.allSettled([
    (async () => {
      const path = await captureFundamentusScreenshot(ticker, positionId, "buy");
      const { error } = await client.from("positions").update({ buy_screenshot_path: path }).eq("id", positionId);
      if (error) throw new Error(friendlyDbError(error));
    })(),
    (async () => {
      // histórico primeiro, cotação atual depois (para não sobrescrever a variação do dia)
      let historyError: string | null = null;
      try {
        await importInfomoneyHistory(ticker, addDays(buyDate, -HISTORY_DAYS_BEFORE_BUY));
      } catch (e) {
        historyError = errorMessage(e);
      }
      const current = await refreshCurrentQuotes(ticker);
      return { historyError, currentErrors: current.errors };
    })(),
  ]);

  if (shot.status === "rejected") {
    console.error(`[compra ${ticker}] print falhou:`, shot.reason);
    warnings.push(`Não foi possível tirar o print (${errorMessage(shot.reason)}). Use "Tirar print novamente".`);
  }
  if (quotes.status === "rejected") {
    console.error(`[compra ${ticker}] cotações falharam:`, quotes.reason);
    warnings.push(`Falha ao gravar cotações (${errorMessage(quotes.reason)}). Use "Reimportar histórico".`);
  } else {
    if (quotes.value.historyError) {
      console.error(`[compra ${ticker}] histórico falhou:`, quotes.value.historyError);
      warnings.push(`Histórico do InfoMoney não importado (${quotes.value.historyError}). Use "Reimportar histórico".`);
    }
    if (quotes.value.currentErrors.length) {
      console.error(`[compra ${ticker}] cotação atual:`, quotes.value.currentErrors);
      warnings.push(`Cotação atual parcial: ${quotes.value.currentErrors.join("; ")}`);
    }
  }
  return warnings;
}
