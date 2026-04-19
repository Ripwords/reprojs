import { z } from "zod"

export const ReporterIdentity = z.object({
  userId: z.string().optional(),
  email: z.email().optional(),
  name: z.string().max(200).optional(),
})
export type ReporterIdentity = z.infer<typeof ReporterIdentity>

export const SystemInfo = z.object({
  userAgent: z.string(),
  platform: z.string(),
  language: z.string(),
  timezone: z.string(),
  timezoneOffset: z.number(),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  screen: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  dpr: z.number().positive(),
  online: z.boolean(),
  connection: z
    .object({
      effectiveType: z.string().optional(),
      rtt: z.number().optional(),
      downlink: z.number().optional(),
    })
    .optional(),
  pageUrl: z.string().url(),
  referrer: z.string().optional(),
  timestamp: z.string(),
})
export type SystemInfo = z.infer<typeof SystemInfo>

export const CookieEntry = z.object({
  name: z.string(),
  value: z.string(),
})
export type CookieEntry = z.infer<typeof CookieEntry>

export const ConsoleEntry = z.object({
  level: z.enum(["log", "info", "warn", "error", "debug"]),
  ts: z.number().int(),
  args: z.array(z.string()),
  stack: z.string().optional(),
})
export type ConsoleEntry = z.infer<typeof ConsoleEntry>

export const NetworkEntry = z.object({
  id: z.string(),
  ts: z.number().int(),
  method: z.string(),
  url: z.string(),
  status: z.number().int().nullable(),
  durationMs: z.number().nonnegative().nullable(),
  size: z.number().int().nullable(),
  initiator: z.enum(["fetch", "xhr"]),
  requestHeaders: z.record(z.string(), z.string()).optional(),
  responseHeaders: z.record(z.string(), z.string()).optional(),
  requestBody: z.string().optional(),
  responseBody: z.string().optional(),
  error: z.string().optional(),
})
export type NetworkEntry = z.infer<typeof NetworkEntry>

export const Breadcrumb = z.object({
  ts: z.number().int(),
  event: z.string().max(200),
  level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  data: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
})
export type Breadcrumb = z.infer<typeof Breadcrumb>

export const LogsAttachment = z.object({
  version: z.literal(1),
  console: z.array(ConsoleEntry),
  network: z.array(NetworkEntry),
  breadcrumbs: z.array(Breadcrumb),
  config: z.object({
    consoleMax: z.number(),
    networkMax: z.number(),
    breadcrumbsMax: z.number(),
    capturesBodies: z.boolean(),
    capturesAllHeaders: z.boolean(),
  }),
})
export type LogsAttachment = z.infer<typeof LogsAttachment>

export const ReportContext = z.object({
  pageUrl: z.string().url(),
  userAgent: z.string().max(1000),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  timestamp: z.string(),
  reporter: ReporterIdentity.optional(),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  systemInfo: SystemInfo.optional(),
  cookies: z.array(CookieEntry).optional(),
})
export type ReportContext = z.infer<typeof ReportContext>

export const ReportStatus = z.enum(["open", "in_progress", "resolved", "closed"])
export type ReportStatus = z.infer<typeof ReportStatus>

export const ReportPriority = z.enum(["low", "normal", "high", "urgent"])
export type ReportPriority = z.infer<typeof ReportPriority>

export const ProjectMemberRole = z.enum(["owner", "developer", "viewer"])
export type ProjectMemberRole = z.infer<typeof ProjectMemberRole>

export const ReportAssigneeDTO = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.email(),
})
export type ReportAssigneeDTO = z.infer<typeof ReportAssigneeDTO>

export const ReportEventKind = z.enum([
  "status_changed",
  "assignee_changed",
  "priority_changed",
  "tag_added",
  "tag_removed",
  "github_unlinked",
])
export type ReportEventKind = z.infer<typeof ReportEventKind>

export const ReportEventDTO = z.object({
  id: z.string().uuid(),
  createdAt: z.string(),
  actor: ReportAssigneeDTO.nullable(),
  kind: ReportEventKind,
  payload: z.record(z.string(), z.unknown()),
})
export type ReportEventDTO = z.infer<typeof ReportEventDTO>

export const TriagePatchInput = z
  .object({
    status: ReportStatus.optional(),
    assigneeId: z.string().nullable().optional(),
    priority: ReportPriority.optional(),
    tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .refine(
    (v) =>
      v.status !== undefined ||
      v.assigneeId !== undefined ||
      v.priority !== undefined ||
      v.tags !== undefined,
    { message: "At least one field must be present" },
  )
export type TriagePatchInput = z.infer<typeof TriagePatchInput>

export const BulkUpdateInput = z
  .object({
    reportIds: z.array(z.string().uuid()).min(1).max(100),
    status: ReportStatus.optional(),
    assigneeId: z.string().nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.assigneeId !== undefined, {
    message: "At least one of status or assigneeId must be present",
  })
export type BulkUpdateInput = z.infer<typeof BulkUpdateInput>

export const ReportIntakeInput = z.object({
  projectKey: z.string().regex(/^ft_pk_[A-Za-z0-9]{24}$/),
  title: z.string().min(1).max(120),
  description: z.string().max(10_000).optional(),
  context: ReportContext,
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  // Anti-abuse: honeypot (hidden field that real users never fill) and
  // dwell time in ms between widget open and submit.
  _hp: z.string().max(200).optional(),
  _dwellMs: z.number().int().min(0).max(86_400_000).optional(),
})
export type ReportIntakeInput = z.infer<typeof ReportIntakeInput>

export const AttachmentKind = z.enum(["screenshot", "annotated-screenshot", "replay", "logs"])
export type AttachmentKind = z.infer<typeof AttachmentKind>

export const AttachmentDTO = z.object({
  id: z.string().uuid(),
  kind: AttachmentKind,
  url: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
})
export type AttachmentDTO = z.infer<typeof AttachmentDTO>

export const ReportSummaryDTO = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  context: ReportContext,
  reporterEmail: z.string().nullable(),
  pageUrl: z.string(),
  thumbnailUrl: z.string().nullable(),
  hasReplay: z.boolean(),
  receivedAt: z.string(),
  updatedAt: z.string(),
  status: ReportStatus,
  priority: ReportPriority,
  tags: z.array(z.string()),
  githubIssueNumber: z.number().int().nullable(),
  githubIssueUrl: z.string().nullable(),
  assignee: ReportAssigneeDTO.nullable(),
})
export type ReportSummaryDTO = z.infer<typeof ReportSummaryDTO>

export const ReportDetailDTO = ReportSummaryDTO.extend({
  attachments: z.array(AttachmentDTO),
})
export type ReportDetailDTO = z.infer<typeof ReportDetailDTO>

export const IntakeResponse = z.object({
  id: z.string().uuid(),
  /** True when the server silently dropped the replay part (per-project or per-deployment disable). */
  replayStored: z.boolean().optional(),
  replayDisabled: z.boolean().optional(),
})
export type IntakeResponse = z.infer<typeof IntakeResponse>
