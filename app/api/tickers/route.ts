import type { NextRequest } from "next/server";
import { getCurrentUserOrNull } from "@/lib/auth";
import { errorMessage } from "@/lib/errors";
import { getTickerList } from "@/lib/ticker-list";

/** Lista de papéis para o campo de busca da compra (só para usuários logados). */
export async function GET(request: NextRequest) {
  // Lê o request antes de tudo: a rota nunca é pré-renderizada no build.
  void request.headers.get("cookie");
  const user = await getCurrentUserOrNull().catch(() => null);
  if (!user) return Response.json({ error: "Não autenticado" }, { status: 401 });
  if (!user.isMember) return Response.json({ error: "Sem acesso à carteira" }, { status: 403 });

  try {
    const tickers = await getTickerList();
    return Response.json(
      { tickers },
      { headers: { "Cache-Control": "private, max-age=3600" } },
    );
  } catch (err) {
    return Response.json({ error: errorMessage(err), tickers: [] }, { status: 502 });
  }
}
