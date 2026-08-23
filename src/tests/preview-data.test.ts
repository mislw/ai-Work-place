import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTodo,
  deleteTodo,
  listTodos,
  updateTodo,
} from "@/lib/data/todos";
import {
  createEvent,
  deleteEvent,
  listEvents,
  updateEvent,
} from "@/lib/data/events";
import {
  createNote,
  deleteNote,
  getNote,
  listNotes,
  saveNote,
} from "@/lib/data/notes";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  markOpened,
  updateDocument,
} from "@/lib/data/documents";

const USER_ID = "00000000-0000-4000-8000-000000000000";

describe("preview data persistence", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_AUTH_PREVIEW", "true");
    localStorage.clear();
  });

  it("supports creating, editing and deleting todos without Supabase", async () => {
    const created = await createTodo(USER_ID, {
      title: "整理工作台",
      priority: "high",
      due_date: "2026-08-22",
    });

    expect(await listTodos()).toEqual([
      expect.objectContaining({
        id: created.id,
        title: "整理工作台",
        status: "pending",
        priority: "high",
      }),
    ]);

    const updated = await updateTodo(created.id, { status: "completed" });
    expect(updated.status).toBe("completed");
    expect(updated.completed_at).not.toBeNull();

    await deleteTodo(created.id);
    expect(await listTodos()).toEqual([]);
  });

  it("supports calendar, note and document workflows without Supabase", async () => {
    const event = await createEvent(USER_ID, {
      title: "界面验收",
      event_date: "2026-08-22",
      start_time: "14:00",
      end_time: "15:00",
      is_all_day: false,
    });
    expect((await updateEvent(event.id, { title: "移动端验收" })).title).toBe(
      "移动端验收",
    );
    expect(await listEvents()).toHaveLength(1);

    const note = await createNote(USER_ID, {
      title: "改版记录",
      content: "保留原有功能。",
      tags: ["UI"],
    });
    const saved = await saveNote(note.id, note.version, {
      content: "保留原有功能和数据入口。",
    });
    expect(saved.version).toBe(note.version + 1);
    expect((await getNote(note.id))?.content).toContain("数据入口");
    expect(await listNotes()).toHaveLength(1);

    const document = await createDocument(USER_ID, {
      title: "设计说明",
      document_url: "https://docs.qq.com/doc/example",
      note: "本地预览",
    });
    expect(
      (await updateDocument(document.id, { title: "界面设计说明" })).title,
    ).toBe("界面设计说明");
    await markOpened(document.id);
    expect((await listDocuments())[0]?.last_opened_at).not.toBeNull();

    await Promise.all([
      deleteEvent(event.id),
      deleteNote(note.id),
      deleteDocument(document.id),
    ]);
    expect(await listEvents()).toEqual([]);
    expect(await listNotes()).toEqual([]);
    expect(await listDocuments()).toEqual([]);
  });
});
