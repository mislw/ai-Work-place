const COOKIE_NAME = "dsh_embed";

export function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex < 0) continue;
    const name = part.slice(0, separatorIndex).trim();
    if (name !== COOKIE_NAME) continue;
    const value = part.slice(separatorIndex + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}

export function createSessionCookie(token: string): string {
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=600; HttpOnly; Secure; SameSite=Lax; Path=/`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/`;
}
