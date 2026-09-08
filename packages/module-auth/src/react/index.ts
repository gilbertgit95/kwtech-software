/**
 * @kwtech/module-auth/react — the pages and the client.
 *
 * May import the core, never `/server` (PLAN §9 rule 3). That rule is what
 * keeps node:crypto and the JWT secret out of the browser bundle.
 *
 * ⚠ NAMED re-exports, never `export *`.
 *
 * Most of this barrel is `'use client'`. A Next.js app replaces such a module
 * with a client-reference proxy, and `export *` compiles to TypeScript's
 * `__exportStar`, which copies keys with `for...in` — an enumeration that
 * proxy does not answer. The re-export then yields NOTHING, and the failure
 * arrives as "Element type is invalid: ... got: undefined" at render, pointing
 * nowhere near this file.
 *
 * Nothing hits that today only because `authWebModule` reaches the pages
 * through `./module.js`, which imports them directly. The first server
 * component to import `SignInPage` from this barrel would have found it
 * undefined.
 */

export { AdminShell } from './admin/admin-shell.js';
export { UserDetailPage } from './admin/user-detail-page.js';
export { UserEditPage } from './admin/user-edit-page.js';
export { UserForm } from './admin/user-form.js';
export { UserNewPage } from './admin/user-new-page.js';
export {
  type AdminUser,
  type AdminUserDetail,
  type AdminUserFilter,
  type AdminUserSession,
  type AdminUserWriteResult,
  createUsersAdminClient,
  type UsersAdminClient,
} from './admin/users-admin-client.js';
export { UsersPage } from './admin/users-page.js';
export { type AuthActionResult, type AuthClient, AuthClientError, createAuthClient } from './auth-client.js';
export { AuthError, AuthField, AuthShell, AuthSubmit } from './auth-shell.js';
export { ForgotPasswordPage } from './forgot-password-page.js';
export { MfaChallengePage } from './mfa-challenge-page.js';
export { authWebModule } from './module.js';
export { ResetPasswordPage } from './reset-password-page.js';
export { SessionKeeper } from './session-keeper.js';
export { ProfilePage } from './settings/profile-page.js';
export { ProfileRouteInner } from './settings/profile-route.js';
export { SecurityPage } from './settings/security-page.js';
export {
  SettingsButton,
  SettingsCard,
  SettingsPage,
  SettingsResult,
} from './settings/settings-shell.js';
export { TwoFactorPage } from './settings/two-factor-page.js';
export { SignInPage } from './sign-in-page.js';
export { type AuthFormState, useAuthForm } from './use-auth-form.js';
