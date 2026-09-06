"use client";

import { FolderClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGlobalFileIntake } from "@/components/intake/global-file-intake-provider";

export function IntakeActivityButton() {
  const intake = useGlobalFileIntake();
  if (intake.drawerOpen || (intake.activeCount === 0 && intake.batches.length === 0)) {
    return null;
  }
  const label = intake.activeCount > 0 ? `处理中 ${intake.activeCount}` : "查看整理结果";
  return (
    <Button
      className="fixed bottom-20 right-3 z-50 h-10 shadow-lg md:bottom-4"
      onClick={() => intake.setDrawerOpen(true)}
      aria-label={`打开整理面板，${label}`}
    >
      <FolderClock className="h-4 w-4" />
      {label}
    </Button>
  );
}
