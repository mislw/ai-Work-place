"use client";

import { useMemo, useState } from "react";
import { Plus, ExternalLink, Trash2, FileText, Search } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/topbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { useDataStore, useUIStore } from "@/lib/stores/data";
import { useAuth } from "@/hooks/use-auth";
import {
  createDocument,
  deleteDocument,
  listDocuments,
} from "@/lib/data/documents";
import { documentLinkSchema } from "@/lib/schemas";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDocumentOpen } from "@/components/documents/use-document-open";
import { isTencentDocsConfiguredClient } from "@/lib/tencent-docs/client";

export default function DocumentsPage() {
  const { user } = useAuth();
  const docs = useDataStore((s) => s.documents);
  const upsertDocument = useDataStore((s) => s.upsertDocument);
  const removeDocument = useDataStore((s) => s.removeDocument);
  const tencentConfigured = useUIStore((s) => s.tencentConfigured);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const { openDocument } = useDocumentOpen();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs
      .filter((d) =>
        !q
          ? true
          : d.title.toLowerCase().includes(q) ||
            (d.note ?? "").toLowerCase().includes(q) ||
            d.document_url.toLowerCase().includes(q),
      )
      .sort((a, b) => {
        const ta = a.last_opened_at ? Date.parse(a.last_opened_at) : 0;
        const tb = b.last_opened_at ? Date.parse(b.last_opened_at) : 0;
        if (tb !== ta) return tb - ta;
        return b.updated_at.localeCompare(a.updated_at);
      });
  }, [docs, search]);

  async function handleCreate(values: {
    title: string;
    document_url: string;
    note: string | null;
  }) {
    if (!user) return;
    const created = await createDocument(user.id, values);
    upsertDocument(created);
    setOpen(false);
    toast.success("已保存");
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const id = pendingDelete;
    const snap = docs.find((d) => d.id === id);
    removeDocument(id);
    setPendingDelete(null);
    try {
      await deleteDocument(id);
      toast.success("已删除");
    } catch {
      if (snap) upsertDocument(snap);
      toast.error("删除失败");
    }
  }

  async function handleSync() {
    // 第一版：仅刷新本地列表，不与腾讯文档双向同步
    try {
      const fresh = await listDocuments();
      useDataStore.getState().setDocuments(fresh);
      toast.success("已刷新");
    } catch {
      toast.error("刷新失败");
    }
  }

  return (
    <div data-crayon-page="documents" className="crayon-page">
      <PageHeader
        title="腾讯文档"
        description="保存常用的腾讯文档链接。基础功能无需配置 API。"
        actions={
          <Button variant="outline" onClick={handleSync}>
            刷新
          </Button>
        }
      />
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 sm:px-6">
        {!tencentConfigured ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-start gap-2 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-medium">尚未连接腾讯文档</div>
                <p className="text-xs text-muted-foreground">
                  你仍可保存、打开、备注腾讯文档链接。如需双向同步，请配置服务端环境变量。
                </p>
              </div>
              <Badge variant="secondary">未连接</Badge>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-3 text-xs text-muted-foreground">
              已配置腾讯文档 API（仅服务端可见凭证）。
            </CardContent>
          </Card>
        )}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索标题 / 备注 / 链接"
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> 添加链接
          </Button>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={<FileText className="h-5 w-5" />}
            title="还没有文档链接"
            description="把常用的腾讯文档加到这里，方便随时打开。"
            action={
              <Button onClick={() => setOpen(true)}>
                <Plus className="h-4 w-4" /> 添加链接
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {filtered.map((d) => (
              <Card key={d.id} className="hover:bg-muted/40">
                <CardContent className="p-3">
                  <div className="flex items-start gap-2">
                    <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {d.title}
                      </div>
                      <a
                        href={d.document_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={() => openDocument(d.id)}
                        className="mt-0.5 block truncate text-xs text-muted-foreground hover:text-foreground"
                      >
                        {d.document_url}
                      </a>
                      {d.note ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {d.note}
                        </p>
                      ) : null}
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {d.last_opened_at
                          ? `最近打开 ${new Date(d.last_opened_at).toLocaleString("zh-CN", {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}`
                          : `添加于 ${new Date(d.created_at).toLocaleDateString("zh-CN")}`}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        asChild
                        aria-label="打开"
                      >
                        <a
                          href={d.document_url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={() => openDocument(d.id)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="删除"
                        onClick={() => setPendingDelete(d.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <NewDocumentDialog
        open={open}
        onOpenChange={setOpen}
        onSubmit={handleCreate}
      />
      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="删除链接？"
        description="删除后无法恢复。"
        confirmText="删除"
        destructive
        onConfirm={confirmDelete}
      />
    </div>
  );
}

function NewDocumentDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { title: string; document_url: string; note: string | null }) => void | Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setTitle("");
    setUrl("");
    setNote("");
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = documentLinkSchema.safeParse({
      title: title.trim(),
      document_url: url.trim(),
      note: note.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "请检查输入");
      return;
    }
    setBusy(true);
    try {
      await onSubmit({
        title: parsed.data.title,
        document_url: parsed.data.document_url,
        note: parsed.data.note ?? null,
      });
      reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>添加腾讯文档链接</DialogTitle>
            <DialogDescription>
              仅支持 docs.qq.com 或 *.qq.com 链接。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="doc-title">名称</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-url">链接</Label>
            <Input
              id="doc-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://docs.qq.com/doc/..."
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="doc-note">备注（选填）</Label>
            <Textarea
              id="doc-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
