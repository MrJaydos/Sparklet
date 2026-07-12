/** Public-facing name for a user: displayName if set, else email prefix. */
export function displayName(user: { name?: string | null; email: string }) {
  return user.name?.trim() || user.email.split("@")[0];
}
