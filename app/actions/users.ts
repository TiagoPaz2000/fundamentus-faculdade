"use server";

import { refresh } from "next/cache";
import { fail, type ActionResult } from "@/lib/action-result";
import { AuthError, requireAdmin } from "@/lib/auth";
import { errorMessage, friendlyDbError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

export async function setAdmin(userId: string, makeAdmin: boolean): Promise<ActionResult> {
  try {
    const me = await requireAdmin();
    if (typeof userId !== "string" || !/^[0-9a-f-]{36}$/i.test(userId)) return fail("Usuário inválido.");
    if (typeof makeAdmin !== "boolean") return fail("Operação inválida.");

    const supabase = await createClient();
    const { data: target, error: getErr } = await supabase
      .from("profiles")
      .select("id, email, is_admin")
      .eq("id", userId)
      .single();
    if (getErr || !target) return fail(friendlyDbError(getErr));
    if (target.is_admin === makeAdmin) {
      return { ok: true, message: "Nada a alterar." };
    }

    if (!makeAdmin) {
      const { count, error: countErr } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("is_admin", true);
      if (countErr) return fail(friendlyDbError(countErr));
      if ((count ?? 0) <= 1) return fail("Não é possível remover o último administrador.");
    }

    const { data: updated, error } = await supabase
      .from("profiles")
      .update({ is_admin: makeAdmin })
      .eq("id", userId)
      .select("id");
    if (error) return fail(friendlyDbError(error));
    if (!updated?.length) return fail("Sem permissão para alterar este usuário.");

    refresh();
    const self = userId === me.id;
    return {
      ok: true,
      message: makeAdmin
        ? `${target.email} agora é administrador.`
        : self
          ? "Você deixou de ser administrador."
          : `${target.email} deixou de ser administrador.`,
    };
  } catch (err) {
    if (err instanceof AuthError) return fail(err.message);
    console.error(err);
    return fail(errorMessage(err));
  }
}
