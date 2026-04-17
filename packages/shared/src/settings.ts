import { z } from "zod"

export const AppSettingsDTO = z.object({
  signupGated: z.boolean(),
  installName: z.string(),
  updatedAt: z.string(),
})
export type AppSettingsDTO = z.infer<typeof AppSettingsDTO>

export const UpdateAppSettingsInput = z.object({
  signupGated: z.boolean().optional(),
  installName: z.string().min(1).max(80).optional(),
})
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsInput>
