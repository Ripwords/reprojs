import { z } from "zod"

export const ReporterIdentity = z.object({
  userId: z.string().optional(),
  email: z.string().email().optional(),
  name: z.string().max(200).optional(),
})
export type ReporterIdentity = z.infer<typeof ReporterIdentity>

export const ReportContext = z.object({
  pageUrl: z.string().url(),
  userAgent: z.string().max(1000),
  viewport: z.object({ w: z.number().int().positive(), h: z.number().int().positive() }),
  timestamp: z.string(),
  reporter: ReporterIdentity.optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
})
export type ReportContext = z.infer<typeof ReportContext>

export const ReportIntakeInput = z.object({
  projectKey: z.string().regex(/^ft_pk_[A-Za-z0-9]{24}$/),
  title: z.string().min(1).max(120),
  description: z.string().max(10_000).optional(),
  context: ReportContext,
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
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
  reporterEmail: z.string().nullable(),
  pageUrl: z.string(),
  receivedAt: z.string(),
  thumbnailUrl: z.string().nullable(),
})
export type ReportSummaryDTO = z.infer<typeof ReportSummaryDTO>

export const ReportDetailDTO = ReportSummaryDTO.extend({
  description: z.string().nullable(),
  context: ReportContext,
  attachments: z.array(AttachmentDTO),
})
export type ReportDetailDTO = z.infer<typeof ReportDetailDTO>
