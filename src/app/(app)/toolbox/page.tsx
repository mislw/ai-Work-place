import { PageHeader } from "@/components/layout/topbar";
import { ArchiveExtractorTool } from "@/components/toolbox/archive-extractor-tool";

export default function ToolboxPage() {
  return (
    <div className="crayon-page">
      <PageHeader title="工具箱" description="只在本机运行的实用工具" />
      <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:px-6">
        <ArchiveExtractorTool />
      </div>
    </div>
  );
}
