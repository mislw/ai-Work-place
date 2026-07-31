"use client";

import { useMemo } from "react";
import { FileText, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDataStore } from "@/lib/stores/data";
import { EmptyState } from "@/components/common/empty-state";
import { useDocumentOpen } from "@/components/documents/use-document-open";

export function RecentDocsCard() {
  const docs = useDataStore((s) => s.documents);
  const recent = useMemo(
    () =>
      [...docs]
        .sort((a, b) => {
          const ta = a.last_opened_at ? Date.parse(a.last_opened_at) : 0;
          const tb = b.last_opened_at ? Date.parse(b.last_opened_at) : 0;
          if (tb !== ta) return tb - ta;
          return Date.parse(b.updated_at) - Date.parse(a.updated_at);
        })
        .slice(0, 5),
    [docs],
  );
  const { openDocument } = useDocumentOpen();

  return (
    <Card className="h-full">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>最近文档</CardTitle>
        <Button asChild variant="link" size="sm">
          <Link href="/documents">查看全部 →</Link>
        </Button>
      </CardHeader>
      <CardContent>
        {recent.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="还没有腾讯文档链接"
            description="在「文档」页面添加你常用的腾讯文档。"
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/documents">去添加</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {recent.map((d) => (
              <li
                key={d.id}
                className="flex items-center gap-3 py-2.5 text-sm"
              >
                <FileText className="h-4 w-4 text-muted-foreground" />
                <button
                  onClick={() => openDocument(d.id)}
                  className="flex-1 truncate text-left hover:underline"
                >
                  {d.title}
                </button>
                <span className="text-xs text-muted-foreground">
                  {formatRelative(d.last_opened_at ?? d.updated_at)}
                </span>
                <a
                  href={d.document_url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => openDocument(d.id)}
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="在新窗口打开"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatRelative(iso: string): string {
  const t = Date.parse(iso);
  const diffMs = Date.now() - t;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "刚刚";
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}
