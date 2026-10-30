"use client";

import { useState, useTransition } from "react";
import { reimportHistory } from "@/app/actions/positions";
import { FeedbackBox, type Feedback } from "./modal";

export function ReimportButton({ ticker }: { ticker: string }) {
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<Feedback>(null);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setFeedback(null);
            const res = await reimportHistory(ticker);
            setFeedback(
              res.ok
                ? { kind: "success", text: res.message ?? "Histórico importado.", extra: res.warnings }
                : { kind: "error", text: res.error },
            );
          })
        }
      >
        {pending ? "Importando…" : "Reimportar histórico"}
      </button>
      <FeedbackBox feedback={feedback} />
    </div>
  );
}
