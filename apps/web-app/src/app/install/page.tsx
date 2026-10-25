import { InstallGuide } from '@/components/install/install-guide';
import { BareShell } from '@/components/layout/bare-shell';
import { appBrand } from '@/config/env';

/**
 * How to put this app on a phone's home screen: the address to print on a QR
 * code or send to staff.
 *
 * A real route file rather than a module descriptor, because installing belongs
 * to the APP (its manifest, its icons), not to any one module.
 *
 * Public and `BareShell`, like sign-in: the person following this link may not
 * be signed in yet, and the steps reveal nothing about anybody's account.
 * Installing happens before signing in anyway — the installed app opens on the
 * sign-in page the first time.
 *
 * ⚠ `force-dynamic`. Nothing here reads a cookie or a header, so Next would
 * prerender it at build and bake APP_NAME into the HTML — the same trap
 * manifest.ts avoids the same way.
 */
export const dynamic = 'force-dynamic';

export default function InstallPage() {
  const { name } = appBrand();
  return (
    <BareShell>
      <InstallGuide appName={name} />
    </BareShell>
  );
}
