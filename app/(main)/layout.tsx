import { Suspense } from "react";
import { Header, HeaderShell } from "@/components/header";

export default function MainLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<HeaderShell />}>
        <Header />
      </Suspense>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">{children}</main>
      <footer className="border-t border-zinc-200 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800">
        Cotações: Fundamentus e InfoMoney. Dados com atraso; uso acadêmico.
      </footer>
    </>
  );
}
