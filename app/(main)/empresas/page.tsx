import type { Metadata } from "next";
import { Suspense } from "react";
import { CompaniesTable } from "@/components/companies-table";
import { ErrorBlock, LoadingBlock } from "@/components/page-states";
import { requireUser } from "@/lib/auth";
import { getCompanyNames, loadMonthPerformance, loadSectors, type CompanyName } from "@/lib/companies";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Empresas" };

export default function EmpresasPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Empresas</h1>
        <p className="text-sm text-zinc-500">
          Todos os papéis listados no Fundamentus, com setor e desempenho no mês.
        </p>
      </div>
      <Suspense fallback={<LoadingBlock label="Carregando empresas…" />}>
        <EmpresasContent />
      </Suspense>
    </div>
  );
}

async function EmpresasContent() {
  await requireUser();
  const supabase = await createClient();

  let names: CompanyName[];
  try {
    names = await getCompanyNames();
  } catch (err) {
    return <ErrorBlock error={err} />;
  }
  // Não esperamos: setores e Mês % chegam depois (streaming); a tabela aparece antes.
  // Começam depois de getCompanyNames() para reaproveitar o cache dela.
  const sectors = loadSectors();
  const performance = loadMonthPerformance();

  const { data, error } = await supabase.from("positions").select("ticker").eq("status", "open");
  if (error) console.error("positions (carteira):", error.message);
  const held = [...new Set((data ?? []).map((p) => p.ticker.toUpperCase()))];

  return <CompaniesTable companies={names} held={held} sectors={sectors} performance={performance} />;
}
