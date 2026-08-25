import { composeRoutes, matchRoute } from '@kwtech/module-kit';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { BareShell } from '@/components/layout/bare-shell';
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

  const route = matchRoute(ROUTES, pathname);
  // A path no module claims is a 404, not a blank page — and notFound() is what
  // makes it one Next actually renders.
  if (!route) notFound();

  const Component = route.component;
  const page = <Component searchParams={await searchParams} />;

  // Which shell the route asked for, declared on the descriptor rather than
  // guessed from the path here. 'app' is the default because a module route is
  // normally a page of the application; the auth routes opt out because they
  // exist for someone who has no session to put in a header.
  return route.chrome === 'bare' ? <BareShell>{page}</BareShell> : <AppShell title={route.title}>{page}</AppShell>;
}
