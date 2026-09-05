// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { executeWorkbenchAction } from "@/lib/assistant/action-executor";
import type { WorkbenchAction } from "@/lib/assistant/actions";

interface QueryRecord {
  table: string;
  filters: Array<[string, unknown]>;
}

function createFakeClient() {
  const queries: QueryRecord[] = [];
  const client = {
    from(table: string) {
      const record: QueryRecord = { table, filters: [] };
      queries.push(record);
      const query = {
        data: [{ id: "row-1" }],
        error: null,
        select: () => query,
        order: () => query,
        limit: () => query,
        insert: () => query,
        update: () => query,
        delete: () => query,
        eq(column: string, value: unknown) {
          record.filters.push([column, value]);
          return query;
        },
        single: async () => ({ data: { id: "row-1" }, error: null }),
        maybeSingle: async () => ({ data: { id: "row-1" }, error: null }),
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

const cases: Array<{ table: string; action: WorkbenchAction }> = [
  { table: "calendar_events", action: { action: "calendar.list", input: {} } },
  {
    table: "calendar_events",
    action: { action: "calendar.update", input: { id: "row-1", title: "更新" } },
  },
  { table: "calendar_events", action: { action: "calendar.delete", input: { id: "row-1" } } },
  { table: "todos", action: { action: "todo.list", input: {} } },
  { table: "todos", action: { action: "todo.update", input: { id: "row-1", title: "更新" } } },
  { table: "todos", action: { action: "todo.complete", input: { id: "row-1" } } },
  { table: "todos", action: { action: "todo.delete", input: { id: "row-1" } } },
  { table: "notes", action: { action: "note.list", input: {} } },
  {
    table: "notes",
    action: { action: "note.update", input: { id: "row-1", version: 1, title: "更新" } },
  },
  { table: "notes", action: { action: "note.delete", input: { id: "row-1" } } },
  { table: "document_links", action: { action: "document.list", input: {} } },
  {
    table: "document_links",
    action: { action: "document.update", input: { id: "row-1", title: "更新" } },
  },
  { table: "document_links", action: { action: "document.delete", input: { id: "row-1" } } },
];

describe("assistant action owner scope", () => {
  for (const testCase of cases) {
    it(`scopes ${testCase.action.action} to the authenticated owner`, async () => {
      const { client, queries } = createFakeClient();

      await executeWorkbenchAction("owner-1", testCase.action, client);

      const businessQuery = queries.find((query) => query.table === testCase.table);
      expect(businessQuery?.filters).toContainEqual(["user_id", "owner-1"]);
    });
  }
});
