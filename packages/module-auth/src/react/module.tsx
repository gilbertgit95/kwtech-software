import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { AUTH_FEATURE_REGISTRY } from '../features.js';
import { ForgotPasswordPage } from './forgot-password-page.js';
import { MfaChallengePage } from './mfa-challenge-page.js';
import { ResetPasswordPage } from './reset-password-page.js';
import { ProfileRouteInner } from './settings/profile-route.js';
import { SecurityPage } from './settings/security-page.js';
import { TwoFactorPage } from './settings/two-factor-page.js';
import { SignInPage } from './sign-in-page.js';

/**
 * What the app composes. Routes as DATA, because Next discovers pages from the
 * filesystem and has no plugin API — a package cannot inject a route, but it
 * can declare everything about one except the file (PLAN §9).
 *
 * None of these carry a `feature`, and that is the point: `/auth/signin` is a
 * route, not a right. With no key, the navigation filter and the middleware
 * both leave them alone — which is what stops the sign-in page being gated
 * behind being signed in.
 *
 * They declare no `nav` entry either: a menu that links to "sign in" is a menu
 * shown to someone who already did.
 */

/**
 * Each route gets a thin adapter rather than the page itself.
 *
 * The pages take the props they actually need — `token: string | null`,
 * `onSignedIn`, hrefs — which is what makes them renderable, and testable,
 * outside a router. A descriptor hands its component `params` and
 * `searchParams` and nothing else, so something has to bridge the two; doing it
 * here keeps `next/navigation` out of the module entirely.
 */
/**
 * Only app-relative paths. An absolute URL in `?next=` would make these pages an
 * open redirect: /auth/signin?next=https://evil.example sends a freshly
 * authenticated user straight to an attacker's page, wearing the trust of
 * having just arrived from yours.
 *
 * Shared by both steps of the sign-in, because the parameter is carried across
 * the 2FA challenge and a check applied to only one of two doors is not a check.
 */
function safeNext(next: string | string[] | undefined): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function SignInRoute({ searchParams }: ModuleRouteProps) {
  // ?next=/somewhere, so a guard that bounced someone here can send them back.
  return <SignInPage redirectTo={safeNext(searchParams?.next)} />;
}

function MfaChallengeRoute({ searchParams }: ModuleRouteProps) {
  return <MfaChallengePage redirectTo={safeNext(searchParams?.next)} />;
}

/*
 * ── the settings routes ────────────────────────────────────────────────────
 *
 * `chrome` is left at its default, unlike every route above: these render INSIDE
 * the app shell, next to the navigation, for someone already signed in. They are
 * the opposite case from sign-in, which is bare precisely because there is no
 * session to build a shell around.
 *
 * They carry NO `feature` key, and that is deliberate rather than an omission.
 * A feature key answers "may this person do X"; managing your own account is not
 * a grantable right, it is a consequence of having an account at all. Gating it
 * would mean an administrator could take away someone's ability to change their
 * own password — which is the opposite of what a security page is for.
 */
function ProfileRoute(_props: ModuleRouteProps) {
  /*
   * The viewer comes from the module's own client rather than a prop, because a
   * ModuleRoute is handed `params` and `searchParams` and nothing else. An app
   * that wants to pass its already-fetched viewer imports ProfilePage directly
   * — the descriptor is the zero-configuration path, not the only one.
   */
  return <ProfileRouteInner />;
}

function ForgotPasswordRoute(_props: ModuleRouteProps) {
  return <ForgotPasswordPage />;
}

function ResetPasswordRoute({ searchParams }: ModuleRouteProps) {
  const raw = searchParams?.token;
  // A repeated ?token=a&token=b is a malformed link, not a choice to make.
  const token = typeof raw === 'string' && raw.length > 0 ? raw : null;
  return <ResetPasswordPage token={token} />;
}

function SecurityRoute(_props: ModuleRouteProps) {
  return <SecurityPage />;
}

function TwoFactorRoute(_props: ModuleRouteProps) {
  return <TwoFactorPage />;
}

export const authWebModule: WebModuleDescriptor = {
  key: 'auth',
  /*
   * This module owns 'Account' — it is the only one contributing to it, and
   * these are the pages for managing the person rather than the product.
   *
   * 90 puts it last among the declared groups, which is where it renders in an
   * app that shows it in the drawer at all. This one does not: it lifts the
   * group into the header's account menu instead, and that is the app's call to
   * make — a module declares WHAT it contributes and roughly where, never which
   * chrome draws it.
   */
  navGroups: [{ group: 'Account', order: 90 }],
  /*
   * This module's rights, contributed to the shared registry — currently none.
   * Its routes need a SESSION, which JwtAuthGuard already requires, not
   * AUTHORISATION. See ../features.ts for where that line is drawn.
   */
  features: AUTH_FEATURE_REGISTRY,
  // Every route here is 'bare': these are the pages you reach BECAUSE you have
  // no session, so the app shell — whose entire content is the navigation and
  // the account menu of a signed-in user — has nothing to put in itself.
  routes: [
    { path: '/auth/signin', title: 'Sign in', component: SignInRoute, chrome: 'bare' },
    /*
     * 'bare' like the others, and for the same reason: the person reading it is
     * mid-sign-in. A shell whose content is the navigation and account menu of a
     * signed-in user has nothing to put in itself — and rendering one around a
     * half-admitted session would be the app asserting more than the API has
     * agreed to.
     */
    { path: '/auth/verify', title: 'Two-step verification', component: MfaChallengeRoute, chrome: 'bare' },
    { path: '/auth/forgot-password', title: 'Reset your password', component: ForgotPasswordRoute, chrome: 'bare' },
    { path: '/auth/reset-password', title: 'Choose a new password', component: ResetPasswordRoute, chrome: 'bare' },

    {
      path: '/settings/profile',
      title: 'Profile',
      component: ProfileRoute,
      // The group is DATA, not a location. This app renders 'Account' inside the
      // header's user menu rather than the side drawer — a module cannot know
      // that, and should not: the drawer answers "what can I do here", and your
      // own profile is a property of the person, not a place in the app.
      nav: { group: 'Account', order: 0, icon: 'user' },
    },
    {
      path: '/settings/security',
      title: 'Security',
      component: SecurityRoute,
      nav: { group: 'Account', order: 1, icon: 'shield' },
    },
    {
      // Reachable but UNLISTED: the security page links to it, and a second
      // entry beside "Security" would suggest two places to look for the same
      // concern.
      path: '/settings/two-factor',
      title: 'Two-step verification',
      component: TwoFactorRoute,
    },
  ],
};
