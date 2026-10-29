import { MobileNotice } from '@/components/mobile/mobile-screens';

/**
 * "This page isn't on the mobile view yet", in the phone frame's scrolling
 * column (issue #22). For any signed-in page the phone layout does not have:
 * the phone page's own `elsewhere`, and every desktop page `AppShell` refuses
 * to draw on a phone. On a computer viewing the phone layout it offers the
 * full site; on a phone it says to use a computer (`MobileNotice`).
 */
export function NotOnMobile() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-lg px-4 pt-2 pb-8">
        <MobileNotice
          title="This page isn't on the mobile view yet"
          body="It is on the full site, with everything your role gives you there."
          action="full_site"
        />
      </div>
    </div>
  );
}
