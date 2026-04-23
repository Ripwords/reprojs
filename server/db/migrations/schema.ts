import {
  pgTable,
  check,
  integer,
  boolean,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  index,
  foreignKey,
  jsonb,
  real,
  bigint,
  primaryKey,
  pgEnum,
} from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const githubWriteLockKind = pgEnum("github_write_lock_kind", [
  "labels",
  "assignees",
  "milestone",
  "state",
  "title",
  "comment_upsert",
  "comment_delete",
])
export const identityProvider = pgEnum("identity_provider", ["github"])
export const reportCommentSource = pgEnum("report_comment_source", ["dashboard", "github"])

export const appSettings = pgTable(
  "app_settings",
  {
    id: integer().default(1).primaryKey().notNull(),
    signupGated: boolean("signup_gated").default(false).notNull(),
    allowedEmailDomains: text("allowed_email_domains").array().default([""]).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [check("app_settings_singleton", sql`id = 1`)],
)

export const githubApp = pgTable(
  "github_app",
  {
    id: integer().default(1).primaryKey().notNull(),
    appId: text("app_id").notNull(),
    slug: text().notNull(),
    privateKey: text("private_key").notNull(),
    webhookSecret: text("webhook_secret").notNull(),
    clientId: text("client_id").notNull(),
    clientSecret: text("client_secret").notNull(),
    htmlUrl: text("html_url").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [check("github_app_singleton", sql`id = 1`)],
)

export const user = pgTable(
  "user",
  {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    email: text().notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
    role: text().default("member"),
    status: text().default("active"),
  },
  (table) => [unique("user_email_unique").on(table.email)],
)

export const projects = pgTable(
  "projects",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    name: varchar({ length: 120 }).notNull(),
    createdBy: text("created_by").notNull(),
    publicKey: text("public_key"),
    allowedOrigins: text("allowed_origins").array().default([""]).notNull(),
    dailyReportCap: integer("daily_report_cap").default(1000).notNull(),
    replayEnabled: boolean("replay_enabled").default(true).notNull(),
    publicKeyRegeneratedAt: timestamp("public_key_regenerated_at", { mode: "string" })
      .defaultNow()
      .notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    deletedAt: timestamp("deleted_at", { mode: "string" }),
  },
  (table) => [
    uniqueIndex("projects_public_key_idx").using(
      "btree",
      table.publicKey.asc().nullsLast().op("text_ops"),
    ),
  ],
)

export const account = pgTable(
  "account",
  {
    id: text().primaryKey().notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { mode: "string" }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { mode: "string" }),
    scope: text(),
    password: text(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("account_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "account_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
)

export const session = pgTable(
  "session",
  {
    id: text().primaryKey().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    token: text().notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id").notNull(),
  },
  (table) => [
    index("session_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "session_user_id_user_id_fk",
    }).onDelete("cascade"),
    unique("session_token_unique").on(table.token),
  ],
)

export const projectInvitations = pgTable(
  "project_invitations",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    projectId: uuid("project_id").notNull(),
    email: text().notNull(),
    role: text().notNull(),
    token: text().notNull(),
    status: text().default("pending").notNull(),
    invitedBy: text("invited_by").notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "string" }),
    acceptedBy: text("accepted_by"),
  },
  (table) => [
    index("project_invitations_project_email_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("text_ops"),
      table.email.asc().nullsLast().op("text_ops"),
    ),
    uniqueIndex("project_invitations_token_idx").using(
      "btree",
      table.token.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "project_invitations_project_id_projects_id_fk",
    }).onDelete("cascade"),
  ],
)

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey().notNull(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp("expires_at", { mode: "string" }).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).notNull(),
  },
  (table) => [
    index("verification_identifier_idx").using(
      "btree",
      table.identifier.asc().nullsLast().op("text_ops"),
    ),
  ],
)

export const reports = pgTable(
  "reports",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    projectId: uuid("project_id").notNull(),
    title: text().notNull(),
    description: text(),
    context: jsonb().default({}).notNull(),
    origin: text(),
    ip: text(),
    status: text().default("open").notNull(),
    assigneeId: text("assignee_id"),
    priority: text().default("normal").notNull(),
    tags: text().array().default([""]).notNull(),
    source: text().default("web").notNull(),
    devicePlatform: text("device_platform"),
    idempotencyKey: text("idempotency_key"),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    githubIssueNumber: integer("github_issue_number"),
    githubIssueNodeId: text("github_issue_node_id"),
    githubIssueUrl: text("github_issue_url"),
    milestoneNumber: integer("milestone_number"),
    milestoneTitle: text("milestone_title"),
    githubSyncedAt: timestamp("github_synced_at", { withTimezone: true, mode: "string" }),
    githubCommentsSyncedAt: timestamp("github_comments_synced_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    index("reports_github_issue_number_idx")
      .using("btree", table.githubIssueNumber.asc().nullsLast().op("int4_ops"))
      .where(sql`(github_issue_number IS NOT NULL)`),
    index("reports_project_assignee_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("uuid_ops"),
      table.assigneeId.asc().nullsLast().op("text_ops"),
    ),
    index("reports_project_created_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("uuid_ops"),
      table.createdAt.desc().nullsFirst().op("timestamp_ops"),
    ),
    index("reports_project_idempotency_key_idx")
      .using(
        "btree",
        table.projectId.asc().nullsLast().op("text_ops"),
        table.idempotencyKey.asc().nullsLast().op("text_ops"),
      )
      .where(sql`(idempotency_key IS NOT NULL)`),
    index("reports_project_priority_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("text_ops"),
      table.priority.asc().nullsLast().op("uuid_ops"),
    ),
    index("reports_project_source_created_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("timestamp_ops"),
      table.source.asc().nullsLast().op("text_ops"),
      table.createdAt.desc().nullsFirst().op("uuid_ops"),
    ),
    index("reports_project_status_created_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("timestamp_ops"),
      table.status.asc().nullsLast().op("timestamp_ops"),
      table.createdAt.desc().nullsFirst().op("timestamp_ops"),
    ),
    index("reports_project_updated_at_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("timestamp_ops"),
      table.updatedAt.desc().nullsFirst().op("uuid_ops"),
    ),
    index("reports_tags_gin_idx").using("gin", table.tags.asc().nullsLast().op("array_ops")),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "reports_project_id_projects_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.assigneeId],
      foreignColumns: [user.id],
      name: "reports_assignee_id_user_id_fk",
    }).onDelete("set null"),
  ],
)

export const reportEvents = pgTable(
  "report_events",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reportId: uuid("report_id").notNull(),
    projectId: uuid("project_id").notNull(),
    actorId: text("actor_id"),
    kind: text().notNull(),
    payload: jsonb().default({}).notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("report_events_project_created_at_idx").using(
      "btree",
      table.projectId.asc().nullsLast().op("timestamp_ops"),
      table.createdAt.desc().nullsFirst().op("timestamp_ops"),
    ),
    index("report_events_report_created_idx").using(
      "btree",
      table.reportId.asc().nullsLast().op("timestamp_ops"),
      table.createdAt.desc().nullsFirst().op("timestamp_ops"),
    ),
    foreignKey({
      columns: [table.reportId],
      foreignColumns: [reports.id],
      name: "report_events_report_id_reports_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "report_events_project_id_projects_id_fk",
    }).onDelete("cascade"),
  ],
)

export const rateLimitBuckets = pgTable("rate_limit_buckets", {
  key: text().primaryKey().notNull(),
  tokens: real().notNull(),
  // You can use { mode: "bigint" } if numbers are exceeding js number limitations
  lastRefillMs: bigint("last_refill_ms", { mode: "number" }).notNull(),
})

export const githubIntegrations = pgTable(
  "github_integrations",
  {
    projectId: uuid("project_id").primaryKey().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    installationId: bigint("installation_id", { mode: "number" }).notNull(),
    repoOwner: text("repo_owner").default("").notNull(),
    repoName: text("repo_name").default("").notNull(),
    defaultLabels: text("default_labels").array().default([""]).notNull(),
    defaultAssignees: text("default_assignees").array().default([""]).notNull(),
    status: text().default("connected").notNull(),
    lastError: text("last_error"),
    connectedBy: text("connected_by"),
    connectedAt: timestamp("connected_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
    autoCreateOnIntake: boolean("auto_create_on_intake").default(false).notNull(),
    pushOnEdit: boolean("push_on_edit").default(false).notNull(),
    labelsLastSyncedAt: timestamp("labels_last_synced_at", { withTimezone: true, mode: "string" }),
    milestonesLastSyncedAt: timestamp("milestones_last_synced_at", {
      withTimezone: true,
      mode: "string",
    }),
    membersLastSyncedAt: timestamp("members_last_synced_at", {
      withTimezone: true,
      mode: "string",
    }),
  },
  (table) => [
    index("github_integrations_installation_id_idx").using(
      "btree",
      table.installationId.asc().nullsLast().op("int8_ops"),
    ),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "github_integrations_project_id_projects_id_fk",
    }).onDelete("cascade"),
  ],
)

export const reportSyncJobs = pgTable(
  "report_sync_jobs",
  {
    reportId: uuid("report_id").primaryKey().notNull(),
    state: text().default("pending").notNull(),
    attempts: integer().default(0).notNull(),
    lastError: text("last_error"),
    nextAttemptAt: timestamp("next_attempt_at", { mode: "string" }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("report_sync_jobs_failed_idx")
      .using("btree", table.state.asc().nullsLast().op("text_ops"))
      .where(sql`(state = 'failed'::text)`),
    index("report_sync_jobs_pending_idx")
      .using("btree", table.nextAttemptAt.asc().nullsLast().op("timestamp_ops"))
      .where(sql`(state = 'pending'::text)`),
    foreignKey({
      columns: [table.reportId],
      foreignColumns: [reports.id],
      name: "report_sync_jobs_report_id_reports_id_fk",
    }).onDelete("cascade"),
  ],
)

export const reportAttachments = pgTable(
  "report_attachments",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reportId: uuid("report_id").notNull(),
    kind: text().notNull(),
    storageKey: text("storage_key").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    createdAt: timestamp("created_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("report_attachments_report_idx").using(
      "btree",
      table.reportId.asc().nullsLast().op("uuid_ops"),
    ),
    foreignKey({
      columns: [table.reportId],
      foreignColumns: [reports.id],
      name: "report_attachments_report_id_reports_id_fk",
    }).onDelete("cascade"),
    check(
      "report_attachments_kind_check",
      sql`kind = ANY (ARRAY['screenshot'::text, 'annotated-screenshot'::text, 'replay'::text, 'logs'::text])`,
    ),
  ],
)

export const githubWriteLocks = pgTable(
  "github_write_locks",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reportId: uuid("report_id").notNull(),
    kind: githubWriteLockKind().notNull(),
    signature: text().notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }).notNull(),
  },
  (table) => [
    index("github_write_locks_lookup_idx").using(
      "btree",
      table.reportId.asc().nullsLast().op("timestamptz_ops"),
      table.kind.asc().nullsLast().op("enum_ops"),
      table.expiresAt.asc().nullsLast().op("enum_ops"),
    ),
    foreignKey({
      columns: [table.reportId],
      foreignColumns: [reports.id],
      name: "github_write_locks_report_id_reports_id_fk",
    }).onDelete("cascade"),
  ],
)

export const githubWebhookDeliveries = pgTable(
  "github_webhook_deliveries",
  {
    deliveryId: text("delivery_id").primaryKey().notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("github_webhook_deliveries_received_at_idx").using(
      "btree",
      table.receivedAt.asc().nullsLast().op("timestamptz_ops"),
    ),
  ],
)

export const reportComments = pgTable(
  "report_comments",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    reportId: uuid("report_id").notNull(),
    userId: text("user_id"),
    githubLogin: text("github_login"),
    body: text().notNull(),
    // You can use { mode: "bigint" } if numbers are exceeding js number limitations
    githubCommentId: bigint("github_comment_id", { mode: "number" }),
    source: reportCommentSource().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    index("report_comments_report_created_idx").using(
      "btree",
      table.reportId.asc().nullsLast().op("timestamptz_ops"),
      table.createdAt.asc().nullsLast().op("timestamptz_ops"),
    ),
    foreignKey({
      columns: [table.reportId],
      foreignColumns: [reports.id],
      name: "report_comments_report_id_reports_id_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "report_comments_user_id_user_id_fk",
    }).onDelete("set null"),
    unique("report_comments_github_comment_id_unique").on(table.githubCommentId),
  ],
)

export const userIdentities = pgTable(
  "user_identities",
  {
    id: uuid().defaultRandom().primaryKey().notNull(),
    userId: text("user_id").notNull(),
    provider: identityProvider().notNull(),
    externalId: text("external_id").notNull(),
    externalHandle: text("external_handle").notNull(),
    externalName: text("external_name"),
    externalEmail: text("external_email"),
    externalAvatarUrl: text("external_avatar_url"),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "string" }).defaultNow().notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true, mode: "string" })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_identities_provider_external_id_unique").using(
      "btree",
      table.provider.asc().nullsLast().op("text_ops"),
      table.externalId.asc().nullsLast().op("text_ops"),
    ),
    uniqueIndex("user_identities_user_provider_unique").using(
      "btree",
      table.userId.asc().nullsLast().op("text_ops"),
      table.provider.asc().nullsLast().op("text_ops"),
    ),
    foreignKey({
      columns: [table.userId],
      foreignColumns: [user.id],
      name: "user_identities_user_id_user_id_fk",
    }).onDelete("cascade"),
  ],
)

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: uuid("project_id").notNull(),
    userId: text("user_id").notNull(),
    role: text().notNull(),
    invitedBy: text("invited_by"),
    joinedAt: timestamp("joined_at", { mode: "string" }).defaultNow().notNull(),
  },
  (table) => [
    index("project_members_user_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
    foreignKey({
      columns: [table.projectId],
      foreignColumns: [projects.id],
      name: "project_members_project_id_projects_id_fk",
    }).onDelete("cascade"),
    primaryKey({
      columns: [table.projectId, table.userId],
      name: "project_members_project_id_user_id_pk",
    }),
  ],
)
