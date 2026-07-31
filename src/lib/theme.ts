"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "paiw-theme";

/** 应用根 html 元素上的 .dark class。 */
function applyClass(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const resolved = resolveMode(mode);
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
}

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return mode;
}

/** 从 localStorage 读取主题。 */
export function readStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(STORAGE_KEY);
  if (v === "light" || v === "dark" || v === "system") return v;
  return "system";
}

/** 在 SSR-safe 方式下获取当前激活模式。 */
export function useThemeMode(): {
  mode: ThemeMode;
  resolved: "light" | "dark";
  setMode: (m: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const initial = readStoredTheme();
    setModeState(initial);
    setResolved(resolveMode(initial));
    applyClass(initial);
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    setResolved(resolveMode(m));
    applyClass(m);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, m);
    }
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      setResolved(mq.matches ? "dark" : "light");
      applyClass("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [mode]);

  return { mode, resolved, setMode };
}
