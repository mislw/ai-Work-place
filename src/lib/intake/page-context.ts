import {
  workspacePageContextV1Schema,
  type WorkspacePageContextV1,
} from "@/lib/intake/contracts";

const SENSITIVE_QUERY_KEY = /password|passcode|token|secret|cookie|authorization|api[-_]?key|draft|body|content/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface CaptureWorkspacePageContextInput {
  route: string;
  timezone: string;
  triggerKind: "file_drop" | "file_picker";
  clientBatchId: string;
  capturedAt: Date;
  selectedEntity?: WorkspacePageContextV1["selectedEntity"];
  assistantSessionId?: string;
}

export function captureWorkspacePageContext(
  input: CaptureWorkspacePageContextInput,
): WorkspacePageContextV1 {
  const url = parseInternalRoute(input.route);
  const query = sanitizeQuery(url.searchParams);
  const route = boundedRoute(url.pathname, query.route);
  const selectedEntity = input.selectedEntity
    ? { type: input.selectedEntity.type, id: bounded(input.selectedEntity.id, 200) }
    : undefined;
  const assistantSessionId = input.assistantSessionId
    ? bounded(input.assistantSessionId, 200)
    : undefined;

  return workspacePageContextV1Schema.parse({
    version: 1,
    route,
    pageType: pageTypeFromPath(url.pathname),
    capturedAt: input.capturedAt.toISOString(),
    timezone: bounded(input.timezone, 100),
    ...(selectedEntity ? { selectedEntity } : {}),
    ...(assistantSessionId ? { assistantSessionId } : {}),
    ...(query.view ? { view: query.view } : {}),
    trigger: {
      kind: input.triggerKind,
      clientBatchId: bounded(input.clientBatchId, 200),
    },
  });
}

function parseInternalRoute(route: string) {
  if (!route.startsWith("/") || route.startsWith("//") || route.includes("\\")) {
    return new URL("/workspace", "https://workspace.local");
  }
  try {
    return new URL(route, "https://workspace.local");
  } catch {
    return new URL("/workspace", "https://workspace.local");
  }
}

function pageTypeFromPath(pathname: string): WorkspacePageContextV1["pageType"] {
  const segment = pathname.split("/").filter(Boolean)[0] ?? "workspace";
  if (["assistant", "calendar", "todos", "notes", "documents", "settings"].includes(segment)) {
    return segment as WorkspacePageContextV1["pageType"];
  }
  return "workspace";
}

function sanitizeQuery(searchParams: URLSearchParams) {
  const route = new URLSearchParams();
  const filters: Record<string, string | string[]> = {};
  const grouped = new Map<string, string[]>();

  for (const [rawKey, rawValue] of searchParams) {
    const key = rawKey.trim().slice(0, 100);
    const value = rawValue.trim().slice(0, 200);
    if (!key || !value || SENSITIVE_QUERY_KEY.test(key)) continue;
    const values = grouped.get(key) ?? [];
    if (values.length < 20) values.push(value);
    grouped.set(key, values);
  }

  for (const [key, values] of [...grouped.entries()].slice(0, 20)) {
    for (const value of values) route.append(key, value);
    if (["date", "start", "end", "search", "q"].includes(key)) continue;
    filters[key] = values.length === 1 ? values[0]! : values;
  }

  const date = validDate(grouped.get("date")?.[0]);
  const start = validDate(grouped.get("start")?.[0]);
  const end = validDate(grouped.get("end")?.[0]);
  const search = grouped.get("search")?.[0] ?? grouped.get("q")?.[0];
  const view: NonNullable<WorkspacePageContextV1["view"]> = {};
  if (date) view.date = date;
  if (start && end) view.dateRange = { start, end };
  if (search) view.search = search;
  if (Object.keys(filters).length > 0) view.filters = filters;

  return { route, view: Object.keys(view).length > 0 ? view : undefined };
}

function boundedRoute(pathname: string, searchParams: URLSearchParams) {
  const safePath = pathname.slice(0, 2_000);
  if (safePath.length >= 2_000) return safePath;
  const boundedSearch = new URLSearchParams();
  for (const [key, value] of searchParams) {
    const candidate = new URLSearchParams(boundedSearch);
    candidate.append(key, value);
    const serialized = candidate.toString();
    if (safePath.length + 1 + serialized.length > 2_000) break;
    boundedSearch.append(key, value);
  }
  const search = boundedSearch.toString();
  return `${safePath}${search ? `?${search}` : ""}`;
}

function validDate(value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function bounded(value: string, max: number) {
  return value.trim().slice(0, max);
}
