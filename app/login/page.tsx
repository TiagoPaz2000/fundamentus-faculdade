import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-lg font-semibold text-white">
            C
          </div>
          <h1 className="text-xl font-semibold">Carteira da Turma</h1>
          <p className="mt-1 text-sm text-zinc-500">Acesso somente para convidados.</p>
        </div>
        <Suspense fallback={<div className="h-48" />}>
          <LoginForm />
        </Suspense>
        <p className="mt-6 text-center text-xs text-zinc-500">
          Não tem acesso? Peça um convite a um administrador.
        </p>
      </div>
    </main>
  );
}
