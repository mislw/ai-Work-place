/** 通用领域类型（与数据库无关）。 */

export type ID = string;
export type ISODate = string; // yyyy-MM-dd
export type ISODateTime = string; // 2026-07-31T10:00:00+08:00
export type HHmm = string; // HH:mm

export type TodoStatus = "pending" | "completed";
export type TodoPriority = "low" | "medium" | "high";

export interface Todo {
  id: ID;
  user_id: ID;
  title: string;
  description: string | null;
  status: TodoStatus;
  priority: TodoPriority;
  due_date: ISODate | null;
  due_time: HHmm | null;
  completed_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface CalendarEvent {
  id: ID;
  user_id: ID;
  title: string;
  description: string | null;
  event_date: ISODate;
  start_time: HHmm | null;
  end_time: HHmm | null;
  is_all_day: boolean;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface Note {
  id: ID;
  user_id: ID;
  title: string;
  content: string;
  summary: string | null;
  tags: string[];
  is_pinned: boolean;
  version: number;
  last_edited_at: ISODateTime;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface DocumentLink {
  id: ID;
  user_id: ID;
  title: string;
  document_url: string;
  note: string | null;
  last_opened_at: ISODateTime | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type ThemeMode = "light" | "dark" | "system";

export interface UserSettings {
  user_id: ID;
  theme: ThemeMode;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export type AiActionType =
  | "summarize_notes"
  | "extract_todos"
  | "daily_digest"
  | "plan_day"
  | "search_notes"
  | "summarize_note"
  | "polish_note"
  | "extract_actions"
  | "free_chat";

export interface AiActionLog {
  id: ID;
  user_id: ID;
  action_type: AiActionType;
  model: string;
  success: boolean;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  duration_ms: number | null;
  error_code: string | null;
  created_at: ISODateTime;
}

export interface Profile {
  id: ID;
  display_name: string | null;
  avatar_url: string | null;
  created_at: ISODateTime;
  updated_at: ISODateTime;
}

export interface NoteConflict {
  remoteVersion: number;
  remoteUpdatedAt: ISODateTime;
  remoteContent: string;
  remoteTitle: string;
}

export interface AiSuggestion {
  todos: Array<{
    title: string;
    description?: string | null;
    priority?: TodoPriority;
    due_date?: ISODate | null;
  }>;
  summary?: string;
  raw?: string;
}
