import type { NextRequest } from "next/server";
import { checkCronAuth } from "@/lib/cron-auth";
import { errorMessage } from "@/lib/errors";
import { executeDueOrders } from "@/lib/scheduled-orders";

// Cada compra executada tira um print (Chromium).
export const maxDuration = 300;

/** Executa as compras agendadas cujo preço foi atingido (só no horário do pregão). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization") ?? "";
  const denied = checkCronAuth(authHeader);
  if (denied) return denied;

  try {
    const run = await executeDueOrders();
    console.log("[cron/orders]", JSON.stringify(run));
    return Response.json({ ok: true, ...run });
  } catch (err) {
    console.error("[cron/orders]", err);
    return Response.json({ ok: false, error: errorMessage(err) }, { status: 500 });
  }
}
