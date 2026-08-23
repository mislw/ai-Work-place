import type {
  CalendarEvent,
  DocumentLink,
  Note,
  Todo,
} from "@/types/domain";

interface PreviewDatabase {
  todos: Todo[];
  notes: Note[];
  events: CalendarEvent[];
  documents: DocumentLink[];
}

const STORAGE_KEY = "ai-workstation-preview-data-v1";
const EMPTY_DATABASE: PreviewDatabase = {
  todos: [],
  notes: [],
  events: [],
  documents: [],
};

export function readPreviewCollection<K extends keyof PreviewDatabase>(
  collection: K,
): PreviewDatabase[K] {
  return readDatabase()[collection];
}

export function updatePreviewCollection<K extends keyof PreviewDatabase>(
  collection: K,
  update: (rows: PreviewDatabase[K]) => PreviewDatabase[K],
): PreviewDatabase[K] {
  const database = readDatabase();
  const next = update(database[collection]);
  writeDatabase({ ...database, [collection]: next });
  return next;
}

export function createPreviewId(prefix: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function readDatabase(): PreviewDatabase {
  if (typeof window === "undefined") return structuredClone(EMPTY_DATABASE);
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(EMPTY_DATABASE);
  try {
    const parsed = JSON.parse(raw) as Partial<PreviewDatabase>;
    return {
      todos: Array.isArray(parsed.todos) ? parsed.todos : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
    };
  } catch {
    return structuredClone(EMPTY_DATABASE);
  }
}

function writeDatabase(database: PreviewDatabase): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(database));
}
