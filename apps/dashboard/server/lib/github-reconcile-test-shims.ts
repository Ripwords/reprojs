// apps/dashboard/server/lib/github-reconcile-test-shims.ts
//
// Test-only Octokit shims that keep `github-reconcile.ts` simple.
//
// Context: early integration tests injected a minimal `GitHubInstallationClient`
// mock via `__setClientOverride()` with only the facade methods (getIssue,
// closeIssue, updateIssueLabels, …). After Phase 2 added title/milestone/
// assignee reconcile, the reconciler needs a raw Octokit internally —
// `loadCurrentGithubIssue()` calls `client.rest.issues.get(...)` directly.
//
// Rather than migrate every legacy test to the newer `getRichIssue` /
// `getRawOctokit` contract at once, the reconciler routes through these
// shims when it detects a facade-only mock. New tests use `getRichIssue` +
// `getRawOctokit` and bypass this module entirely.
//
// **Production code does NOT hit this path** — `__setClientOverride()` is
// test-only. Quarantining the shims in a separate module keeps the
// reconciler readable and makes it obvious where the tech debt lives.
//
// TODO: migrate the remaining facade-only tests to the rich-issue contract
// and delete this file.

import type { GitHubInstallationClient } from "@reprojs/integrations-github"
import type { Octokit } from "@octokit/rest"

/**
 * No-op shim for tests that verify reconcile behaviour through a facade mock
 * (calls counted on a per-method array) rather than spying on raw Octokit.
 */
export function buildNoopOctokitShim(
  calls: {
    closeIssue?: Array<Record<string, unknown>>
    reopenIssue?: Array<Record<string, unknown>>
    updateIssueLabels?: Array<Record<string, unknown>>
    updateIssueTitle?: Array<Record<string, unknown>>
    updateIssueMilestone?: Array<Record<string, unknown>>
    updateAssignees?: Array<Record<string, unknown>>
  } = {},
): Octokit {
  return {
    rest: {
      issues: {
        get: async () => ({ data: {} as never }),
        setLabels: async (args: Record<string, unknown>) => {
          calls.updateIssueLabels?.push(args)
        },
        update: async (args: Record<string, unknown>) => {
          if ("state" in args) {
            const state = args.state as string
            if (state === "closed") calls.closeIssue?.push(args)
            else calls.reopenIssue?.push(args)
          }
          if ("title" in args) calls.updateIssueTitle?.push(args)
          if ("milestone" in args) calls.updateIssueMilestone?.push(args)
        },
        addAssignees: async (args: Record<string, unknown>) => {
          calls.updateAssignees?.push(args)
        },
        removeAssignees: async (args: Record<string, unknown>) => {
          calls.updateAssignees?.push(args)
        },
      },
    },
  } as unknown as Octokit
}

/**
 * Legacy test path: the facade mock provides only `getIssue` (state + labels).
 * Build an Octokit-shape shim that routes `rest.issues.update/setLabels` back
 * through the facade mock so call counts / assertions still work.
 *
 * `client._calls` (if the test exposes it) receives raw-call records for the
 * new paths (title, milestone) so tests can assert against them without
 * having to mock the full Octokit write surface.
 */
export function buildFacadeRoutingOctokitShim(client: GitHubInstallationClient): Octokit {
  const calls = (client as unknown as Record<string, unknown[]>)._calls as
    | Record<string, Array<Record<string, unknown>>>
    | undefined
  return {
    rest: {
      issues: {
        get: async () => ({ data: {} as never }),
        setLabels: async (args: Record<string, unknown>) => {
          await client.updateIssueLabels({
            owner: args.owner as string,
            repo: args.repo as string,
            number: args.issue_number as number,
            labels: args.labels as string[],
          })
        },
        update: async (args: Record<string, unknown>) => {
          const state = args.state as string | undefined
          if (state === "closed") {
            await client.closeIssue({
              owner: args.owner as string,
              repo: args.repo as string,
              number: args.issue_number as number,
              reason: args.state_reason as "completed" | "not_planned" | undefined,
            })
          } else if (state === "open") {
            await client.reopenIssue({
              owner: args.owner as string,
              repo: args.repo as string,
              number: args.issue_number as number,
            })
          }
          if (args.title !== undefined && calls) {
            calls.updateIssueTitle = calls.updateIssueTitle ?? []
            calls.updateIssueTitle.push(args)
          }
          if (args.milestone !== undefined && calls) {
            calls.updateIssueMilestone = calls.updateIssueMilestone ?? []
            calls.updateIssueMilestone.push(args)
          }
        },
        addAssignees: async () => {},
        removeAssignees: async () => {},
      },
    },
  } as unknown as Octokit
}
