"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { intakeBatchSchema, type IntakeBatch } from "@/lib/intake/contracts";
import { captureWorkspacePageContext } from "@/lib/intake/page-context";
import {
  useKnowledgeUploads,
  type KnowledgeUploadItem,
} from "@/hooks/use-knowledge-uploads";

const DRAWER_KEY = "workspace-intake-drawer-open";
const ACTIVE_STATUSES = new Set<IntakeBatch["status"]>([
  "uploading",
  "processing",
  "orchestrating",
  "executing",
]);

export interface GlobalFileIntakeContextValue {
  batches: IntakeBatch[];
  localUploads: KnowledgeUploadItem[];
  drawerOpen: boolean;
  activeCount: number;
  enqueueFiles(files: File[] | FileList, kind: "file_drop" | "file_picker"): void;
  setDrawerOpen(open: boolean): void;
  retry(batchId: string): Promise<void>;
  cancel(batchId: string): Promise<void>;
  undo(batchId: string): Promise<void>;
}

const GlobalFileIntakeContext = createContext<GlobalFileIntakeContextValue | null>(null);

export function GlobalFileIntakeProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [batches, setBatches] = useState<IntakeBatch[]>([]);
  const batchesRef = useRef<IntakeBatch[]>([]);
  const [drawerOpen, setDrawerOpenState] = useState(() =>
    typeof window === "undefined"
      ? true
      : sessionStorage.getItem(DRAWER_KEY) !== "false",
  );
  const routeRef = useRef("/workspace");
  const durableItems = useRef(new Map<string, Map<string, KnowledgeUploadItem>>());
  const registrationChains = useRef(new Map<string, Promise<void>>());
  const mutationVersion = useRef(0);
  const refreshSequence = useRef(0);
  const lastAppliedRefresh = useRef(0);

  const search = searchParams.toString();
  routeRef.current = `${pathname || "/workspace"}${search ? `?${search}` : ""}`;
  batchesRef.current = batches;

  const replaceBatch = useCallback((batch: IntakeBatch) => {
    mutationVersion.current += 1;
    setBatches((current) => [
      batch,
      ...current.filter((item) => item.id !== batch.id),
    ]);
  }, []);

  const refreshBatches = useCallback(async () => {
    const sequence = ++refreshSequence.current;
    const versionAtStart = mutationVersion.current;
    const response = await fetch("/api/intake/batches", { cache: "no-store" });
    const body = (await response.json()) as {
      batches?: unknown;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(body.error?.message ?? "读取接管批次失败");
    const parsed = intakeBatchSchema.array().safeParse(body.batches);
    if (!parsed.success) throw new Error("INVALID_INTAKE_BATCH_RESPONSE");
    if (sequence < lastAppliedRefresh.current) return;
    lastAppliedRefresh.current = sequence;
    if (versionAtStart === mutationVersion.current) {
      setBatches(parsed.data);
      return;
    }
    setBatches((current) => [
      ...current,
      ...parsed.data.filter(
        (batch) => !current.some((existing) => existing.id === batch.id),
      ),
    ]);
  }, []);

  const runCommand = useCallback(
    async (batchId: string, command: "retry" | "cancel" | "undo") => {
      const response = await fetch(`/api/intake/batches/${batchId}/${command}`, {
        method: "POST",
      });
      const body = (await response.json()) as {
        batch?: unknown;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "接管批次操作失败");
      replaceBatch(intakeBatchSchema.parse(body.batch));
    },
    [replaceBatch],
  );

  const registerDurableBatch = useCallback(
    async (clientBatchId: string) => {
      const itemMap = durableItems.current.get(clientBatchId);
      const items = itemMap ? [...itemMap.values()] : [];
      const intake = items[0]?.intake;
      if (!intake || items.length === 0) return;

      const response = await fetch("/api/intake/batches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientBatchId,
          sourceType: intake.pageContext.trigger.kind,
          pageContext: intake.pageContext,
          items: items.map((item) => ({
            assetId: item.assetId,
            documentId: item.documentId,
            jobId: item.jobId,
          })),
        }),
      });
      const body = (await response.json()) as {
        batch?: unknown;
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "注册接管批次失败");
      replaceBatch(intakeBatchSchema.parse(body.batch));
    },
    [replaceBatch],
  );

  const onDurable = useCallback(
    (item: KnowledgeUploadItem) => {
      const intake = item.intake;
      if (!intake || !item.documentId) return;
      const items = durableItems.current.get(intake.clientBatchId) ?? new Map();
      items.set(item.documentId, item);
      durableItems.current.set(intake.clientBatchId, items);

      const previous =
        registrationChains.current.get(intake.clientBatchId) ?? Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => registerDurableBatch(intake.clientBatchId));
      const settled = next
        .catch(() => setDrawerOpenState(true))
        .finally(() => {
        if (registrationChains.current.get(intake.clientBatchId) === settled) {
          registrationChains.current.delete(intake.clientBatchId);
        }
      });
      registrationChains.current.set(intake.clientBatchId, settled);
    },
    [registerDurableBatch],
  );

  const onCancelIntake = useCallback(
    async (item: KnowledgeUploadItem) => {
      const clientBatchId = item.intake?.clientBatchId;
      if (!clientBatchId) return;
      await registrationChains.current.get(clientBatchId)?.catch(() => undefined);
      const batch = batchesRef.current.find(
        (candidate) => candidate.clientBatchId === clientBatchId,
      );
      if (batch) await runCommand(batch.id, "cancel");
    },
    [runCommand],
  );

  const uploads = useKnowledgeUploads({
    onDurable,
    onInterrupted: () => setDrawerOpenState(true),
    onCancelIntake,
  });

  useEffect(() => {
    void refreshBatches().catch(() => undefined);
  }, [refreshBatches]);

  const hasActive = batches.some((batch) => ACTIVE_STATUSES.has(batch.status));
  useEffect(() => {
    if (!hasActive) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1_000;
    const poll = () => {
      timer = setTimeout(async () => {
        try {
          await refreshBatches();
        } catch {
          // Keep the bounded polling loop alive after a transient failure.
        }
        delay = Math.min(5_000, Math.round(delay * 1.7));
        if (!cancelled) poll();
      }, delay);
    };
    poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [hasActive, refreshBatches]);

  useEffect(() => {
    if (batches.some(needsAttention)) setDrawerOpenState(true);
  }, [batches]);

  const setDrawerOpen = useCallback((open: boolean) => {
    setDrawerOpenState(open);
    sessionStorage.setItem(DRAWER_KEY, String(open));
  }, []);

  const enqueueFiles = useCallback(
    (files: File[] | FileList, kind: "file_drop" | "file_picker") => {
      const clientBatchId = globalThis.crypto.randomUUID();
      const pageContext = captureWorkspacePageContext({
        route: routeRef.current,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        triggerKind: kind,
        clientBatchId,
        capturedAt: new Date(),
      });
      setDrawerOpen(true);
      uploads.addFiles(files, { clientBatchId, pageContext });
    },
    [setDrawerOpen, uploads],
  );

  const value = useMemo<GlobalFileIntakeContextValue>(
    () => ({
      batches,
      localUploads: uploads.items,
      drawerOpen,
      activeCount: batches.filter((batch) => ACTIVE_STATUSES.has(batch.status)).length,
      enqueueFiles,
      setDrawerOpen,
      retry: (batchId) => runCommand(batchId, "retry"),
      cancel: (batchId) => runCommand(batchId, "cancel"),
      undo: (batchId) => runCommand(batchId, "undo"),
    }),
    [batches, drawerOpen, enqueueFiles, runCommand, setDrawerOpen, uploads.items],
  );

  return (
    <GlobalFileIntakeContext.Provider value={value}>
      {children}
    </GlobalFileIntakeContext.Provider>
  );
}

export function useGlobalFileIntake() {
  const value = useContext(GlobalFileIntakeContext);
  if (!value) throw new Error("GlobalFileIntakeProvider is required");
  return value;
}

function needsAttention(batch: IntakeBatch) {
  return (
    batch.status === "failed" ||
    batch.status === "partial" ||
    batch.errorCode === "UNDO_RECORD_CHANGED" ||
    batch.errorCode === "CONFIRMATION_REQUIRED"
  );
}
