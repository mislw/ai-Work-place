export const LOCAL_TOOLBOX_ORIGIN = "http://127.0.0.1:37654";

declare global {
  interface Window {
    __PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__?: string;
  }
}

export function getLocalToolboxOrigin(): string {
  const desktopOrigin =
    typeof window === "undefined"
      ? undefined
      : window.__PERSONAL_AI_WORKSPACE_LOCAL_TOOLBOX_ORIGIN__;

  return typeof desktopOrigin === "string" &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(desktopOrigin)
    ? desktopOrigin
    : LOCAL_TOOLBOX_ORIGIN;
}

export type LocalToolboxHealth = {
  ok: true;
  version: 1;
  winRarAvailable: boolean;
  sevenZipAvailable: boolean;
};

function isHealth(value: unknown): value is LocalToolboxHealth {
  if (!value || typeof value !== "object") return false;
  const health = value as Record<string, unknown>;
  return (
    health.ok === true &&
    health.version === 1 &&
    typeof health.winRarAvailable === "boolean" &&
    typeof health.sevenZipAvailable === "boolean"
  );
}

export async function getLocalToolboxHealth(
  signal?: AbortSignal,
): Promise<LocalToolboxHealth> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 1500);
  const abortFromCaller = () => controller.abort();
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  try {
    const response = await fetch(`${getLocalToolboxOrigin()}/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error("Local toolbox is offline.");
    const body: unknown = await response.json();
    if (!isHealth(body)) throw new Error("Invalid local toolbox response.");
    return body;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
