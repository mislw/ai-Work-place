import { requireUser } from "@/lib/supabase/guards";
import { Sidebar, BottomNav, MobileNav } from "@/components/layout/nav";
import { TopBar } from "@/components/layout/topbar";
import { AppDataBootstrap } from "@/components/layout/app-data-bootstrap";
import { GlobalFileIntakeProvider } from "@/components/intake/global-file-intake-provider";
import { GlobalDropOverlay } from "@/components/intake/global-drop-overlay";
import { IntakeActivityButton } from "@/components/intake/intake-activity-button";
import { IntakeDrawer } from "@/components/intake/intake-drawer";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 二次校验：中间件 + RLS 之外的兜底
  const { user } = await requireUser();

  return (
    <GlobalFileIntakeProvider>
      <div className="crayon-shell crayon-paper flex min-h-svh">
        <AppDataBootstrap />
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav />
          <TopBar />
          <main className="crayon-main flex-1 pb-20 md:pb-0">{children}</main>
        </div>
        <BottomNav />
        <GlobalDropOverlay />
        <IntakeActivityButton />
        <IntakeDrawer />
        {/* 标记当前用户供客户端读取（用 data-attribute 即可，避免水合不一致） */}
        <span hidden data-user-id={user.id} />
      </div>
    </GlobalFileIntakeProvider>
  );
}
