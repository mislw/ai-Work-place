import { createClient } from "@/lib/supabase/client";
import type { Note } from "@/types/domain";
import type { NoteInput } from "@/lib/schemas";

const TABLE = "notes";

export async function listNotes(): Promise<Note[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("is_pinned", { ascending: false })
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as Note[];
}

export async function getNote(id: string): Promise<Note | null> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as Note) ?? null;
}

export async function createNote(
  userId: string,
  input: NoteInput,
): Promise<Note> {
  const supabase = createClient();
  const row = {
    user_id: userId,
    title: input.title,
    content: input.content ?? "",
    summary: input.summary ?? null,
    tags: input.tags ?? [],
    is_pinned: input.is_pinned ?? false,
  };
  const { data, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as Note;
}

/** 自动保存用：基于 version 做乐观锁。 */
export async function saveNote(
  id: string,
  expectedVersion: number,
  patch: Partial<NoteInput>,
): Promise<Note> {
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.content !== undefined) update.content = patch.content;
  if (patch.summary !== undefined) update.summary = patch.summary;
  if (patch.tags !== undefined) update.tags = patch.tags;
  if (patch.is_pinned !== undefined) update.is_pinned = patch.is_pinned;
  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .eq("version", expectedVersion)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("CONFLICT");
  }
  return data as Note;
}

export async function deleteNote(id: string): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export async function togglePin(id: string, pinned: boolean): Promise<Note> {
  return saveNote(id, (await getNote(id))?.version ?? 1, { is_pinned: pinned });
}
