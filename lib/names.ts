/** Nome de exibição: parte do email antes do @ (joao@teste.com → joao). */
export function displayName(email: string | null | undefined, name?: string | null): string {
  if (name) return name;
  if (!email) return "ex-membro";
  return email.split("@")[0] || email;
}
