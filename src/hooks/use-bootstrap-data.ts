"use client";

import { useEffect } from "react";
import { useDataStore, useUIStore } from "@/lib/stores/data";
import { listTodos } from "@/lib/data/todos";
import { listNotes } from "@/lib/data/notes";
import { listEvents } from "@/lib/data/events";
import { listDocuments } from "@/lib/data/documents";
import { useCollectionRealtime } from "@/hooks/use-realtime";
import { createClient } from "@/lib/supabase/client";
import type {
  Todo,
  Note,
  CalendarEvent,
  DocumentLink,
} from "@/types/domain";

/** 启动后加载 4 类数据 + 启动 Realtime 订阅 + 探测 AI/Tencent 能力。 */
export function useBootstrapData() {
  const setTodos = useDataStore((s) => s.setTodos);
  const setNotes = useDataStore((s) => s.setNotes);
  const setEvents = useDataStore((s) => s.setEvents);
  const setDocuments = useDataStore((s) => s.setDocuments);
  const upsertTodo = useDataStore((s) => s.upsertTodo);
  const removeTodo = useDataStore((s) => s.removeTodo);
  const upsertNote = useDataStore((s) => s.upsertNote);
  const removeNote = useDataStore((s) => s.removeNote);
  const upsertEvent = useDataStore((s) => s.upsertEvent);
  const removeEvent = useDataStore((s) => s.removeEvent);
  const upsertDocument = useDataStore((s) => s.upsertDocument);
  const removeDocument = useDataStore((s) => s.removeDocument);
  const setCapabilities = useUIStore((s) => s.setCapabilities);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [todos, notes, events, docs] = await Promise.allSettled([
          listTodos(),
          listNotes(),
          listEvents(),
          listDocuments(),
        ]);
        if (cancelled) return;
        if (todos.status === "fulfilled") setTodos(todos.value);
        if (notes.status === "fulfilled") setNotes(notes.value);
        if (events.status === "fulfilled") setEvents(events.value);
        if (docs.status === "fulfilled") setDocuments(docs.value);
      } catch {
        // 初次加载失败由各页面 ErrorState 处理
      }
    })();

    // 探测 AI / Tencent Docs 配置
    fetch("/api/health")
      .then((r) => r.json())
      .then((data: { ai: boolean; tencentDocs: boolean }) => {
        if (cancelled) return;
        setCapabilities(data.ai, data.tencentDocs);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [
    setTodos,
    setNotes,
    setEvents,
    setDocuments,
    setCapabilities,
  ]);

  // Realtime：去重基于主键
  useCollectionRealtime({
    table: "todos",
    onChange: (payload) => {
      if (payload.eventType === "DELETE") {
        const old = payload.old as { id?: string };
        if (old.id) removeTodo(old.id);
      } else {
        upsertTodo(payload.new as unknown as Todo);
      }
    },
  });
  useCollectionRealtime({
    table: "notes",
    onChange: (payload) => {
      if (payload.eventType === "DELETE") {
        const old = payload.old as { id?: string };
        if (old.id) removeNote(old.id);
      } else {
        upsertNote(payload.new as unknown as Note);
      }
    },
  });
  useCollectionRealtime({
    table: "calendar_events",
    onChange: (payload) => {
      if (payload.eventType === "DELETE") {
        const old = payload.old as { id?: string };
        if (old.id) removeEvent(old.id);
      } else {
        upsertEvent(payload.new as unknown as CalendarEvent);
      }
    },
  });
  useCollectionRealtime({
    table: "document_links",
    onChange: (payload) => {
      if (payload.eventType === "DELETE") {
        const old = payload.old as { id?: string };
        if (old.id) removeDocument(old.id);
      } else {
        upsertDocument(payload.new as unknown as DocumentLink);
      }
    },
  });

  // 监听网络重连后重新拉取一次
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onOnline = async () => {
      const supabase = createClient();
      await supabase.auth.refreshSession().catch(() => null);
      const [todos, notes, events, docs] = await Promise.allSettled([
        listTodos(),
        listNotes(),
        listEvents(),
        listDocuments(),
      ]);
      if (todos.status === "fulfilled") setTodos(todos.value);
      if (notes.status === "fulfilled") setNotes(notes.value);
      if (events.status === "fulfilled") setEvents(events.value);
      if (docs.status === "fulfilled") setDocuments(docs.value);
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [setTodos, setNotes, setEvents, setDocuments]);
}
