export async function clearHarnessSession(): Promise<void> {
  try {
    const origin = process.env.NEXT_PUBLIC_HARNESS_ORIGIN;
    if (!origin) return;
    await fetch(`${new URL(origin).origin}/auth/logout`, {
      method: "POST",
      credentials: "include",
      mode: "cors",
    });
  } catch {
    // Harness logout is best-effort; Supabase logout remains authoritative.
  }
}
