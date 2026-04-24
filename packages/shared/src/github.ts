// packages/shared/src/github.ts
import { z } from "zod"

export const GithubConfigDTO = z.object({
  installed: z.boolean(),
  status: z.enum(["connected", "disconnected"]).nullable(),
  repoOwner: z.string(),
  repoName: z.string(),
  defaultLabels: z.array(z.string()),
  defaultAssignees: z.array(z.string()),
  pushOnEdit: z.boolean(),
  autoCreateOnIntake: z.boolean(),
  lastSyncedAt: z.string().nullable(),
  failedJobs: z.array(
    z.object({
      reportId: z.uuid(),
      reportTitle: z.string(),
      attempts: z.number().int(),
      lastError: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
})
export type GithubConfigDTO = z.infer<typeof GithubConfigDTO>

export const UpdateGithubConfigInput = z.object({
  repoOwner: z.string().min(1).max(100).optional(),
  repoName: z.string().min(1).max(100).optional(),
  defaultLabels: z.array(z.string().min(1).max(50)).max(20).optional(),
  defaultAssignees: z.array(z.string().min(1).max(50)).max(20).optional(),
  pushOnEdit: z.boolean().optional(),
  autoCreateOnIntake: z.boolean().optional(),
})
export type UpdateGithubConfigInput = z.infer<typeof UpdateGithubConfigInput>

export const InstallRedirectResponse = z.object({ url: z.string().url() })
export type InstallRedirectResponse = z.infer<typeof InstallRedirectResponse>

// POST /api/projects/:id/integrations/github/labels — create a new label on
// the linked repo. Colour defaults server-side when omitted. GitHub enforces
// a 50-char name limit and allows only hex (no leading #), so we normalise
// before validating.
export const CreateGithubLabelInput = z.object({
  name: z.string().trim().min(1).max(50),
  color: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, "color must be a 6-char hex")
    .optional(),
  description: z.string().max(100).optional(),
})
export type CreateGithubLabelInput = z.infer<typeof CreateGithubLabelInput>
