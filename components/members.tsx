"use client";

import { useState, useTransition } from "react";
import { addMember, generateAccessLink, removeMember } from "@/app/actions/users";
import { FeedbackBox, type Feedback } from "./modal";

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          readOnly
          value={link}
          className="input font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Link de acesso"
        />
        <button
          type="button"
          className="btn-primary shrink-0"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? "Copiado!" : "Copiar"}
        </button>
      </div>
      <a
        className="btn-secondary btn-xs"
        href={`https://wa.me/?text=${encodeURIComponent(`Seu acesso à Carteira da Turma: ${link}`)}`}
        target="_blank"
        rel="noopener noreferrer"
      >
        Enviar pelo WhatsApp
      </a>
      <p className="text-xs text-zinc-500">
        O link é pessoal e expira (padrão do Supabase: 1 hora). Se expirar, gere outro em “Gerar link”.
      </p>
    </div>
  );
}

export function AddMemberForm() {
  const [email, setEmail] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setLink(null);
    start(async () => {
      const res = await addMember(email);
      if (!res.ok) return setFeedback({ kind: "error", text: res.error });
      setFeedback({ kind: "success", text: res.message ?? "Membro adicionado." });
      setLink(res.data?.inviteLink ?? null);
      setEmail("");
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 p-4">
      <h2 className="font-semibold">Adicionar membro</h2>
      <p className="text-xs text-zinc-500">
        Se o e-mail já tem conta (inclusive do outro app que usa o mesmo Supabase), a pessoa entra com a senha que já
        tem. Se não tem, é gerado um link de convite para você enviar: nenhum e-mail é enviado automaticamente.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="email"
          required
          className="input"
          placeholder="email@exemplo.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
          autoComplete="off"
        />
        <button type="submit" className="btn-primary shrink-0" disabled={pending}>
          {pending ? "Adicionando…" : "Adicionar"}
        </button>
      </div>
      <FeedbackBox feedback={feedback} />
      {link ? <CopyLink link={link} /> : null}
    </form>
  );
}

export function MemberActions({
  userId,
  email,
  isSelf,
  pendingInvite,
}: {
  userId: string;
  email: string;
  isSelf: boolean;
  pendingInvite: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  if (isSelf) return null;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-1.5">
        <button
          type="button"
          className="btn-secondary btn-xs"
          disabled={pending}
          title={pendingInvite ? "Novo link de convite" : "Link para definir uma nova senha (vale também no outro app)"}
          onClick={() =>
            start(async () => {
              setError(null);
              const res = await generateAccessLink(userId);
              if (!res.ok) return setError(res.error);
              setLink(res.data?.link ?? null);
            })
          }
        >
          {pendingInvite ? "Gerar link de convite" : "Gerar link de senha"}
        </button>
        <button
          type="button"
          className="btn-secondary btn-xs text-red-600"
          disabled={pending}
          onClick={() => {
            if (!window.confirm(`Remover ${email} da carteira? A conta dele continua existindo, só perde o acesso.`)) return;
            start(async () => {
              setError(null);
              const res = await removeMember(userId);
              if (!res.ok) setError(res.error);
            });
          }}
        >
          Remover
        </button>
      </div>
      {error ? <span className="text-xs text-red-600">{error}</span> : null}
      {link ? (
        <div className="w-full max-w-md text-left">
          <CopyLink link={link} />
        </div>
      ) : null}
    </div>
  );
}
