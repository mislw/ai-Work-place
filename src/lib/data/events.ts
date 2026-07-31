import { createClient } from "@/lib/supabase/client";
import type { CalendarEvent } from "@/types/domain";
import type { EventInput } from "@/lib/schemas";

const TABLE = "calendar_events";

export async function listEvents(): Promise<CalendarEvent[]> {
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
  const supabase = createClient();
  const { error } = await supabase.from(TABLE).delete().eq("id", id);
  if (error) throw new Error(error.message);
}
