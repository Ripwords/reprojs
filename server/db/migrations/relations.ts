import { relations } from "drizzle-orm/relations"
import {
  user,
  account,
  session,
  projects,
  projectInvitations,
  reports,
  reportEvents,
  githubIntegrations,
  reportSyncJobs,
  reportAttachments,
  githubWriteLocks,
  reportComments,
  userIdentities,
  projectMembers,
} from "./schema"

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}))

export const userRelations = relations(user, ({ many }) => ({
  accounts: many(account),
  sessions: many(session),
  reports: many(reports),
  reportComments: many(reportComments),
  userIdentities: many(userIdentities),
}))

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}))

export const projectInvitationsRelations = relations(projectInvitations, ({ one }) => ({
  project: one(projects, {
    fields: [projectInvitations.projectId],
    references: [projects.id],
  }),
}))

export const projectsRelations = relations(projects, ({ many }) => ({
  projectInvitations: many(projectInvitations),
  reports: many(reports),
  reportEvents: many(reportEvents),
  githubIntegrations: many(githubIntegrations),
  projectMembers: many(projectMembers),
}))

export const reportsRelations = relations(reports, ({ one, many }) => ({
  project: one(projects, {
    fields: [reports.projectId],
    references: [projects.id],
  }),
  user: one(user, {
    fields: [reports.assigneeId],
    references: [user.id],
  }),
  reportEvents: many(reportEvents),
  reportSyncJobs: many(reportSyncJobs),
  reportAttachments: many(reportAttachments),
  githubWriteLocks: many(githubWriteLocks),
  reportComments: many(reportComments),
}))

export const reportEventsRelations = relations(reportEvents, ({ one }) => ({
  report: one(reports, {
    fields: [reportEvents.reportId],
    references: [reports.id],
  }),
  project: one(projects, {
    fields: [reportEvents.projectId],
    references: [projects.id],
  }),
}))

export const githubIntegrationsRelations = relations(githubIntegrations, ({ one }) => ({
  project: one(projects, {
    fields: [githubIntegrations.projectId],
    references: [projects.id],
  }),
}))

export const reportSyncJobsRelations = relations(reportSyncJobs, ({ one }) => ({
  report: one(reports, {
    fields: [reportSyncJobs.reportId],
    references: [reports.id],
  }),
}))

export const reportAttachmentsRelations = relations(reportAttachments, ({ one }) => ({
  report: one(reports, {
    fields: [reportAttachments.reportId],
    references: [reports.id],
  }),
}))

export const githubWriteLocksRelations = relations(githubWriteLocks, ({ one }) => ({
  report: one(reports, {
    fields: [githubWriteLocks.reportId],
    references: [reports.id],
  }),
}))

export const reportCommentsRelations = relations(reportComments, ({ one }) => ({
  report: one(reports, {
    fields: [reportComments.reportId],
    references: [reports.id],
  }),
  user: one(user, {
    fields: [reportComments.userId],
    references: [user.id],
  }),
}))

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
  user: one(user, {
    fields: [userIdentities.userId],
    references: [user.id],
  }),
}))

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, {
    fields: [projectMembers.projectId],
    references: [projects.id],
  }),
}))
