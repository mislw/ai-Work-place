import { createClient } from "@/lib/supabase/client";
import type { DocumentLink } from "@/types/domain";
import type { DocumentLinkInput } from "@/lib/schemas";

const TABLE = "document_links";

export async function listDocuments(): Promise<DocumentLink[]> {
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
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function markOpened(id: string): Promise<void> {
  const supabase = createClient();
  await supabase
    .from(TABLE)
    .update({ last_opened_at: new Date().toISOString() })
    .eq("id", id);
}
