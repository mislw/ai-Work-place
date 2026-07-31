"use client";

import { useEffect, useRef } from "react";

/**
 * 在依赖变化后等待 delayMs 再执行 callback；期间再次变化会重置计时器。
 * 类似于 debounce 的 useEffect。
 */
export function useDebouncedEffect(
  callback: () => void | Promise<void>,
  delayMs: number,
  deps: React.DependencyList,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const id = setTimeout(() => {
      void callbackRef.current();
    }, delayMs);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
