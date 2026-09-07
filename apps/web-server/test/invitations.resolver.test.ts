import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IS_PUBLIC } from '@kwtech/module-auth/server';
import { HealthController } from '../src/health/health.controller.js';
import { InvitationsResolver } from '../src/invitations/invitations.resolver.js';
import { UsersResolver } from '../src/users/users.resolver.js';

/**
 * SIGN-UP IS INVITE-ONLY, and this file is what keeps it that way.
 *
 * The property is not visible in any one place: it holds because
 * `AuthService.createAccount` has no route, because the only thing that calls it
 * takes the address from an invitation rather than from its arguments, and
 * because nothing else in the app is reachable without a session. Each of those
 * is one edit away from being untrue, and none of them would fail a type check.
 *
 * So they are asserted. A future public mutation, or an `email` argument added
 * to the sign-up, breaks a test with a sentence explaining what it protected.
 */

const SCHEMA = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'schema.graphql'), 'utf8');

/** A preview as `previewInvitation` returns one. */
const invitation = (over: Record<string, unknown> = {}) => ({
  organizationId: 'org1',
  organizationName: 'Acme',
  email: 'invited@example.com',
  roleLabel: null,
  expiresAt: new Date(Date.now() + 60_000),
  ...over,
});

function harness(preview: unknown) {
  const calls = {
    createAccount: [] as { email: string; displayName: string | null; password: string }[],
    accepted: [] as { token: string; userId: string }[],
  };

  const auth = {
    createAccount: async (input: { email: string; displayName: string | null; password: string }) => {
      calls.createAccount.push(input);
      return { id: 'newuser', email: input.email, displayName: input.displayName };
    },
  };
  const permissions = {
    previewInvitation: async () => preview,
    acceptInvitation: async (input: { token: string; userId: string }) => {
      calls.accepted.push(input);
      return { organizationId: 'org1', membershipId: 'm1', joined: true };
    },
  };
  const prisma = { authUser: { findUnique: async () => null } };

  return { resolver: new InvitationsResolver(auth as never, permissions as never, prisma as never), calls };
}

describe('signing up from an invitation', () => {
  it('takes the address from the INVITATION, never from the caller', async () => {
    const h = harness(invitation());
    await h.resolver.signUpFromInvitation('tok', 'a long enough password', ' Grace ');

    /*
     * The whole reason this is invite-only rather than merely invite-shaped. If
     * the address came from the form, a valid token would be a voucher to
     * create an account at ANY address — including one that already means
     * something to somebody else.
     */
    expect(h.calls.createAccount[0]?.email).toBe('invited@example.com');
    expect(h.calls.accepted[0]).toEqual({ token: 'tok', userId: 'newuser' });
  });

  it('has no email argument to override it with', () => {
    // Structural, and checked against the GENERATED schema rather than the
    // TypeScript signature: the schema is what a caller can actually send.
    const field = /signUpFromInvitation\(([^)]*)\)/.exec(SCHEMA)?.[1] ?? '';
    expect(field).not.toMatch(/email/i);
    expect(field).toContain('token: String!');
  });

  it('creates nothing when the token is not live', async () => {
    // Unknown, revoked, already accepted, expired — `previewInvitation` answers
    // null for all four, and this is the only gate in front of account creation.
    const h = harness(null);
    await expect(h.resolver.signUpFromInvitation('stale', 'a long enough password')).rejects.toThrow();

    expect(h.calls.createAccount).toEqual([]);
    expect(h.calls.accepted).toEqual([]);
  });

  it('creates the account BEFORE accepting, so a failure leaves nothing dangling', async () => {
    const h = harness(invitation());
    await h.resolver.signUpFromInvitation('tok', 'a long enough password');

    /*
     * Order matters and is not incidental. An accepted invitation with no
     * account behind it is a membership pointing at nobody; an account in no
     * organization is recoverable — they sign in, and the still-pending
     * invitation joins them on a second try.
     */
    expect(h.calls.createAccount).toHaveLength(1);
    expect(h.calls.accepted).toHaveLength(1);
  });
});

describe('what this app exposes without a session', () => {
  /**
   * The allowlist. Adding a handler here is the deliberate act; arriving at one
   * by accident is what this prevents.
   *
   * module-auth's own public handlers — signin, refresh, forgot-password,
   * reset-password — are its business and are asserted in its suite. These are
   * the ones THIS app declares.
   */
  const ALLOWED = [
    ['HealthController.check', HealthController.prototype.check],
    ['InvitationsResolver.invitationPreview', InvitationsResolver.prototype.invitationPreview],
    ['InvitationsResolver.signUpFromInvitation', InvitationsResolver.prototype.signUpFromInvitation],
  ] as const;

  it.each(ALLOWED)('%s is public on purpose, with a stated reason', (_name, handler) => {
    // The reason string is required by the decorator, so an exception is a
    // decision on the record rather than a habit.
    expect(typeof Reflect.getMetadata(IS_PUBLIC, handler)).toBe('string');
  });

  it('has no OTHER public handler in the resolvers this app owns', () => {
    const owned = [UsersResolver, InvitationsResolver];
    const permitted = new Set(ALLOWED.map(([, handler]) => handler));

    const unexpected = owned.flatMap((cls) =>
      Object.getOwnPropertyNames(cls.prototype)
        .filter((name) => name !== 'constructor')
        .filter((name) => {
          const handler = (cls.prototype as Record<string, unknown>)[name];
          return typeof handler === 'function' && Reflect.getMetadata(IS_PUBLIC, handler) !== undefined;
        })
        .filter((name) => !permitted.has((cls.prototype as Record<string, unknown>)[name] as never))
        .map((name) => `${cls.name}.${name}`),
    );

    /*
     * A new public field is how invite-only sign-up would stop being true —
     * not by anybody deciding to change it, but by one more `@Public` on a
     * mutation that seemed harmless.
     */
    expect(unexpected).toEqual([]);
  });
});
