import { createClient } from "@/lib/supabase/client";
import { isPreviewAuthEnabled } from "@/lib/auth/preview";
import {
  createPreviewId,
  readPreviewCollection,
  updatePreviewCollection,
} from "@/lib/data/preview-store";
import type { DocumentLink } from "@/types/domain";
import type { DocumentLinkInput } from "@/lib/schemas";
import { getAppNow } from "@/lib/app-now";

const TABLE = "document_links";

export async function listDocuments(): Promise<DocumentLink[]> {
  if (isPreviewAuthEnabled()) {
    return [...readPreviewCollection("documents")].sort((a, b) => {
      const aTime = a.last_opened_at ?? a.updated_at;
      const bTime = b.last_opened_at ?? b.updated_at;
      return bTime.localeCompare(aTime);
    });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("last_opened_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as DocumentLink[];
}

export async function createDocument(
  userId: string,
  input: DocumentLinkInput,
): Promise<DocumentLink> {
  if (isPreviewAuthEnabled()) {
    const now = getAppNow().toISOString();
    const row: DocumentLink = {
      id: createPreviewId("document"),
      user_id: userId,
      title: input.title,
      document_url: input.document_url,
      note: input.note ?? null,
      last_opened_at: null,
      created_at: now,
      updated_at: now,
    };
    updatePreviewCollection("documents", (rows) => [row, ...rows]);
    return row;
  }
  const supabase = createClient();
  const row = {
    user_id: userId,
    title: input.title,
    document_url: input.document_url,
    note: input.note ?? null,
  };
  const { data, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as DocumentLink;
}

export async function updateDocument(
  id: string,
  patch: Partial<DocumentLinkInput> & { last_opened_at?: string },
): Promise<DocumentLink> {
  if (isPreviewAuthEnabled()) {
    let updated: DocumentLink | null = null;
    updatePreviewCollection("documents", (rows) =>
      rows.map((document) => {
        if (document.id !== id) return document;
        updated = {
          ...document,
          ...patch,
          updated_at: getAppNow().toISOString(),
        };
        return updated;
      }),
    );
    if (!updated) throw new Error("文档不存在");
    return updated;
  }
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.document_url !== undefined) update.document_url = patch.document_url;
  if (patch.note !== undefined) update.note = patch.note;
  if (patch.last_opened_at !== undefined) update.last_opened_at = patch.last_opened_at;
  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as DocumentLink;
}

export async function deleteDocument(id: string): Promise<void> {
  if (isPreviewAuthEnabled()) {
    updatePreviewCollection("documents", (rows) =>
      rows.filter((document) => document.id !== id),
    );
    return;
  }
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markOpened(id: string): Promise<void> {
  if (isPreviewAuthEnabled()) {
    const now = getAppNow().toISOString();
    updatePreviewCollection("documents", (rows) =>
      rows.map((document) =>
        document.id === id
          ? { ...document, last_opened_at: now, updated_at: now }
          : document,
      ),
    );
    return;
  }
  const supabase = createClient();
  await supabase
    .from(TABLE)
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", id);
}
