import { create } from "zustand";
import type { Todo, Note, CalendarEvent, DocumentLink } from "@/types/domain";

interface DataState {
  todos: Todo[];
  notes: Note[];
  events: CalendarEvent[];
  documents: DocumentLink[];
  setTodos: (todos: Todo[] | ((prev: Todo[]) => Todo[])) => void;
  setNotes: (notes: Note[] | ((prev: Note[]) => Note[])) => void;
  setEvents: (events: CalendarEvent[] | ((prev: CalendarEvent[]) => CalendarEvent[])) => void;
  setDocuments: (docs: DocumentLink[] | ((prev: DocumentLink[]) => DocumentLink[])) => void;
  upsertTodo: (todo: Todo) => void;
  removeTodo: (id: string) => void;
  upsertNote: (note: Note) => void;
  removeNote: (id: string) => void;
  upsertEvent: (event: CalendarEvent) => void;
  removeEvent: (id: string) => void;
  upsertDocument: (doc: DocumentLink) => void;
  removeDocument: (id: string) => void;
  reset: () => void;
}

export const useDataStore = create<DataState>((set) => ({
  todos: [],
  notes: [],
  events: [],
  documents: [],
  setTodos: (value) =>
    set((state) => ({
      todos: typeof value === "function" ? value(state.todos) : value,
    })),
  setNotes: (value) =>
    set((state) => ({
      notes: typeof value === "function" ? value(state.notes) : value,
    })),
  setEvents: (value) =>
    set((state) => ({
      events: typeof value === "function" ? value(state.events) : value,
    })),
  setDocuments: (value) =>
    set((state) => ({
      documents: typeof value === "function" ? value(state.documents) : value,
    })),
  upsertTodo: (todo) =>
    set((state) => {
      const idx = state.todos.findIndex((t) => t.id === todo.id);
      const next = idx >= 0 ? [...state.todos] : [...state.todos, todo];
      if (idx >= 0) next[idx] = todo;
      return { todos: next };
    }),
  removeTodo: (id) =>
    set((state) => ({ todos: state.todos.filter((t) => t.id !== id) })),
  upsertNote: (note) =>
    set((state) => {
      const idx = state.notes.findIndex((n) => n.id === note.id);
      const next = idx >= 0 ? [...state.notes] : [note, ...state.notes];
      if (idx >= 0) next[idx] = note;
      return { notes: next };
    }),
  removeNote: (id) =>
    set((state) => ({ notes: state.notes.filter((n) => n.id !== id) })),
  upsertEvent: (event) =>
    set((state) => {
      const idx = state.events.findIndex((e) => e.id === event.id);
      const next = idx >= 0 ? [...state.events] : [...state.events, event];
      if (idx >= 0) next[idx] = event;
      return { events: next };
    }),
  removeEvent: (id) =>
    set((state) => ({ events: state.events.filter((e) => e.id !== id) })),
  upsertDocument: (doc) =>
    set((state) => {
      const idx = state.documents.findIndex((d) => d.id === doc.id);
      const next = idx >= 0 ? [...state.documents] : [doc, ...state.documents];
      if (idx >= 0) next[idx] = doc;
      return { documents: next };
    }),
  removeDocument: (id) =>
    set((state) => ({
      documents: state.documents.filter((d) => d.id !== id),
    })),
  reset: () => set({ todos: [], notes: [], events: [], documents: [] }),
}));

export interface UIState {
  aiConfigured: boolean;
  tencentConfigured: boolean;
  setCapabilities: (ai: boolean, tencent: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  aiConfigured: false,
  tencentConfigured: false,
  setCapabilities: (ai, tencent) =>
    set({ aiConfigured: ai, tencentConfigured: tencent }),
}));
