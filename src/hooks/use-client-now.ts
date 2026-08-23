"use client";

import { useEffect, useState } from "react";
import { getAppNow } from "@/lib/app-now";

export function useClientNow(refreshMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(getAppNow());
    update();

    const id = window.setInterval(update, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs]);

  return now;
}
