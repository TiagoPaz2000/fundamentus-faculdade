// Traduz erros do Postgres/PostgREST em mensagens amigáveis.

type DbError = { code?: string; message?: string; details?: string | null } | null | undefined;

export const PORTFOLIO_LIMIT = 100;

export function friendlyDbError(error: DbError | Error): string {
  if (!error) return "Erro desconhecido.";
  const message = error.message ?? "";
  const code = "code" in error ? error.code : undefined;

  const limit = message.match(/Limite da carteira: (\d+) ações abertas \+ (\d+) excede 100 \(disponível: (-?\d+)\)/);
  if (limit) {
    const available = Math.max(0, Number(limit[3]));
    return available === 0
      ? `A carteira já tem ${limit[1]} ações abertas (limite de ${PORTFOLIO_LIMIT}). Feche alguma posição antes de comprar.`
      : `Limite de ${PORTFOLIO_LIMIT} ações abertas: a carteira já tem ${limit[1]}, então você pode comprar no máximo ${available}.`;
  }
  if (/Limite da carteira/i.test(message)) {
    return `Essa operação ultrapassa o limite de ${PORTFOLIO_LIMIT} ações abertas na carteira.`;
  }
  if (code === "42501" || /row-level security/i.test(message)) {
    return "Você não tem permissão para essa operação (apenas administradores).";
  }
  if (code === "23514") {
    if (/último admin/i.test(message)) return "Não é possível remover o último admin.";
    if (/quantity/i.test(message)) return "A quantidade deve ser entre 1 e 100.";
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
