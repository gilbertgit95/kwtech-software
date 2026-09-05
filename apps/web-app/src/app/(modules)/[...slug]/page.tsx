import { composeRoutes, matchRouteWithParams } from '@kwtech/module-kit';
import { denialReason } from '@kwtech/module-permissions';
import { FeatureDenied } from '@kwtech/module-permissions/react';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { BareShell } from '@/components/layout/bare-shell';
import { getSessionSnapshot } from '@/lib/session-query';
import { WEB_MODULES } from '@/modules';

/**
 * One file for every module-contributed route (PLAN §12.11, strategy A).
 *
 * A REQUIRED catch-all (`[...slug]`), not an optional one. An optional
 * catch-all also matches `/`, which collides with the app's own root page and
 * Next refuses to build with both. Required is the honest shape anyway: modules
 * contribute routes under a path, and `/` belongs to the application.
 *
 * Next discovers pages from the filesystem and has no plugin API, so a package
 * cannot inject a route. It CAN declare everything about one except the file —
 * path, title, component, required feature — which is what
 * `WebModuleDescriptor` carries. This catch-all is that file.
 *
 * The cost, recorded rather than discovered later: per-route `metadata`,
 * `generateStaticParams` and nested layouts are unavailable here, because Next
 * cannot statically see the individual routes. Move to generated stubs
 * (strategy C) when routes multiply or need their own metadata — the modules
 * and this composition are identical either way, so the switch is mechanical.
 */
const ROUTES = composeRoutes(WEB_MODULES);

export default async function ModuleRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  const pathname = `/${slug.join('/')}`;

  const match = matchRouteWithParams(ROUTES, pathname);
  // A path no module claims is a 404, not a blank page — and notFound() is what
  // makes it one Next actually renders.
  if (!match) notFound();

  const { route, params: routeParams } = match;

  /*
   * THE ROUTE'S OWN FEATURE KEY, CHECKED BEFORE THE COMPONENT IS CALLED.
   *
   * `ModuleRoute.feature` used to claim it was read by the navigation filter
   * AND the middleware. Only the first was true — middleware renews a session
   * and says itself that it does not decide who may see what — so a module route
   * whose component did not gate ITSELF was reachable by anyone signed in, while
   * the descriptor said otherwise. The permissions pages all self-gate, so
   * nothing was exposed today; the next module to contribute a route would have
   * been.
   *
   * Checking here makes the promise true for every module at once, rather than
   * asking each page to remember. The pages keep their own `FeatureGate` — this
   * is a backstop, not a replacement, and defence in depth is cheap when both
   * layers read the same key.
   *
   * Still not the security boundary. Every request is authorised again at the
   * API, which is the only check someone calling it directly cannot skip.
   */
  const denied = await routeDenial(route.feature);
  if (denied) {
    return (
      <AppShell title={route.title}>
        {/*
          The module's own denial screen, not a copy of it. Both are reached by
          the same person for the same reason, and a wording change to one used
          to be a silent inconsistency in the other.
        */}
        <FeatureDenied title={route.title} reason={denied} />
      </AppShell>
    );
  }

  const Component = route.component;
  /*
   * `params` carries whatever the route's `:segments` captured — Next cannot
   * supply them here, because it sees one catch-all and not the individual
   * patterns, so module-kit does the matching and this hands the result on.
   */
  const page = <Component params={routeParams} searchParams={await searchParams} />;

  // Which shell the route asked for, declared on the descriptor rather than
  // guessed from the path here. 'app' is the default because a module route is
  // normally a page of the application; the auth routes opt out because they
  // exist for someone who has no session to put in a header.
  return route.chrome === 'bare' ? <BareShell>{page}</BareShell> : <AppShell title={route.title}>{page}</AppShell>;
}

/**
 * Whether this route should be refused, and why — or undefined to let it render.
 *
 * The two `undefined` returns are the important ones, and both were real bugs
 * waiting to happen:
 *
 *   API UNREACHABLE — not a denial. Refusing here would put "your roles do not
 *   include this" on the screen during an outage, which is the same mistake as
 *   redirecting to sign-in during one: it reports an outage as the reader's own
 *   fault. AppShell renders the outage panel and polls instead.
 *
 *   NOT SIGNED IN — also not a denial. AppShell redirects to sign-in, which is
 *   where someone with no session should land rather than on a page telling
 *   them their roles are insufficient.
 *
 * `getSessionSnapshot` is wrapped in React's `cache()`, so this call and
 * AppShell's are ONE request per render, not two.
 */
async function routeDenial(feature: string | undefined) {
  if (!feature) return undefined;

  const { viewer, permissions, reachable } = await getSessionSnapshot();
  if (!reachable || !viewer) return undefined;

  // Fails closed: a null context means "holds nothing", never "skip the check".
  if (permissions?.effective.includes(feature)) return undefined;

  return denialReason(permissions ?? undefined, [feature]) ?? 'not_granted';
}
