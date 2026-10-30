"use client";

import { useState, useTransition } from "react";
import { setAdmin } from "@/app/actions/users";

export function AdminToggle({
  userId,
  email,
  isAdmin,
  isSelf,
  isLastAdmin,
}: {
  userId: string;
  email: string;
  isAdmin: boolean;
  isSelf: boolean;
  isLastAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle() {
    const makeAdmin = !isAdmin;
    if (!makeAdmin) {
      const text = isSelf
        ? "Atenção: você vai remover o SEU próprio acesso de administrador e não poderá desfazer isso sozinho. Continuar?"
        : `Remover ${email} dos administradores?`;
      if (!window.confirm(text)) return;
    } else if (!window.confirm(`Tornar ${email} administrador? Ele poderá comprar, vender, mexer no caixa e gerenciar usuários.`)) {
      return;
    }
    setMsg(null);
    start(async () => {
      const res = await setAdmin(userId, makeAdmin);
      setMsg(res.ok ? { ok: true, text: res.message ?? "Atualizado." } : { ok: false, text: res.error });
    });
  }

  const disabled = pending || (isAdmin && isLastAdmin);

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className={isAdmin ? "btn-secondary btn-xs" : "btn-primary btn-xs"}
        title={isAdmin && isLastAdmin ? "Não é possível remover o último administrador" : undefined}
      >
        {pending ? "Salvando…" : isAdmin ? (isSelf ? "Deixar de ser admin" : "Rebaixar") : "Promover a admin"}
      </button>
      {isAdmin && isLastAdmin ? <span className="text-xs text-zinc-500">último admin</span> : null}
      {msg ? <span className={`text-xs ${msg.ok ? "text-emerald-600" : "text-red-600"}`}>{msg.text}</span> : null}
    </span>
  );
}
