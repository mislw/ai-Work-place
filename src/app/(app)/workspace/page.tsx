"use client";

import { useBootstrapData } from "@/hooks/use-bootstrap-data";
import { WorkspaceGreeting } from "@/components/workspace/greeting";
import { OverviewCards } from "@/components/workspace/overview-cards";
import { TodayTodosCard } from "@/components/workspace/today-todos";
import { QuickNoteCard } from "@/components/workspace/quick-note";
import { WeekStripCard } from "@/components/workspace/week-strip";
import { AiAssistantCard } from "@/components/workspace/ai-assistant";
import { RecentDocsCard } from "@/components/workspace/recent-docs";

export default function WorkspacePage() {
  useBootstrapData();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6 sm:py-6">
      <WorkspaceGreeting />
      <OverviewCards />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TodayTodosCard />
        <QuickNoteCard />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WeekStripCard />
        <AiAssistantCard />
      </div>
      <RecentDocsCard />
    </div>
  );
}
