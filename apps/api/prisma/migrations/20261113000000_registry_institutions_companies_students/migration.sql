-- Ministry registry: institutions, companies, students (TZ «ILMORA — реестр учреждений, компании, студенты», 9 Nov 2026).
-- Additive only: new enums and tables, three new Role values and nullable columns on "User". Nothing existing is
-- dropped, renamed or rewritten, so the previous release keeps working against this schema.
-- Duplicates are stopped by unique indexes: one direction per normalized name ("Direction_tenantId_searchKey_key"),
-- one institution and one company per STIR, one representative per institution or company ("User_institutionId_key",
-- "User_companyId_key"), one open contract-help request per student ("ContractHelpRequest_openKey_key").

-- CreateEnum
CREATE TYPE "InstitutionType" AS ENUM ('TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'TRAINING_CENTER');

-- CreateEnum
CREATE TYPE "Ownership" AS ENUM ('STATE', 'PRIVATE');

-- CreateEnum
CREATE TYPE "InstitutionSource" AS ENUM ('IMPORT', 'SELF', 'STUDENT');

-- CreateEnum
CREATE TYPE "InstitutionStatus" AS ENUM ('UNCLAIMED', 'DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DirectionOrigin" AS ENUM ('OFFICIAL', 'USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "StudentMode" AS ENUM ('STUDYING', 'APPLYING');

-- CreateEnum
CREATE TYPE "StudyForm" AS ENUM ('GRANT', 'CONTRACT', 'UNDECIDED');

-- CreateEnum
CREATE TYPE "StudyConfirmation" AS ENUM ('NONE', 'PENDING', 'CONFIRMED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('GRADUATE_CARD', 'CONTRACT_HELP_CARD', 'COMPANY_CONTACTS', 'PARENT_CONSENT');

-- CreateEnum
CREATE TYPE "AnnouncementStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "TrainingRequestStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ContractHelpStatus" AS ENUM ('ACTIVE', 'INTERESTED', 'SIGNED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('GRADUATE', 'CONTRACT_HELP');

-- CreateEnum
CREATE TYPE "VacancyKind" AS ENUM ('PRACTICE', 'INTERNSHIP');

-- CreateEnum
CREATE TYPE "WorkFormat" AS ENUM ('ONSITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "VacancyStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('NEW', 'VIEWED', 'INVITED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Role" ADD VALUE 'INSTITUTION_ADMIN';
ALTER TYPE "Role" ADD VALUE 'COMPANY_ADMIN';
ALTER TYPE "Role" ADD VALUE 'MINISTRY';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "institutionId" TEXT,
ADD COLUMN     "jobTitle" TEXT,
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "TotpRecoveryCode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TotpRecoveryCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Industry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Industry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" JSONB NOT NULL,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Direction" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchKey" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,
    "origin" "DirectionOrigin" NOT NULL DEFAULT 'USER',
    "code" TEXT,
    "mergedIntoId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Direction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Institution" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "InstitutionType" NOT NULL,
    "ownership" "Ownership",
    "name" TEXT NOT NULL,
    "searchKey" TEXT NOT NULL,
    "stir" TEXT,
    "parentId" TEXT,
    "regionId" TEXT,
    "districtId" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "directorName" TEXT,
    "status" "InstitutionStatus" NOT NULL DEFAULT 'UNCLAIMED',
    "source" "InstitutionSource" NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectReason" TEXT,
    "centerId" TEXT,
    "mergedIntoId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstitutionDirection" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "department" TEXT,
    "studentsCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstitutionDirection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "stir" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchKey" TEXT NOT NULL,
    "regionId" TEXT,
    "districtId" TEXT,
    "address" TEXT,
    "website" TEXT,
    "about" TEXT,
    "certificateFileKey" TEXT,
    "status" "CompanyStatus" NOT NULL DEFAULT 'DRAFT',
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyIndustry" (
    "companyId" TEXT NOT NULL,
    "industryId" TEXT NOT NULL,

    CONSTRAINT "CompanyIndustry_pkey" PRIMARY KEY ("companyId","industryId")
);

-- CreateTable
CREATE TABLE "CompanyDirection" (
    "companyId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,

    CONSTRAINT "CompanyDirection_pkey" PRIMARY KEY ("companyId","directionId")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" "StudentMode" NOT NULL,
    "institutionType" "InstitutionType",
    "institutionId" TEXT,
    "course" INTEGER,
    "enrollYear" INTEGER,
    "graduationYear" INTEGER,
    "directionId" TEXT,
    "studyForm" "StudyForm",
    "contractAmountMinor" BIGINT,
    "birthDate" DATE,
    "regionId" TEXT,
    "districtId" TEXT,
    "about" TEXT,
    "parentName" TEXT,
    "parentPhone" TEXT,
    "studyConfirmation" "StudyConfirmation" NOT NULL DEFAULT 'NONE',
    "studyConfirmedAt" TIMESTAMP(3),
    "studyConfirmedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentConsent" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "companyId" TEXT,
    "textVersion" TEXT NOT NULL,
    "givenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,

    CONSTRAINT "StudentConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentCertificate" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "issuer" TEXT,
    "issuedAt" DATE,
    "fileKey" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GraduationAnnouncement" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "AnnouncementStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GraduationAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementLine" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "AnnouncementLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementExclusion" (
    "announcementId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnouncementExclusion_pkey" PRIMARY KEY ("announcementId","userId")
);

-- CreateTable
CREATE TABLE "AnnouncementResponse" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "comment" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnouncementResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnouncementResponseLine" (
    "responseId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "wantedCount" INTEGER NOT NULL,

    CONSTRAINT "AnnouncementResponseLine_pkey" PRIMARY KEY ("responseId","lineId")
);

-- CreateTable
CREATE TABLE "TrainingRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "byYear" INTEGER NOT NULL,
    "regionId" TEXT,
    "requirements" TEXT,
    "status" "TrainingRequestStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingOffer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "byYear" INTEGER NOT NULL,
    "comment" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractHelpRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motivation" TEXT NOT NULL,
    "yearsToWork" INTEGER NOT NULL,
    "workRegionId" TEXT,
    "status" "ContractHelpStatus" NOT NULL DEFAULT 'ACTIVE',
    "openKey" TEXT,
    "signedWithCompanyId" TEXT,
    "signedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractHelpRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "ContactSource" NOT NULL,
    "contractHelpId" TEXT,
    "announcementId" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vacancy" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" "VacancyKind" NOT NULL,
    "title" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "districtId" TEXT,
    "address" TEXT,
    "format" "WorkFormat" NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT false,
    "stipendMinor" BIGINT,
    "duration" TEXT,
    "seats" INTEGER NOT NULL,
    "requirements" TEXT,
    "deadline" DATE,
    "status" "VacancyStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vacancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VacancyDirection" (
    "vacancyId" TEXT NOT NULL,
    "directionId" TEXT NOT NULL,

    CONSTRAINT "VacancyDirection_pkey" PRIMARY KEY ("vacancyId","directionId")
);

-- CreateTable
CREATE TABLE "VacancyApplication" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vacancyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'NEW',
    "statusChangedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VacancyApplication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TotpRecoveryCode_userId_usedAt_idx" ON "TotpRecoveryCode"("userId", "usedAt");

-- CreateIndex
CREATE INDEX "Industry_tenantId_sortOrder_idx" ON "Industry"("tenantId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Industry_tenantId_slug_key" ON "Industry"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "Region_tenantId_code_key" ON "Region"("tenantId", "code");

-- CreateIndex
CREATE INDEX "District_regionId_idx" ON "District"("regionId");

-- CreateIndex
CREATE UNIQUE INDEX "District_tenantId_code_key" ON "District"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Direction_tenantId_industryId_idx" ON "Direction"("tenantId", "industryId");

-- CreateIndex
CREATE INDEX "Direction_tenantId_mergedIntoId_idx" ON "Direction"("tenantId", "mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "Direction_tenantId_searchKey_key" ON "Direction"("tenantId", "searchKey");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_centerId_key" ON "Institution"("centerId");

-- CreateIndex
CREATE INDEX "Institution_tenantId_status_idx" ON "Institution"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Institution_tenantId_regionId_districtId_idx" ON "Institution"("tenantId", "regionId", "districtId");

-- CreateIndex
CREATE INDEX "Institution_tenantId_type_ownership_idx" ON "Institution"("tenantId", "type", "ownership");

-- CreateIndex
CREATE INDEX "Institution_tenantId_searchKey_idx" ON "Institution"("tenantId", "searchKey");

-- CreateIndex
CREATE UNIQUE INDEX "Institution_tenantId_stir_key" ON "Institution"("tenantId", "stir");

-- CreateIndex
CREATE INDEX "InstitutionDirection_tenantId_directionId_idx" ON "InstitutionDirection"("tenantId", "directionId");

-- CreateIndex
CREATE UNIQUE INDEX "InstitutionDirection_institutionId_directionId_key" ON "InstitutionDirection"("institutionId", "directionId");

-- CreateIndex
CREATE INDEX "Company_tenantId_status_idx" ON "Company"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Company_tenantId_regionId_idx" ON "Company"("tenantId", "regionId");

-- CreateIndex
CREATE INDEX "Company_tenantId_searchKey_idx" ON "Company"("tenantId", "searchKey");

-- CreateIndex
CREATE UNIQUE INDEX "Company_tenantId_stir_key" ON "Company"("tenantId", "stir");

-- CreateIndex
CREATE INDEX "CompanyIndustry_industryId_idx" ON "CompanyIndustry"("industryId");

-- CreateIndex
CREATE INDEX "CompanyDirection_directionId_idx" ON "CompanyDirection"("directionId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");

-- CreateIndex
CREATE INDEX "StudentProfile_tenantId_institutionId_studyConfirmation_idx" ON "StudentProfile"("tenantId", "institutionId", "studyConfirmation");

-- CreateIndex
CREATE INDEX "StudentProfile_tenantId_directionId_graduationYear_idx" ON "StudentProfile"("tenantId", "directionId", "graduationYear");

-- CreateIndex
CREATE INDEX "StudentProfile_tenantId_mode_idx" ON "StudentProfile"("tenantId", "mode");

-- CreateIndex
CREATE INDEX "StudentProfile_tenantId_regionId_idx" ON "StudentProfile"("tenantId", "regionId");

-- CreateIndex
CREATE INDEX "StudentConsent_tenantId_userId_kind_idx" ON "StudentConsent"("tenantId", "userId", "kind");

-- CreateIndex
CREATE INDEX "StudentConsent_tenantId_kind_revokedAt_idx" ON "StudentConsent"("tenantId", "kind", "revokedAt");

-- CreateIndex
CREATE INDEX "StudentCertificate_tenantId_userId_idx" ON "StudentCertificate"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "GraduationAnnouncement_tenantId_status_year_idx" ON "GraduationAnnouncement"("tenantId", "status", "year");

-- CreateIndex
CREATE INDEX "GraduationAnnouncement_tenantId_institutionId_idx" ON "GraduationAnnouncement"("tenantId", "institutionId");

-- CreateIndex
CREATE INDEX "AnnouncementLine_directionId_idx" ON "AnnouncementLine"("directionId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementLine_announcementId_directionId_key" ON "AnnouncementLine"("announcementId", "directionId");

-- CreateIndex
CREATE INDEX "AnnouncementResponse_tenantId_companyId_idx" ON "AnnouncementResponse"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "AnnouncementResponse_tenantId_status_idx" ON "AnnouncementResponse"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AnnouncementResponse_announcementId_companyId_key" ON "AnnouncementResponse"("announcementId", "companyId");

-- CreateIndex
CREATE INDEX "TrainingRequest_tenantId_status_directionId_idx" ON "TrainingRequest"("tenantId", "status", "directionId");

-- CreateIndex
CREATE INDEX "TrainingRequest_tenantId_companyId_idx" ON "TrainingRequest"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "TrainingOffer_tenantId_institutionId_idx" ON "TrainingOffer"("tenantId", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingOffer_requestId_institutionId_key" ON "TrainingOffer"("requestId", "institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractHelpRequest_openKey_key" ON "ContractHelpRequest"("openKey");

-- CreateIndex
CREATE INDEX "ContractHelpRequest_tenantId_status_idx" ON "ContractHelpRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ContractHelpRequest_tenantId_userId_idx" ON "ContractHelpRequest"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "ContactRequest_tenantId_userId_status_idx" ON "ContactRequest"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "ContactRequest_tenantId_companyId_status_idx" ON "ContactRequest"("tenantId", "companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ContactRequest_companyId_userId_key" ON "ContactRequest"("companyId", "userId");

-- CreateIndex
CREATE INDEX "Vacancy_tenantId_status_regionId_idx" ON "Vacancy"("tenantId", "status", "regionId");

-- CreateIndex
CREATE INDEX "Vacancy_tenantId_companyId_idx" ON "Vacancy"("tenantId", "companyId");

-- CreateIndex
CREATE INDEX "VacancyDirection_directionId_idx" ON "VacancyDirection"("directionId");

-- CreateIndex
CREATE INDEX "VacancyApplication_tenantId_userId_idx" ON "VacancyApplication"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "VacancyApplication_tenantId_vacancyId_status_idx" ON "VacancyApplication"("tenantId", "vacancyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VacancyApplication_vacancyId_userId_key" ON "VacancyApplication"("vacancyId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_institutionId_key" ON "User"("institutionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_companyId_key" ON "User"("companyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TotpRecoveryCode" ADD CONSTRAINT "TotpRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Industry" ADD CONSTRAINT "Industry_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Region" ADD CONSTRAINT "Region_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Direction" ADD CONSTRAINT "Direction_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Direction" ADD CONSTRAINT "Direction_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Direction" ADD CONSTRAINT "Direction_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Direction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Institution" ADD CONSTRAINT "Institution_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionDirection" ADD CONSTRAINT "InstitutionDirection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionDirection" ADD CONSTRAINT "InstitutionDirection_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstitutionDirection" ADD CONSTRAINT "InstitutionDirection_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIndustry" ADD CONSTRAINT "CompanyIndustry_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyIndustry" ADD CONSTRAINT "CompanyIndustry_industryId_fkey" FOREIGN KEY ("industryId") REFERENCES "Industry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDirection" ADD CONSTRAINT "CompanyDirection_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyDirection" ADD CONSTRAINT "CompanyDirection_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentConsent" ADD CONSTRAINT "StudentConsent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCertificate" ADD CONSTRAINT "StudentCertificate_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentCertificate" ADD CONSTRAINT "StudentCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraduationAnnouncement" ADD CONSTRAINT "GraduationAnnouncement_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GraduationAnnouncement" ADD CONSTRAINT "GraduationAnnouncement_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementLine" ADD CONSTRAINT "AnnouncementLine_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "GraduationAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementLine" ADD CONSTRAINT "AnnouncementLine_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementExclusion" ADD CONSTRAINT "AnnouncementExclusion_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "GraduationAnnouncement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementExclusion" ADD CONSTRAINT "AnnouncementExclusion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementResponse" ADD CONSTRAINT "AnnouncementResponse_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementResponse" ADD CONSTRAINT "AnnouncementResponse_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "GraduationAnnouncement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementResponse" ADD CONSTRAINT "AnnouncementResponse_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementResponseLine" ADD CONSTRAINT "AnnouncementResponseLine_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "AnnouncementResponse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnouncementResponseLine" ADD CONSTRAINT "AnnouncementResponseLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "AnnouncementLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingRequest" ADD CONSTRAINT "TrainingRequest_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingOffer" ADD CONSTRAINT "TrainingOffer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingOffer" ADD CONSTRAINT "TrainingOffer_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "TrainingRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingOffer" ADD CONSTRAINT "TrainingOffer_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractHelpRequest" ADD CONSTRAINT "ContractHelpRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractHelpRequest" ADD CONSTRAINT "ContractHelpRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractHelpRequest" ADD CONSTRAINT "ContractHelpRequest_workRegionId_fkey" FOREIGN KEY ("workRegionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractHelpRequest" ADD CONSTRAINT "ContractHelpRequest_signedWithCompanyId_fkey" FOREIGN KEY ("signedWithCompanyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_contractHelpId_fkey" FOREIGN KEY ("contractHelpId") REFERENCES "ContractHelpRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactRequest" ADD CONSTRAINT "ContactRequest_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "GraduationAnnouncement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vacancy" ADD CONSTRAINT "Vacancy_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyDirection" ADD CONSTRAINT "VacancyDirection_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyDirection" ADD CONSTRAINT "VacancyDirection_directionId_fkey" FOREIGN KEY ("directionId") REFERENCES "Direction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyApplication" ADD CONSTRAINT "VacancyApplication_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyApplication" ADD CONSTRAINT "VacancyApplication_vacancyId_fkey" FOREIGN KEY ("vacancyId") REFERENCES "Vacancy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacancyApplication" ADD CONSTRAINT "VacancyApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
