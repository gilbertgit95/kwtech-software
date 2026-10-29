-- Display sizes kept PER LAYOUT (issue #22): the full site's and the phone
-- layout's are set apart. Every row that exists is the full site's, so the
-- new column defaults to 'desktop' and nobody's sizes change.

-- CreateEnum
CREATE TYPE "AuthDisplayLayout" AS ENUM ('desktop', 'mobile');

-- AlterTable
ALTER TABLE "auth_display_preference" DROP CONSTRAINT "auth_display_preference_pkey",
ADD COLUMN     "layout" "AuthDisplayLayout" NOT NULL DEFAULT 'desktop',
ADD CONSTRAINT "auth_display_preference_pkey" PRIMARY KEY ("userId", "layout");
