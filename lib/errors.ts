// Traduz erros do Postgres/PostgREST em mensagens amigáveis.

type DbError = { code?: string; message?: string; details?: string | null } | null | undefined;

/** Regra da carteira: até 10 papéis, cada um comprado com exatamente 100 ações. */
export const MAX_TICKERS = 10;
export const SHARES_PER_TICKER = 100;
/** Cada membro pode ter no máximo 2 papéis abertos ou agendados (0005). Vender libera a vaga. */
export const MAX_PER_USER = 2;
export const USER_LIMIT_MESSAGE = `Você já tem ${MAX_PER_USER} papéis abertos ou agendados. Venda um para liberar a vaga.`;

export function friendlyDbError(error: DbError | Error): string {
  if (!error) return "Erro desconhecido.";
  const message = error.message ?? "";
  const code = "code" in error ? error.code : undefined;

  let m = message.match(/Regra da carteira: ([A-Z0-9]+) já tem uma posição aberta/);
  if (m) return `${m[1]} já está na carteira (posição aberta). Cada papel entra uma vez, com ${SHARES_PER_TICKER} ações.`;
  m = message.match(/Regra da carteira: já existem ([0-9]+) papéis abertos/);
  if (m) return `A carteira já tem ${m[1]} papéis abertos (máximo ${MAX_TICKERS}). Feche uma posição antes de comprar outro papel.`;
  if (/Regra da carteira: cada usuário pode ter no máximo/.test(message)) return USER_LIMIT_MESSAGE;
  if (/Regra da carteira: cada papel/.test(message)) return `Cada compra é de exatamente ${SHARES_PER_TICKER} ações.`;
  if (/Limite da carteira/i.test(message)) {
    // trigger antigo da 0001 (limite de 100 ações no total): falta rodar a 0003
    return "O banco ainda usa o limite antigo de 100 ações no total. Rode supabase/migrations/0003_ten_tickers.sql.";
  }
  if (code === "42501" || /row-level security/i.test(message)) {
    return "Você não tem permissão para essa operação.";
  }
  if (code === "23514") {
    if (/último admin/i.test(message)) return "Não é possível remover o último admin.";
    if (/quantity/i.test(message)) return `Cada compra é de exatamente ${SHARES_PER_TICKER} ações.`;
    if (/buy_price|sell_price/i.test(message)) return "O preço deve ser maior que zero.";
    if (/ticker/i.test(message)) return "O ticker deve estar em maiúsculas.";
    return "Os dados violam uma regra do banco. Confira os valores informados.";
  }
  if (code === "23505") return "Registro duplicado.";
  if (code === "PGRST116") return "Registro não encontrado.";
  return message || "Erro ao acessar o banco de dados.";
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "object" && err && "message" in err) return String((err as { message: unknown }).message);
  return String(err);
}
