import { z } from "zod"

const EmailDomain = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(253)
  .regex(
    /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/,
    "Must be a valid domain (e.g. acme.com)",
  )

export const AppSettingsDTO = z.object({
  signupGated: z.boolean(),
  allowedEmailDomains: z.array(z.string()),
  updatedAt: z.string(),
})
export type AppSettingsDTO = z.infer<typeof AppSettingsDTO>

export const UpdateAppSettingsInput = z.object({
  signupGated: z.boolean().optional(),
  allowedEmailDomains: z.array(EmailDomain).max(50).optional(),
})
export type UpdateAppSettingsInput = z.infer<typeof UpdateAppSettingsInput>
