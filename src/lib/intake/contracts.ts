import { z } from "zod";
import {
  calendarCreateInputSchema,
  noteCreateInputSchema,
  todoCreateInputSchema,
} from "@/lib/assistant/actions";

const boundedIdentifierSchema = z.string().trim().min(1).max(200);
const nullableDateTimeSchema = z.string().datetime().nullable();
const nullableShortTextSchema = z.string().max(4_000).nullable();
const jsonObjectSchema = z.record(z.unknown());

const pageTypeSchema = z.enum([
  "workspace",
  "assistant",
  "calendar",
  "todos",
  "notes",
  "documents",
  "settings",
]);

const pageFilterValueSchema = z.union([
  z.string().trim().min(1).max(200),
  z.array(z.string().trim().min(1).max(200)).max(20),
]);

const pageFiltersSchema = z
  .record(z.string().trim().min(1).max(100), pageFilterValueSchema)
  .refine((filters) => Object.keys(filters).length <= 20, {
    message: "Page context supports at most 20 filters",
  });

const internalWorkspaceRouteSchema = z
  .string()
  .min(1)
  .max(2_000)
  .refine(
    (route) =>
      route.startsWith("/") &&
      !route.startsWith("//") &&
      !route.includes("\\") &&
      !/^[a-z][a-z0-9+.-]*:/i.test(route) &&
      !/[\u0000-\u001f\u007f]/.test(route),
    { message: "Route must be an internal absolute workspace path" },
  );

export const workspacePageContextV1Schema = z
  .object({
    version: z.literal(1),
    route: internalWorkspaceRouteSchema,
    pageType: pageTypeSchema,
    capturedAt: z.string().datetime(),
    timezone: z.string().trim().min(1).max(100),
    selectedEntity: z
      .object({
        type: z.enum([
          "todo",
          "calendar_event",
          "note",
          "document",
          "knowledge",
        ]),
        id: boundedIdentifierSchema,
      })
      .strict()
      .optional(),
    assistantSessionId: boundedIdentifierSchema.optional(),
    view: z
      .object({
        date: z.string().date().optional(),
        dateRange: z
          .object({
            start: z.string().date(),
            end: z.string().date(),
          })
          .strict()
          .optional(),
        search: z.string().trim().min(1).max(500).optional(),
        filters: pageFiltersSchema.optional(),
      })
      .strict()
      .optional(),
    trigger: z
      .object({
        kind: z.enum(["file_drop", "file_picker"]),
        clientBatchId: boundedIdentifierSchema,
      })
      .strict(),
  })
  .strict();

const createOnlyActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("archive"),
      collectionName: z.string().trim().min(1).max(200),
      collectionKind: z
        .enum(["project", "area", "resource", "archive"])
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("note.create"),
      input: noteCreateInputSchema.strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("todo.create"),
      input: todoCreateInputSchema.strict(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("calendar.create"),
      input: calendarCreateInputSchema.strict(),
    })
    .strict(),
]);

export const workspaceIntakePlanV1Schema = z
  .object({
    version: z.literal(1),
    documentId: z.string().uuid(),
    summary: z.string().trim().min(1).max(4_000),
    confidence: z.number().min(0).max(1),
    actions: z.array(createOnlyActionSchema).max(30),
    warnings: z.array(z.string().trim().min(1).max(500)).max(30),
  })
  .strict();

export const intakeBatchStatusSchema = z.enum([
  "uploading",
  "processing",
  "orchestrating",
  "executing",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "undoing",
  "undone",
]);

export const intakeItemStatusSchema = z.enum([
  "waiting_extraction",
  "awaiting_hermes",
  "orchestrating",
  "executing",
  "completed",
  "partial",
  "failed",
  "cancelled",
]);

export const intakeStepStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "undone",
  "undo_conflict",
]);

export const intakeActionStepSchema = z
  .object({
    id: z.string().uuid(),
    batchId: z.string().uuid(),
    itemId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
    actionName: boundedIdentifierSchema,
    forwardInput: jsonObjectSchema,
    forwardResult: z.unknown().nullable(),
    inverseAction: boundedIdentifierSchema.nullable(),
    inverseInput: jsonObjectSchema.nullable(),
    conflictFingerprint: z.string().max(500).nullable(),
    status: intakeStepStatusSchema,
    confidence: z.number().min(0).max(1),
    errorCode: z.string().max(100).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: nullableDateTimeSchema,
    undoneAt: nullableDateTimeSchema,
  })
  .strict();

export const intakeItemSchema = z
  .object({
    id: z.string().uuid(),
    batchId: z.string().uuid(),
    assetId: z.string().uuid(),
    documentId: z.string().uuid(),
    jobId: z.string().uuid(),
    hermesRunId: z.string().max(500).nullable(),
    status: intakeItemStatusSchema,
    confidence: z.number().min(0).max(1).nullable(),
    decisionSummary: nullableShortTextSchema,
    errorCode: z.string().max(100).nullable(),
    attemptCount: z.number().int().nonnegative(),
    invalidPlanCount: z.number().int().nonnegative(),
    availableAt: z.string().datetime(),
    leaseOwner: z.string().max(500).nullable(),
    leaseExpiresAt: nullableDateTimeSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: nullableDateTimeSchema,
    steps: z.array(intakeActionStepSchema),
  })
  .strict();

export const intakeBatchSchema = z
  .object({
    id: z.string().uuid(),
    clientBatchId: boundedIdentifierSchema,
    sourceType: z.enum(["file_drop", "file_picker"]),
    pageContext: workspacePageContextV1Schema,
    status: intakeBatchStatusSchema,
    summary: nullableShortTextSchema,
    errorCode: z.string().max(100).nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    completedAt: nullableDateTimeSchema,
    undoneAt: nullableDateTimeSchema,
    items: z.array(intakeItemSchema),
  })
  .strict();

export const createIntakeBatchRequestSchema = z
  .object({
    clientBatchId: boundedIdentifierSchema,
    sourceType: z.enum(["file_drop", "file_picker"]),
    pageContext: workspacePageContextV1Schema,
    items: z
      .array(
        z
          .object({
            assetId: z.string().uuid(),
            documentId: z.string().uuid(),
            jobId: z.string().uuid(),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.sourceType !== request.pageContext.trigger.kind) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceType"],
        message: "Source type must match page context trigger kind",
      });
    }
    if (
      request.clientBatchId !== request.pageContext.trigger.clientBatchId
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientBatchId"],
        message: "Client batch ID must match page context trigger",
      });
    }
  });

export type WorkspacePageContextV1 = z.infer<
  typeof workspacePageContextV1Schema
>;
export type WorkspaceIntakePlanV1 = z.infer<
  typeof workspaceIntakePlanV1Schema
>;
export type IntakeBatchStatus = z.infer<typeof intakeBatchStatusSchema>;
export type IntakeItemStatus = z.infer<typeof intakeItemStatusSchema>;
export type IntakeStepStatus = z.infer<typeof intakeStepStatusSchema>;
export type IntakeActionStep = z.infer<typeof intakeActionStepSchema>;
export type IntakeItem = z.infer<typeof intakeItemSchema>;
export type IntakeBatch = z.infer<typeof intakeBatchSchema>;
export type CreateIntakeBatchRequest = z.infer<
  typeof createIntakeBatchRequestSchema
>;
