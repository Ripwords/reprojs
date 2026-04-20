import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core"
import { projects } from "./projects"

export const projectInvitations = pgTable(
  "project_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["owner", "developer", "viewer"] }).notNull(),
    token: text("token").notNull(),
    status: text("status", {
      enum: ["pending", "accepted", "revoked", "expired"],
    })
      .notNull()
      .default("pending"),
    invitedBy: text("invited_by").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at"),
    acceptedBy: text("accepted_by"),
  },
  (t) => ({
    tokenIdx: uniqueIndex("project_invitations_token_idx").on(t.token),
    projectEmailIdx: index("project_invitations_project_email_idx").on(t.projectId, t.email),
  }),
)

export type ProjectInvitation = typeof projectInvitations.$inferSelect
export type NewProjectInvitation = typeof projectInvitations.$inferInsert
