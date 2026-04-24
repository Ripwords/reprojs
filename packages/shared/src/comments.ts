// packages/shared/src/comments.ts
import { z } from "zod"

export const CommentAuthorDTO = z.union([
  z.object({
    kind: z.literal("dashboard"),
    id: z.string(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    githubLogin: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
  z.object({
    kind: z.literal("github"),
    githubLogin: z.string().nullable(),
    avatarUrl: z.string().nullable(),
  }),
])
export type CommentAuthorDTO = z.infer<typeof CommentAuthorDTO>

export const CommentDTO = z.object({
  id: z.string(),
  body: z.string(),
  source: z.enum(["dashboard", "github"]),
  githubCommentId: z.number().nullable(),
  author: CommentAuthorDTO,
  createdAt: z.union([z.date(), z.string()]),
  updatedAt: z.union([z.date(), z.string()]),
})
export type CommentDTO = z.infer<typeof CommentDTO>

export const CreateCommentInput = z.object({
  body: z.string().min(1).max(65_536),
})
export type CreateCommentInput = z.infer<typeof CreateCommentInput>

export const UpdateCommentInput = z.object({
  body: z.string().min(1).max(65_536),
})
export type UpdateCommentInput = z.infer<typeof UpdateCommentInput>
