export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string; warnings?: string[] }
  | { ok: false; error: string };

export function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}
