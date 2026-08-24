-- CreateEnum
CREATE TYPE "AuthUserStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "AuthCredentialType" AS ENUM ('password');

-- CreateEnum
CREATE TYPE "AuthIdentityProvider" AS ENUM ('google', 'microsoft');

-- CreateEnum
CREATE TYPE "PermRoleLevel" AS ENUM ('app', 'organization', 'workspace');

-- CreateEnum
CREATE TYPE "PermMembershipStatus" AS ENUM ('active', 'invited', 'suspended');

-- CreateEnum
CREATE TYPE "PermSubscriptionStatus" AS ENUM ('active', 'past_due', 'canceled');

-- CreateTable
CREATE TABLE "auth_user" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "status" "AuthUserStatus" NOT NULL DEFAULT 'active',
    "emailVerifiedAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_identity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthIdentityProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "email" TEXT,
    "emailVerifiedByProvider" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3),

    CONSTRAINT "auth_identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_credential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "AuthCredentialType" NOT NULL,
    "secret" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_credential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_password_reset" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "requestedIp" TEXT,

    CONSTRAINT "auth_password_reset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perm_organization" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "perm_organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perm_workspace" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "perm_workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perm_workspace_member" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perm_workspace_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perm_workspace_member_role" (
    "workspaceMemberId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perm_workspace_member_role_pkey" PRIMARY KEY ("workspaceMemberId","roleId")
);

-- CreateTable
CREATE TABLE "perm_membership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "PermMembershipStatus" NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perm_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perm_role" (
    "id" TEXT NOT NULL,
    "level" "PermRoleLevel" NOT NULL,
    "organizationId" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "perm_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perm_user_role" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perm_user_role_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "perm_membership_role" (
    "membershipId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perm_membership_role_pkey" PRIMARY KEY ("membershipId","roleId")
);

-- CreateTable
CREATE TABLE "perm_feature" (
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isPrivileged" BOOLEAN NOT NULL DEFAULT false,
    "deprecatedAt" TIMESTAMP(3),

    CONSTRAINT "perm_feature_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "perm_role_limit" (
    "roleId" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "perm_role_limit_pkey" PRIMARY KEY ("roleId","limitKey")
);

-- CreateTable
CREATE TABLE "perm_role_feature" (
    "roleId" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,

    CONSTRAINT "perm_role_feature_pkey" PRIMARY KEY ("roleId","featureKey")
);

-- CreateTable
CREATE TABLE "perm_plan" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "perm_plan_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "perm_plan_limit" (
    "planKey" TEXT NOT NULL,
    "limitKey" TEXT NOT NULL,
    "value" INTEGER NOT NULL,

    CONSTRAINT "perm_plan_limit_pkey" PRIMARY KEY ("planKey","limitKey")
);

-- CreateTable
CREATE TABLE "perm_plan_feature" (
    "planKey" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,

    CONSTRAINT "perm_plan_feature_pkey" PRIMARY KEY ("planKey","featureKey")
);

-- CreateTable
CREATE TABLE "perm_subscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "planKey" TEXT NOT NULL,
    "status" "PermSubscriptionStatus" NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "perm_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_email_key" ON "auth_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "auth_user_username_key" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "auth_identity_userId_idx" ON "auth_identity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identity_provider_subject_key" ON "auth_identity"("provider", "subject");

-- CreateIndex
CREATE UNIQUE INDEX "auth_identity_userId_provider_key" ON "auth_identity"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "auth_credential_userId_type_key" ON "auth_credential"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "auth_session_refreshTokenHash_key" ON "auth_session"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "auth_session_userId_revokedAt_idx" ON "auth_session"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "auth_password_reset_tokenHash_key" ON "auth_password_reset"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_password_reset_userId_consumedAt_idx" ON "auth_password_reset"("userId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "perm_organization_key_key" ON "perm_organization"("key");

-- CreateIndex
CREATE UNIQUE INDEX "perm_workspace_organizationId_key_key" ON "perm_workspace"("organizationId", "key");

-- CreateIndex
CREATE INDEX "perm_workspace_member_workspaceId_idx" ON "perm_workspace_member"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "perm_workspace_member_membershipId_workspaceId_key" ON "perm_workspace_member"("membershipId", "workspaceId");

-- CreateIndex
CREATE INDEX "perm_membership_userId_idx" ON "perm_membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "perm_membership_userId_organizationId_key" ON "perm_membership"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "perm_role_level_idx" ON "perm_role"("level");

-- CreateIndex
CREATE UNIQUE INDEX "perm_role_organizationId_key_key" ON "perm_role"("organizationId", "key");

-- CreateIndex
CREATE INDEX "perm_user_role_userId_idx" ON "perm_user_role"("userId");

-- CreateIndex
CREATE INDEX "perm_subscription_organizationId_status_idx" ON "perm_subscription"("organizationId", "status");

-- CreateIndex
CREATE INDEX "perm_subscription_workspaceId_status_idx" ON "perm_subscription"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "auth_identity" ADD CONSTRAINT "auth_identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_credential" ADD CONSTRAINT "auth_credential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_password_reset" ADD CONSTRAINT "auth_password_reset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_workspace" ADD CONSTRAINT "perm_workspace_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "perm_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_workspace_member" ADD CONSTRAINT "perm_workspace_member_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "perm_membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_workspace_member" ADD CONSTRAINT "perm_workspace_member_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "perm_workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_workspace_member_role" ADD CONSTRAINT "perm_workspace_member_role_workspaceMemberId_fkey" FOREIGN KEY ("workspaceMemberId") REFERENCES "perm_workspace_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_workspace_member_role" ADD CONSTRAINT "perm_workspace_member_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "perm_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_membership" ADD CONSTRAINT "perm_membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "perm_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_role" ADD CONSTRAINT "perm_role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "perm_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_user_role" ADD CONSTRAINT "perm_user_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "perm_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_membership_role" ADD CONSTRAINT "perm_membership_role_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "perm_membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_membership_role" ADD CONSTRAINT "perm_membership_role_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "perm_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_role_limit" ADD CONSTRAINT "perm_role_limit_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "perm_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_role_feature" ADD CONSTRAINT "perm_role_feature_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "perm_role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_role_feature" ADD CONSTRAINT "perm_role_feature_featureKey_fkey" FOREIGN KEY ("featureKey") REFERENCES "perm_feature"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_plan_limit" ADD CONSTRAINT "perm_plan_limit_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "perm_plan"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_plan_feature" ADD CONSTRAINT "perm_plan_feature_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "perm_plan"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_plan_feature" ADD CONSTRAINT "perm_plan_feature_featureKey_fkey" FOREIGN KEY ("featureKey") REFERENCES "perm_feature"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_subscription" ADD CONSTRAINT "perm_subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "perm_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_subscription" ADD CONSTRAINT "perm_subscription_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "perm_workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "perm_subscription" ADD CONSTRAINT "perm_subscription_planKey_fkey" FOREIGN KEY ("planKey") REFERENCES "perm_plan"("key") ON DELETE RESTRICT ON UPDATE CASCADE;
