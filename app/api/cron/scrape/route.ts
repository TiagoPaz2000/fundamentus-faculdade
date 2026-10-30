import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { allSettledLimit } from "@/lib/concurrency";
import { errorMessage } from "@/lib/errors";
import { upsertQuotes } from "@/lib/quotes";
import { scrapeFundamentus } from "@/lib/scrapers/fundamentus";
import { scrapeInfomoney } from "@/lib/scrapers/infomoney";
import type { QuoteSource, ScrapedQuote } from "@/lib/scrapers/types";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Hobby com Fluid Compute permite até 300 s.
export const maxDuration = 300;

const CONCURRENCY = 4;

function authorized(header: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

type SourceResult = { ok: true; price: number; quoteDate: string } | { ok: false; error: string };

export async function GET(request: NextRequest) {
  // Lê o request antes de tudo: assim a rota nunca é pré-renderizada no build.
  const authHeader = request.headers.get("authorization") ?? "";
  if (!process.env.CRON_SECRET) {
    return Response.json({ ok: false, error: "CRON_SECRET não configurado" }, { status: 500 });
  }
  if (!authorized(authHeader)) {
    return Response.json({ ok: false, error: "Não autorizado" }, { status: 401 });
  }

  const startedAt = Date.now();
  const admin = createAdminClient();
  const { data: open, error } = await admin.from("positions").select("ticker").eq("status", "open");
  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 });
  }
  const tickers = [...new Set((open ?? []).map((p) => p.ticker))].sort();

  const scrapers: [QuoteSource, (t: string) => Promise<ScrapedQuote>][] = [
    ["fundamentus", scrapeFundamentus],
    ["infomoney", scrapeInfomoney],
  ];
  const jobs = tickers.flatMap((ticker) => scrapers.map(([source, fn]) => ({ ticker, source, fn })));
  const settled = await allSettledLimit(jobs, CONCURRENCY, (job) => job.fn(job.ticker));

  const results: Record<string, Partial<Record<QuoteSource, SourceResult>>> = {};
  const quotes: ScrapedQuote[] = [];
  settled.forEach((r, i) => {
    const { ticker, source } = jobs[i];
    results[ticker] ??= {};
    if (r.status === "fulfilled") {
      quotes.push(r.value);
      results[ticker][source] = { ok: true, price: r.value.price, quoteDate: r.value.quoteDate };
    } else {
      results[ticker][source] = { ok: false, error: errorMessage(r.reason) };
    }
  });

  let saved = 0;
  let saveError: string | null = null;
  try {
    saved = await upsertQuotes(quotes);
  } catch (err) {
    saveError = errorMessage(err);
  }

  const failures = settled.filter((r) => r.status === "rejected").length;
  const body = {
    ok: saveError === null && failures === 0,
    tickers: tickers.length,
    scraped: quotes.length,
    failures,
    saved,
    saveError,
    durationMs: Date.now() - startedAt,
    results,
  };
  console.log("[cron/scrape]", JSON.stringify({ ...body, results: undefined }));
  return Response.json(body, { status: saveError ? 500 : 200 });
}
