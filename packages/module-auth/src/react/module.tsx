import type { ModuleRouteProps, WebModuleDescriptor } from '@kwtech/module-kit';
import { ForgotPasswordPage } from './forgot-password-page.js';
import { ResetPasswordPage } from './reset-password-page.js';
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
function SignInRoute({ searchParams }: ModuleRouteProps) {
  // ?next=/somewhere, so a guard that bounced someone here can send them back.
  const next = searchParams?.next;
  // Only app-relative paths. An absolute URL here would make the sign-in page
  // an open redirect: /auth/signin?next=https://evil.example sends a freshly
  // authenticated user straight to an attacker's page, wearing the trust of
  // having just arrived from yours.
  const safe = typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  return <SignInPage redirectTo={safe} />;
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

export const authWebModule: WebModuleDescriptor = {
  key: 'auth',
  routes: [
    { path: '/auth/signin', title: 'Sign in', component: SignInRoute },
    { path: '/auth/forgot-password', title: 'Reset your password', component: ForgotPasswordRoute },
    { path: '/auth/reset-password', title: 'Choose a new password', component: ResetPasswordRoute },
  ],
  // No features: this module declares no grantable rights. Authentication is
  // who you are; authorisation is module-permissions' business.
  features: [],
};
