import { scopePath } from '@kwtech/module-permissions';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { MobileNotice } from '@/components/mobile/mobile-screens';
import { PlaceRow, PlaceSection } from '@/components/mobile/place-sections';

/**
 * Where to go, when the phone could not decide for the person (issue #22).
 *
 * ONE LEVEL PER VIEW, as in the switcher sheet: either the organizations to
 * choose between, or the workspaces of one — never both on one screen, which
 * is what made the first version confusing (the operator, 2026-10-29).
 *
 *   organizations  `/` with several organizations and none remembered, or
 *                  `/?choose=organization`. Each row opens that organization's
 *                  own address, which shows its workspaces.
 *   workspaces     `/organizations/:id`. "‹ Organizations" goes back to the
 *                  list when there is more than one.
 *
 * Only shown when there is a real choice. One organization and one workspace
 * never reach this — `getMobilePlace` selects them.
 */
export function PlacePicker({
  greeting,
  organization,
  workspaces,
  organizations,
}: {
  greeting: string;
  /** Whose workspaces to show. Null: show the organizations instead. */
  organization: { id: string; name: string } | null;
  workspaces: readonly { id: string; name: string; detail: string | null }[];
  organizations: readonly { id: string; name: string; detail: string | null }[];
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-lg md:max-w-2xl space-y-4 px-4 pt-6 pb-8">
        <div className="pb-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{greeting}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {organization ? 'Choose the workspace to open.' : 'Choose an organization to see its workspaces.'}
          </p>
        </div>

        {organizations.length === 0 ? (
          <MobileNotice
            title="You're not in any workspace yet"
            body="When somebody adds you to one, it will be here."
            action={null}
          />
        ) : null}

        {organization ? (
          <WorkspaceView organization={organization} workspaces={workspaces} backToList={organizations.length > 1} />
        ) : null}

        {!organization && organizations.length > 0 ? (
          <PlaceSection level="organization" title="Organizations" caption="Choose one to see its workspaces">
            {organizations.map((one) => (
              <PlaceRow
                key={one.id}
                level="organization"
                href={scopePath({ organizationId: one.id })}
                name={one.name}
                detail={one.detail}
              />
            ))}
          </PlaceSection>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceView({
  organization,
  workspaces,
  backToList,
}: {
  organization: { id: string; name: string };
  workspaces: readonly { id: string; name: string; detail: string | null }[];
  backToList: boolean;
}) {
  return (
    <>
      {backToList ? (
        <Link
          href="/?choose=organization"
          className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 pr-3 text-sm font-medium text-primary transition-colors active:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft aria-hidden className="size-4" />
          Organizations
        </Link>
      ) : null}
      {workspaces.length > 0 ? (
        <PlaceSection level="workspace" title="Workspaces" caption={`In ${organization.name}`}>
          {workspaces.map((workspace) => (
            <PlaceRow
              key={workspace.id}
              level="workspace"
              href={scopePath({ organizationId: organization.id, workspaceId: workspace.id })}
              name={workspace.name}
              detail={workspace.detail}
            />
          ))}
        </PlaceSection>
      ) : (
        <MobileNotice
          title="No workspace to open here"
          body={`Ask an administrator of ${organization.name} to add you to a workspace.`}
          action={null}
        />
      )}
    </>
  );
}
