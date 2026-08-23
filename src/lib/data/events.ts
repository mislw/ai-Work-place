import { createClient } from "@/lib/supabase/client";
import { isPreviewAuthEnabled } from "@/lib/auth/preview";
import {
  createPreviewId,
  readPreviewCollection,
  updatePreviewCollection,
} from "@/lib/data/preview-store";
import type { CalendarEvent } from "@/types/domain";
import type { EventInput } from "@/lib/schemas";
import { getAppNow } from "@/lib/app-now";

const TABLE = "calendar_events";

export async function listEvents(): Promise<CalendarEvent[]> {
  if (isPreviewAuthEnabled()) {
    return [...readPreviewCollection("events")].sort((a, b) => {
      const dateOrder = a.event_date.localeCompare(b.event_date);
      return dateOrder || (a.start_time ?? "99:99").localeCompare(b.start_time ?? "99:99");
    });
  }
  const supabase = createClient();
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("event_date", { ascending: true })
    .order("start_time", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as CalendarEvent[];
}

export async function createEvent(
  userId: string,
  input: EventInput,
): Promise<CalendarEvent> {
  if (isPreviewAuthEnabled()) {
    const now = getAppNow().toISOString();
    const row: CalendarEvent = {
      id: createPreviewId("event"),
      user_id: userId,
      title: input.title,
      description: input.description ?? null,
      event_date: input.event_date,
      start_time: input.start_time ?? null,
      end_time: input.end_time ?? null,
      is_all_day: input.is_all_day ?? false,
      created_at: now,
      updated_at: now,
    };
    updatePreviewCollection("events", (rows) => [...rows, row]);
    return row;
  }
  const supabase = createClient();
  const row = {
    user_id: userId,
    title: input.title,
    description: input.description ?? null,
    event_date: input.event_date,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    is_all_day: input.is_all_day ?? false,
  };
  const { data, error } = await supabase
    .from(TABLE)
    .insert(row)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CalendarEvent;
}

export async function updateEvent(
  id: string,
  patch: Partial<EventInput>,
): Promise<CalendarEvent> {
  if (isPreviewAuthEnabled()) {
    let updated: CalendarEvent | null = null;
    updatePreviewCollection("events", (rows) =>
      rows.map((event) => {
        if (event.id !== id) return event;
        updated = {
          ...event,
          ...patch,
          updated_at: getAppNow().toISOString(),
        };
        return updated;
      }),
    );
    if (!updated) throw new Error("日程不存在");
    return updated;
  }
  const supabase = createClient();
  const update: Record<string, unknown> = {};
  if (patch.title !== undefined) update.title = patch.title;
  if (patch.description !== undefined) update.description = patch.description;
  if (patch.event_date !== undefined) update.event_date = patch.event_date;
  if (patch.start_time !== undefined) update.start_time = patch.start_time;
  if (patch.end_time !== undefined) update.end_time = patch.end_time;
  if (patch.is_all_day !== undefined) update.is_all_day = patch.is_all_day;
  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CalendarEvent;
}

export async function deleteEvent(id: string): Promise<void> {
  if (isPreviewAuthEnabled()) {
    updatePreviewCollection("events", (rows) =>
      rows.filter((event) => event.id !== id),
    );
    return;
  }
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
