-- One organization-level role per member.
--
-- A person is one thing in an organization. Wanting the rights of two roles is
-- a reason to define a third carrying both, not a reason to stack them.
--
-- Safe to apply only where no membership already holds more than one role:
--   select "membershipId" from perm_membership_role group by 1 having count(*) > 1;
-- must return no rows. It did when this was written.

-- CreateIndex
CREATE UNIQUE INDEX "perm_membership_role_membershipId_key" ON "perm_membership_role"("membershipId");
