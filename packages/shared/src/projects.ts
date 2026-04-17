import { z } from "zod"

export const ProjectRole = z.enum(["viewer", "developer", "owner"])
export type ProjectRole = z.infer<typeof ProjectRole>

export const ProjectDTO = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
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
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9](-?[a-z0-9])*$/, "Slug must be lowercase alphanumeric with dashes")
    .optional(),
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
