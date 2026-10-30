"use client";

import Link from "next/link";
import { useActionState } from "react";
import { setPassword, type PasswordState } from "@/app/actions/auth";
import { Alert } from "@/components/modal";

export function PasswordForm() {
  const [state, action, pending] = useActionState<PasswordState, FormData>(setPassword, {});

  if (state.ok) {
    return (
      <div className="space-y-4">
        <Alert kind="success">Senha definida com sucesso.</Alert>
        <Link href="/" className="btn-primary w-full">
          Ir para a carteira
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      {state.error ? <Alert kind="error">{state.error}</Alert> : null}
      <div>
        <label className="label" htmlFor="password">
          Nova senha
        </label>
        <input id="password" name="password" type="password" minLength={8} required className="input" autoComplete="new-password" />
      </div>
      <div>
        <label className="label" htmlFor="confirm">
          Confirme a senha
        </label>
        <input id="confirm" name="confirm" type="password" minLength={8} required className="input" autoComplete="new-password" />
      </div>
      <button type="submit" disabled={pending} className="btn-primary w-full">
        {pending ? "Salvando…" : "Salvar senha"}
      </button>
    </form>
  );
}
