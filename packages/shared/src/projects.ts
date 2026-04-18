import { z } from "zod"
import { ReportEventKind, ReportPriority, ReportStatus } from "./reports"

export const ProjectRole = z.enum(["viewer", "developer", "owner"])
export type ProjectRole = z.infer<typeof ProjectRole>

export const ProjectDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  effectiveRole: ProjectRole,
  publicKey: z.string().nullable(),
  allowedOrigins: z.array(z.string()),
})
export type ProjectDTO = z.infer<typeof ProjectDTO>

export const CreateProjectInput = z.object({
  name: z.string().min(1).max(80),
})
export type CreateProjectInput = z.infer<typeof CreateProjectInput>

export const UpdateProjectInput = z.object({
  name: z.string().min(1).max(80).optional(),
  allowedOrigins: z.array(z.string().url()).max(20).optional(),
})
export type UpdateProjectInput = z.infer<typeof UpdateProjectInput>

export const ProjectMemberDTO = z.object({
  userId: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: ProjectRole,
  joinedAt: z.string(),
})
export type ProjectMemberDTO = z.infer<typeof ProjectMemberDTO>

export const AddProjectMemberInput = z.object({
  email: z.string().email(),
  role: ProjectRole,
})
export type AddProjectMemberInput = z.infer<typeof AddProjectMemberInput>

export const UpdateProjectMemberInput = z.object({
  role: ProjectRole,
})
export type UpdateProjectMemberInput = z.infer<typeof UpdateProjectMemberInput>

export const ProjectOverviewDTO = z.object({
  counts: z.object({
    total: z.number().int(),
    byStatus: z.record(ReportStatus, z.number().int()),
    byPriority: z.record(ReportPriority, z.number().int()),
    last7Days: z.number().int(),
  }),
  volume: z.array(
    z.object({
      date: z.string(), // YYYY-MM-DD
      count: z.number().int(),
    }),
  ),
  github: z.object({
    installed: z.boolean(),
    status: z.enum(["connected", "disconnected"]).nullable(),
    repo: z.string().nullable(),
    linkedCount: z.number().int(),
    failedCount: z.number().int(),
    pendingCount: z.number().int(),
    syncingCount: z.number().int(),
    lastSyncedAt: z.string().nullable(),
  }),
  recentEvents: z.array(
    z.object({
      id: z.string().uuid(),
      reportId: z.string().uuid(),
      reportTitle: z.string(),
      kind: ReportEventKind,
      payload: z.record(z.string(), z.unknown()),
      actor: z
        .object({
          id: z.string(),
          email: z.string().email(),
          name: z.string().nullable(),
        })
        .nullable(),
      createdAt: z.string(),
    }),
  ),
})
export type ProjectOverviewDTO = z.infer<typeof ProjectOverviewDTO>
