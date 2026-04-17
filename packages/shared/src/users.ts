import { z } from "zod"

export const InstallRole = z.enum(["admin", "member"])
export type InstallRole = z.infer<typeof InstallRole>

export const UserStatus = z.enum(["invited", "active", "disabled"])
export type UserStatus = z.infer<typeof UserStatus>

export const UserDTO = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  role: InstallRole,
  status: UserStatus,
  emailVerified: z.boolean(),
  createdAt: z.string(),
})
export type UserDTO = z.infer<typeof UserDTO>

export const InviteUserInput = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  role: InstallRole.default("member"),
})
export type InviteUserInput = z.infer<typeof InviteUserInput>

export const UpdateUserInput = z.object({
  role: InstallRole.optional(),
  status: UserStatus.optional(),
})
export type UpdateUserInput = z.infer<typeof UpdateUserInput>

export const AcceptInviteInput = z.object({
  token: z.string().min(10),
  password: z.string().min(8).max(120),
})
export type AcceptInviteInput = z.infer<typeof AcceptInviteInput>
