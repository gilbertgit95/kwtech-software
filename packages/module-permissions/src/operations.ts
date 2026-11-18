/**
 * GraphQL documents this module's clients send, validated against the served
 * schema by `apps/web-server/test/module-operations.test.ts`.
 *
 * Started with #99 and holding only what was written since. The module's
 * older documents are inline in `react/permissions-client.ts` and the app's
 * `session-query.ts` (marked Legacy in `.claude/rules/modules.md`), so they
 * escape that validation; moving them here is its own change, not a side
 * effect of this one.
 */
export const PERMISSIONS_OPERATIONS = {
  /** The seeded roles holding a feature, for a `not_granted` refusal to name (#99). Unguarded; see the resolver. */
  featureHolders: `
    query PermissionFeatureHolders($feature: String!) {
      permissionFeatureHolders(feature: $feature) {
        featureKey
        featureLabel
        featureLevel
        roles { key label level description }
      }
    }
  `,
  accessExplanation: `
    query PermissionAccessExplanation($organizationId: String!, $workspaceId: String, $userId: String!) {
      permissionAccessExplanation(organizationId: $organizationId, workspaceId: $workspaceId, userId: $userId) {
        userId
        organizationId
        workspaceId
        self
        subscriptionEndedAt
        lines {
          key
          label
          description
          module
          level
          verdict
          grantedBy
          viaPlatformRole
          inPlans
          holders { key label level description }
        }
      }
    }
  `,
} as const;
