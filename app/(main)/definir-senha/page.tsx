import type { Metadata } from "next";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Definir senha" };

export default function DefinirSenhaPage() {
  return (
    <div className="mx-auto max-w-sm">
      <div className="card p-6">
        <h1 className="text-lg font-semibold">Definir senha</h1>
        <p className="mb-4 mt-1 text-sm text-zinc-500">
          Escolha a senha que você vai usar para entrar com o seu e-mail.
        </p>
        <PasswordForm />
      </div>
    </div>
  );
}
