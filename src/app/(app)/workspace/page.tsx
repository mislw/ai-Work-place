"use client";

import { OverviewCards } from "@/components/workspace/overview-cards";
import { TodayTodosCard } from "@/components/workspace/today-todos";
import { WeekStripCard } from "@/components/workspace/week-strip";
import { AiAssistantCard } from "@/components/workspace/ai-assistant";

export default function WorkspacePage() {
  return (
    <div
      data-crayon-page="workspace"
      className="crayon-page mx-auto w-full max-w-[1180px] space-y-4 px-4 py-4 sm:px-6 sm:py-5"
    >
      <OverviewCards />
      <section
        aria-label="今日工作"
        className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-2"
      >
        <TodayTodosCard />
        <AiAssistantCard />
      </section>
      <section aria-label="本周日历">
        <WeekStripCard />
      </section>
    </div>
  );
}
