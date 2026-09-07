-- One workspace-level role per workspace member.
--
-- The same rule perm_membership_role carries one level up. A person is one
-- thing in a workspace; wanting the features of two roles is a reason to define
-- a role carrying both, or to add the feature to the role they already hold.
--
-- Safe to apply only where no workspace member already holds more than one:
--   select "workspaceMemberId" from perm_workspace_member_role
--   group by 1 having count(*) > 1;
-- must return no rows. It did when this was written.

-- CreateIndex
CREATE UNIQUE INDEX "perm_workspace_member_role_workspaceMemberId_key" ON "perm_workspace_member_role"("workspaceMemberId");
