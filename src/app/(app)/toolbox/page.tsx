import { Download } from "lucide-react";
import { PageHeader } from "@/components/layout/topbar";
import { ArchiveExtractorTool } from "@/components/toolbox/archive-extractor-tool";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const WINDOWS_DOWNLOAD_URL =
  "/downloads/personal-ai-workspace-0.1.1-x64-setup.exe";

export default function ToolboxPage() {
  return (
    <div className="crayon-page">
      <PageHeader
        title="工具箱"
        description="只在本机运行的实用工具"
        actions={
          <a
            href={WINDOWS_DOWNLOAD_URL}
            download
            className={cn(buttonVariants({ variant: "outline" }), "gap-2")}
          >
            <Download className="h-4 w-4" />
            下载 Windows 版
          </a>
        }
      />
      <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
        <ArchiveExtractorTool />
      </div>
    </div>
  );
}
