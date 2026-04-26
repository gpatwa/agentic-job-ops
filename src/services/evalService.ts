import type {
  AppSession,
  ApplicationAnswer,
  ApplicationPackage,
  ApplicationRecord,
  EvalCase,
  EvalResult,
  EvalRun,
  EvalRunSuite,
  EvalStatus,
  EvalSuite,
  ExtensionSession,
  NormalizedJob,
  Resume,
  UserProfile
} from "../models/domain";
import {
  evalCaseSchema,
  evalResultSchema,
  evalRunSchema
} from "../models/schemas";
import {
  clearScopedWorkspace,
  readJson,
  scopedKey,
  writeJson
} from "../lib/storage";
import {
  DeterministicScoringAdapter,
  queueFromRecommendation
} from "./matchEngine";
import {
  DeterministicApplicationPackageGenerator,
  checkUnsupportedClaims
} from "./applicationPackage";
import {
  approveBrowserSubmit,
  createATSBrowserAutomationAdapter,
  markBrowserSessionManualRequired,
  markBrowserSessionReadyForReview,
  startBrowserApplicationSession,
  submitApprovedBrowserApplication
} from "./browserApplicationAssistant";
import { loadApplications, saveApplications } from "./applicationService";
import {
  GreenhouseATSAdapter,
  LeverATSAdapter,
  greenhouseFixturePage,
  leverFixturePage
} from "./atsAdapters";
import { createDryRunSnapshot } from "./realSiteDryRunService";
import {
  runCareerOps,
  saveCareerOpsSettings
} from "./careerOpsService";
import {
  loadNormalizedJobs,
  saveNormalizedJobs
} from "./jobIngestion";
import { loadApplicationPackages } from "./applicationPackage";
import {
  addRecruiterLead,
  detectJobRiskSignals,
  generateCompanyIntelligence
} from "./intelligenceService";
import {
  isDemoJob,
  loadOnboardingState,
  recommendApplyReadyJobs,
  recordOnboardingCompleted,
  recordOnboardingJobReviewed
} from "./onboardingJobRecommendationService";
import {
  analyzeResumeIntelligence,
  selectionFromRecommendation
} from "./resumeIntelligenceService";
import {
  generateResumeImprovementDraft,
  reanalyzeImprovedResume,
  saveResumeImprovementDraft
} from "./resumeImprovementService";
import {
  loadResume,
  loadResumeVersions,
  saveResume
} from "./resumeService";
import { userProfileSchema } from "../models/schemas";

interface EvalRunBundle {
  run: EvalRun;
  cases: EvalCase[];
  results: EvalResult[];
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function evalCasesKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "eval_cases");
}

function evalRunsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "eval_runs");
}

function evalResultsKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "eval_results");
}

function evalSession(session: AppSession): AppSession {
  return {
    tenant: {
      ...session.tenant,
      id: `${session.tenant.id}_eval_sandbox`,
      name: `${session.tenant.name} eval sandbox`
    },
    userId: `${session.userId}_eval`
  };
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  const timestamp = nowIso();
  return {
    id: "profile_eval",
    tenantId: "tenant_eval",
    userId: "user_eval",
    fullName: "Example User",
    email: "example@example.com",
    phone: "555-0100",
    location: "Remote",
    workAuthorization: "Authorized to work in the United States",
    linkedinUrl: "https://www.linkedin.com/in/example",
    portfolioUrl: "https://example.com",
    githubUrl: "https://github.com/example",
    targetTitles: ["Staff Product Manager"],
    targetLocations: ["Remote"],
    targetIndustries: ["B2B SaaS", "Workflow Automation"],
    remotePreference: "remote",
    salaryMin: 150000,
    salaryTarget: 180000,
    companiesToAvoid: [],
    companiesToPrioritize: ["ExampleCo"],
    careerSummary:
      "Product leader focused on B2B SaaS workflow automation and customer discovery.",
    verifiedFacts: [
      "Led B2B SaaS workflow automation launches",
      "Partnered with engineering and design on customer discovery",
      "Built roadmap process for workflow automation products"
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function resume(): Resume {
  return {
    id: "resume_eval",
    tenantId: "tenant_eval",
    userId: "user_eval",
    originalFileName: "resume.pdf",
    fileUrl: "local-placeholder://resume.pdf",
    parsedText:
      "Example User led B2B SaaS workflow automation launches and partnered with engineering and design on customer discovery.",
    status: "parsed",
    createdAt: nowIso()
  };
}

function job(overrides: Partial<NormalizedJob> = {}): NormalizedJob {
  const timestamp = nowIso();
  return {
    id: "job_eval",
    tenantId: "tenant_eval",
    userId: "user_eval",
    sourceConfigId: null,
    source: "greenhouse",
    sourceJobId: "eval_1",
    title: "Staff Product Manager",
    company: "ExampleCo",
    location: "Remote",
    remoteType: "remote",
    salaryMin: 170000,
    salaryMax: 210000,
    description:
      "ExampleCo is hiring a Staff Product Manager for B2B SaaS workflow automation, customer discovery, roadmap delivery, and cross-functional execution with engineering and design partners.",
    responsibilities: [
      "Lead customer discovery",
      "Partner with engineering and design on roadmap delivery",
      "Launch workflow automation products"
    ],
    requirements: [
      "B2B SaaS product management experience",
      "Workflow automation launch experience",
      "Customer discovery experience"
    ],
    applicationUrl: "https://boards.greenhouse.io/example/jobs/123",
    atsType: "greenhouse",
    postedAt: timestamp,
    discoveredAt: timestamp,
    scoringStatus: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function applicationRecord(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  const timestamp = nowIso();
  return {
    id: "app_eval",
    tenantId: "tenant_eval",
    userId: "user_eval",
    jobId: "job_eval",
    status: "approved",
    notes: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides
  };
}

function applicationPackage(
  status: ApplicationPackage["status"] = "approved"
): ApplicationPackage {
  const timestamp = nowIso();
  return {
    id: "pkg_eval",
    tenantId: "tenant_eval",
    userId: "user_eval",
    jobId: "job_eval",
    applicationRecordId: "app_eval",
    status,
    resumeMarkdown: "# Example User\n\nLed B2B SaaS workflow automation launches.",
    coverLetter: "Dear hiring team,\n\nI am interested in this role.",
    generationMode: "deterministic",
    modelName: "deterministic-package-fallback",
    promptVersion: "application-package-v1",
    inputHash: "input",
    outputHash: "output",
    safetyWarnings: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: status === "approved" ? timestamp : null,
    rejectedAt: null
  };
}

function applicationAnswers(): ApplicationAnswer[] {
  const timestamp = nowIso();
  return [
    {
      id: "answer_eval",
      tenantId: "tenant_eval",
      userId: "user_eval",
      applicationPackageId: "pkg_eval",
      question: "What makes you a strong fit?",
      answer: "I have verified workflow automation launch experience.",
      confidence: "high",
      source: "user_edited",
      needsUserReview: false,
      createdAt: timestamp,
      updatedAt: timestamp
    }
  ];
}

function defaultEvalCases(session: AppSession): EvalCase[] {
  const timestamp = nowIso();
  const base = {
    tenantId: session.tenant.id,
    userId: session.userId,
    createdAt: timestamp
  };
  const cases: Array<Omit<EvalCase, "tenantId" | "userId" | "createdAt">> = [
    {
      id: "eval_match_strong_high",
      suite: "match_score",
      name: "Obvious strong match scores high",
      description: "Strong title, location, salary, industry, and company fit should score high.",
      inputSummary: "Aligned product manager profile and B2B SaaS role.",
      expectedBehavior: "Overall score is at least 8.0."
    },
    {
      id: "eval_match_weak_low",
      suite: "match_score",
      name: "Obvious weak match scores low",
      description: "Mismatched role and onsite constraints should score low.",
      inputSummary: "Product profile compared with unrelated onsite finance role.",
      expectedBehavior: "Overall score is below 5.5."
    },
    {
      id: "eval_match_avoid_skip",
      suite: "match_score",
      name: "Avoid-list company is skipped",
      description: "Companies to avoid override otherwise strong matches.",
      inputSummary: "Profile avoid list includes the hiring company.",
      expectedBehavior: "Recommendation is skip."
    },
    {
      id: "eval_match_incomplete_profile",
      suite: "match_score",
      name: "Incomplete profile lowers confidence",
      description: "Missing profile fields should be visible in score gaps.",
      inputSummary: "Empty profile against a real job.",
      expectedBehavior: "Top gaps mention incomplete profile."
    },
    {
      id: "eval_match_low_browsable",
      suite: "match_score",
      name: "Low-score jobs remain browsable",
      description: "Low and skipped recommendations should still map to Browse.",
      inputSummary: "Weak role fit with low score.",
      expectedBehavior: "Queue is browse."
    },
    {
      id: "eval_package_no_fake_claims",
      suite: "application_package",
      name: "Generated package avoids fake claims",
      description: "Deterministic package should not invent companies, roles, tools, metrics, or credentials.",
      inputSummary: "Verified profile, parsed resume, and job description.",
      expectedBehavior: "No unsupported-claim warnings."
    },
    {
      id: "eval_package_fake_claim_checker",
      suite: "application_package",
      name: "Unsupported-claim checker catches fake details",
      description: "Known fake company, tool, metric, and credential mentions should be flagged.",
      inputSummary: "Text includes unsupported Google, Kubernetes, AWS Certified, and 40%.",
      expectedBehavior: "Warnings are created."
    },
    {
      id: "eval_package_low_confidence",
      suite: "application_package",
      name: "Answer confidence is low without evidence",
      description: "Missing profile and resume evidence should produce low-confidence answers.",
      inputSummary: "No profile facts and no parsed resume evidence.",
      expectedBehavior: "At least one answer is low confidence and needs review."
    },
    {
      id: "eval_ats_greenhouse_fixture_detection",
      suite: "ats_adapter",
      name: "Greenhouse fixture detection",
      description: "Greenhouse-like application forms should select the Greenhouse adapter.",
      inputSummary: "Greenhouse fixture URL and form structure.",
      expectedBehavior: "Adapter type is greenhouse with high confidence."
    },
    {
      id: "eval_ats_lever_fixture_detection",
      suite: "ats_adapter",
      name: "Lever fixture detection",
      description: "Lever-like application forms should select the Lever adapter.",
      inputSummary: "Lever fixture URL and form structure.",
      expectedBehavior: "Adapter type is lever with high confidence."
    },
    {
      id: "eval_ats_safe_field_mapping",
      suite: "ats_adapter",
      name: "Safe field mapping",
      description: "ATS fill plans should map profile, resume, package, and approved answer fields without exposing raw values.",
      inputSummary: "Approved profile, package, and Greenhouse fixture.",
      expectedBehavior: "Safe first name, email, resume, and answer fields are fillable."
    },
    {
      id: "eval_ats_uncertain_field_pause",
      suite: "ats_adapter",
      name: "Uncertain field pause",
      description: "Required custom fields without approved evidence should pause for user input.",
      inputSummary: "Greenhouse fixture without application answers.",
      expectedBehavior: "Required or low-confidence fields require review."
    },
    {
      id: "eval_ats_no_submit_without_approval",
      suite: "ats_adapter",
      name: "No submit without approval",
      description: "ATS adapters should not submit when the browser session is not explicitly approved.",
      inputSummary: "Dry-run browser session.",
      expectedBehavior: "Submit result is not confirmed."
    },
    {
      id: "eval_ats_no_sensitive_demographic_default",
      suite: "ats_adapter",
      name: "No sensitive demographic answer by default",
      description: "Demographic, veteran, disability, race, and gender fields should pause unless user defaults exist.",
      inputSummary: "Greenhouse and Lever fixtures with demographic fields.",
      expectedBehavior: "Demographic fields are pause items, not filled fields."
    },
    {
      id: "eval_real_site_greenhouse_summary",
      suite: "ats_adapter",
      name: "Greenhouse real-site dry-run summary",
      description: "Real-site dry-run snapshots of Greenhouse URLs should detect the Greenhouse adapter and block submit.",
      inputSummary: "Public Greenhouse application URL with no extension session.",
      expectedBehavior: "Snapshot atsType is greenhouse with confidence >= 0.8 and submit is blocked."
    },
    {
      id: "eval_real_site_lever_summary",
      suite: "ats_adapter",
      name: "Lever real-site dry-run summary",
      description: "Real-site dry-run snapshots of Lever URLs should detect the Lever adapter and block submit.",
      inputSummary: "Public Lever application URL with no extension session.",
      expectedBehavior: "Snapshot atsType is lever with confidence >= 0.8 and submit is blocked."
    },
    {
      id: "eval_real_site_token_redaction",
      suite: "ats_adapter",
      name: "Token-like query params redacted in snapshot URL",
      description: "Real-site dry-run snapshot URLs must redact authentication tokens, secrets, and opaque strings.",
      inputSummary: "Greenhouse URL with token, code, and api_key query params.",
      expectedBehavior: "Snapshot redactedUrl contains [redacted-token] and never the original token value."
    },
    {
      id: "eval_real_site_value_redaction",
      suite: "ats_adapter",
      name: "Email and phone-like values redacted in snapshot URL",
      description: "Real-site dry-run snapshot URLs must redact email and phone values that appear as query params.",
      inputSummary: "URL with email and phone query params.",
      expectedBehavior: "Snapshot redactedUrl contains [redacted-email] and [redacted-phone]."
    },
    {
      id: "eval_real_site_submit_always_blocked",
      suite: "ats_adapter",
      name: "Real-site snapshots always block submit",
      description: "External real-site dry-run snapshots must always set submitBlocked to true regardless of input.",
      inputSummary: "Greenhouse URL with extension session metadata.",
      expectedBehavior: "Snapshot submitBlocked is true and validationSummary.submitBlocked is true."
    },
    {
      id: "eval_real_site_sensitive_paused",
      suite: "ats_adapter",
      name: "Real-site snapshots pause sensitive fields",
      description: "Sensitive fields detected by the extension must remain paused in the dry-run snapshot.",
      inputSummary: "Extension session with demographic field and matching pause.",
      expectedBehavior: "Snapshot validationSummary.sensitiveFieldsPaused is true and pausedFieldCount >= sensitiveFieldCount."
    },
    {
      id: "eval_browser_approved_package_required",
      suite: "browser_assistant_safety",
      name: "Cannot start without approved package",
      description: "Browser apply must reject draft or review packages.",
      inputSummary: "Ready-for-review package.",
      expectedBehavior: "Start throws before browser session creation."
    },
    {
      id: "eval_browser_submit_approval_required",
      suite: "browser_assistant_safety",
      name: "Cannot submit before approval",
      description: "Submit action must be unavailable before explicit approval.",
      inputSummary: "Ready-for-review browser session.",
      expectedBehavior: "Submit throws."
    },
    {
      id: "eval_browser_sensitive_pause",
      suite: "browser_assistant_safety",
      name: "Pauses on sensitive fields",
      description: "Demographic and final submit fields must pause.",
      inputSummary: "Detected browser form fields.",
      expectedBehavior: "Uncertain fields include demographic and final submit."
    },
    {
      id: "eval_browser_captcha_login_pause",
      suite: "browser_assistant_safety",
      name: "Pauses on CAPTCHA and login challenges",
      description: "CAPTCHA and login/manual verification must pause.",
      inputSummary: "LinkedIn-style application URL.",
      expectedBehavior: "Uncertain fields include CAPTCHA and login challenge."
    },
    {
      id: "eval_browser_manual_fallback",
      suite: "browser_assistant_safety",
      name: "Manual fallback works",
      description: "Automation failures can mark a session manual required.",
      inputSummary: "Needs-user-input browser session.",
      expectedBehavior: "Session becomes manual_required."
    },
    {
      id: "eval_browser_job_seeker_approval_only",
      suite: "browser_assistant_safety",
      name: "Only job seeker can approve submit",
      description: "Coaches and admins cannot approve on behalf of the job seeker.",
      inputSummary: "Ready-for-review browser session.",
      expectedBehavior: "Approval by another actor throws."
    },
    {
      id: "eval_career_ops_idempotent_jobs",
      suite: "career_ops",
      name: "Career Ops run does not duplicate jobs",
      description: "A second run with no new ingestion sources must not duplicate jobs.",
      inputSummary: "Two consecutive Career Ops runs with no enabled sources.",
      expectedBehavior: "Second run records the same job count as the first."
    },
    {
      id: "eval_career_ops_avoided_company_no_package",
      suite: "career_ops",
      name: "Career Ops skips packages for avoided companies",
      description: "Packages must never be prepared for companies on the avoid list.",
      inputSummary: "High-score job at a company in companiesToAvoid.",
      expectedBehavior: "No package is created and a warning appears in the digest."
    },
    {
      id: "eval_career_ops_incomplete_profile_warning",
      suite: "career_ops",
      name: "Incomplete profile creates a digest warning",
      description: "When the profile has no name, email, or targets, the digest must warn about confidence.",
      inputSummary: "Empty profile.",
      expectedBehavior: "Digest warnings include profile-incomplete messaging."
    },
    {
      id: "eval_career_ops_high_score_routes_to_apply",
      suite: "career_ops",
      name: "High-score jobs route to the Apply queue",
      description: "Strong matches must land in apply_review.",
      inputSummary: "Profile that strongly matches a job.",
      expectedBehavior: "applyReviewCount > 0 in the latest run."
    },
    {
      id: "eval_career_ops_low_score_browsable",
      suite: "career_ops",
      name: "Low-score jobs remain browsable",
      description: "Low matches must still appear under browse, not be deleted.",
      inputSummary: "Job that does not match the profile at all.",
      expectedBehavior: "browseCount >= 1 in the latest run."
    },
    {
      id: "eval_career_ops_no_submit_actions",
      suite: "career_ops",
      name: "Career Ops never submits an application",
      description: "A run must never create application_submitted audits or move applications to submitted.",
      inputSummary: "Run with package preparation enabled and avoided list empty.",
      expectedBehavior: "No application moves to submitted and no submit audit fires."
    },
    {
      id: "eval_intel_suspicious_domain",
      suite: "company_intelligence",
      name: "Suspicious domain creates a risk signal",
      description: "Application URLs on URL shorteners or low-trust TLDs must produce a high-severity suspicious_domain risk signal.",
      inputSummary: "Job with applicationUrl on bit.ly.",
      expectedBehavior: "Risk signals include suspicious_domain at high severity."
    },
    {
      id: "eval_intel_fee_request",
      suite: "company_intelligence",
      name: "Fee or payment language creates a high-risk signal",
      description: "Job descriptions asking applicants to pay must produce a high-severity fee_request risk signal.",
      inputSummary: "Job description with the phrase 'training fee'.",
      expectedBehavior: "Risk signals include fee_request at high severity."
    },
    {
      id: "eval_intel_vague_description",
      suite: "company_intelligence",
      name: "Vague job description creates a risk signal",
      description: "Very short descriptions with no responsibilities or requirements must produce a vague_description risk signal.",
      inputSummary: "Job with short description and no requirements.",
      expectedBehavior: "Risk signals include vague_description."
    },
    {
      id: "eval_intel_marked_estimated",
      suite: "company_intelligence",
      name: "Deterministic intelligence is marked estimated",
      description: "Deterministic intelligence must declare its source as deterministic and confidence as low.",
      inputSummary: "Standard job and profile.",
      expectedBehavior: "intelligence.source is 'deterministic' and intelligence.confidence is 'low'."
    },
    {
      id: "eval_intel_no_invented_recruiters",
      suite: "company_intelligence",
      name: "Recruiter names are never invented",
      description: "addRecruiterLead with no name produces an empty-name placeholder, never a fabricated name.",
      inputSummary: "addRecruiterLead with name omitted.",
      expectedBehavior: "lead.name is the empty string and source is 'manual'."
    },
    {
      id: "eval_intel_high_risk_blocks_package_prep",
      suite: "company_intelligence",
      name: "High-risk job blocks automatic package prep unless user overrides",
      description: "When package prep is enabled and a high-risk signal is present, no package is generated unless overrideHighRiskPackagePrep is true.",
      inputSummary: "Career Ops run with high-risk job and package prep enabled.",
      expectedBehavior: "First run generates 0 packages and warns; second run with override enabled generates the package."
    },
    {
      id: "eval_onboarding_product_role_returns_product_jobs",
      suite: "onboarding",
      name: "Selected product role returns product jobs",
      description: "Picking a product-manager role surfaces product-related demo jobs when no real jobs exist.",
      inputSummary: "Empty job store, target role 'Senior Product Manager'.",
      expectedBehavior: "At least one demo job has a product-manager title."
    },
    {
      id: "eval_onboarding_data_role_returns_data_jobs",
      suite: "onboarding",
      name: "Selected data role returns data jobs",
      description: "Picking a data-science role surfaces data-related demo jobs when no real jobs exist.",
      inputSummary: "Empty job store, target role 'Senior Data Scientist'.",
      expectedBehavior: "At least one demo job has a data-related title."
    },
    {
      id: "eval_onboarding_demo_jobs_when_empty",
      suite: "onboarding",
      name: "No existing jobs creates clearly labeled demo jobs",
      description: "When the job store is empty, demo jobs are created and clearly marked as demo.",
      inputSummary: "Empty job store, target role.",
      expectedBehavior: "Demo banner is shown; every demo job id starts with the demo_job_ prefix."
    },
    {
      id: "eval_onboarding_strong_first",
      suite: "onboarding",
      name: "Strong matches are scored and shown first",
      description: "Strong-fit jobs appear in the strong matches group ahead of possible/browse.",
      inputSummary: "Profile that strongly matches a product role.",
      expectedBehavior: "Strong matches group has at least one entry."
    },
    {
      id: "eval_onboarding_no_submit",
      suite: "onboarding",
      name: "Onboarding does not submit applications",
      description: "Recommendation runs do not move applications to submitted or fire submit audits.",
      inputSummary: "Onboarding recommendation run with profile and demo jobs.",
      expectedBehavior: "No application_submitted audit and no submitted application records."
    },
    {
      id: "eval_onboarding_completes_after_review",
      suite: "onboarding",
      name: "Onboarding completes after job recommendations and a job review",
      description: "Marking a job reviewed after recommendations are shown completes onboarding.",
      inputSummary: "Recommendation shown then onboarding marked complete.",
      expectedBehavior: "onboardingCompletedAt is set."
    },
    {
      id: "eval_onboarding_demo_clearly_marked",
      suite: "onboarding",
      name: "Demo jobs are clearly marked as demo",
      description: "Demo jobs use the demo_job_ id prefix and the description is prefixed with [Demo job].",
      inputSummary: "Demo jobs created during onboarding.",
      expectedBehavior: "Every demo job id starts with demo_job_ and description starts with [Demo job]."
    },
    {
      id: "eval_ri_clean_resume_high_confidence",
      suite: "resume_intelligence",
      name: "Clean resume extracts high-confidence fields",
      description: "A resume with name, email, LinkedIn, skills, and quantified achievements should yield high confidence on those fields.",
      inputSummary: "Well-structured product manager resume.",
      expectedBehavior: "Name, email, and LinkedIn are extracted with high confidence and ATS risk is low."
    },
    {
      id: "eval_ri_missing_email_warning",
      suite: "resume_intelligence",
      name: "Missing email creates a warning",
      description: "When the resume has no email, the report should add an email missing-field and a high-severity suggested fix.",
      inputSummary: "Resume without an email line.",
      expectedBehavior: "missingFields includes email; suggestedFixes contains an email fix at high severity."
    },
    {
      id: "eval_ri_missing_phone_warning",
      suite: "resume_intelligence",
      name: "Missing phone creates a warning",
      description: "When the resume has no phone, the report should add a phone missing-field and a medium-severity fix.",
      inputSummary: "Resume without a phone number.",
      expectedBehavior: "missingFields includes phone; suggestedFixes contains a phone fix."
    },
    {
      id: "eval_ri_unclear_dates_warning",
      suite: "resume_intelligence",
      name: "Unclear dates creates a warning",
      description: "When dates are not in 'YYYY – YYYY' format, the report should flag dates as ambiguous.",
      inputSummary: "Resume without recognisable date ranges.",
      expectedBehavior: "ambiguousFields includes dates."
    },
    {
      id: "eval_ri_no_quantified_creates_suggestion",
      suite: "resume_intelligence",
      name: "No quantified achievements creates suggestion",
      description: "Resumes with no measurable outcomes should produce a quantified-achievements suggestion.",
      inputSummary: "Resume without numeric outcomes.",
      expectedBehavior: "suggestedFixes contains a quantifiedAchievements suggestion."
    },
    {
      id: "eval_ri_table_layout_warning",
      suite: "resume_intelligence",
      name: "Table/column formatting creates ATS warning",
      description: "Pipes in the parsed text indicate column/table layouts ATS parsers struggle with.",
      inputSummary: "Resume containing | characters.",
      expectedBehavior: "parsingWarnings mentions multi-column / table layout."
    },
    {
      id: "eval_ri_skills_not_invented",
      suite: "resume_intelligence",
      name: "Unsupported skills are not invented",
      description: "When the resume mentions no relevant skill keywords, the extracted skills list must be empty.",
      inputSummary: "Resume with no recognisable skill keywords.",
      expectedBehavior: "extractedProfile.skills is empty."
    },
    {
      id: "eval_ri_product_role_recommendation",
      suite: "resume_intelligence",
      name: "Product evidence recommends product roles",
      description: "Product-manager resume should recommend Product Manager as a strongest-fit role.",
      inputSummary: "Product manager resume.",
      expectedBehavior: "strongestRoles includes a 'Product Manager' style title."
    },
    {
      id: "eval_ri_data_role_recommendation",
      suite: "resume_intelligence",
      name: "Data evidence recommends data roles",
      description: "Data-engineering resume should recommend a data-related role.",
      inputSummary: "Data engineer resume.",
      expectedBehavior: "strongestRoles includes a data-related title."
    },
    {
      id: "eval_ri_ai_role_recommendation",
      suite: "resume_intelligence",
      name: "AI evidence recommends AI roles",
      description: "AI/LLM resume should recommend an AI-related role.",
      inputSummary: "AI engineer resume.",
      expectedBehavior: "strongestRoles includes an AI-related title."
    },
    {
      id: "eval_ri_stretch_clearly_labeled",
      suite: "resume_intelligence",
      name: "Stretch roles are clearly labeled",
      description: "Stretch roles should have fitLevel='stretch' and low confidence.",
      inputSummary: "Product manager resume.",
      expectedBehavior: "Every stretch role has fitLevel='stretch' and confidence 'low'."
    },
    {
      id: "eval_ri_no_strong_without_evidence",
      suite: "resume_intelligence",
      name: "Roles without evidence are not marked strong fit",
      description: "Resumes with no role-family evidence should produce zero strongest-fit roles.",
      inputSummary: "Resume with no recognisable role-family keywords.",
      expectedBehavior: "strongestRoles is empty when no role family matches."
    },
    {
      id: "eval_ri_avoid_includes_explanation",
      suite: "resume_intelligence",
      name: "Roles to avoid include an explanation",
      description: "Each role in rolesToAvoid should explain why.",
      inputSummary: "Product manager resume.",
      expectedBehavior: "Every avoid role has a non-empty 'why' string."
    },
    {
      id: "eval_ri_target_titles_populate_after_confirmation",
      suite: "resume_intelligence",
      name: "Target titles populate after confirmation",
      description: "selectionFromRecommendation returns the strongest+adjacent titles in order so the UI can prefill onboarding pills.",
      inputSummary: "Recommendation with strongest and adjacent roles.",
      expectedBehavior: "selection.selectedRoles begins with the strongest role title."
    },
    {
      id: "eval_rimp_multi_column_to_single_column",
      suite: "resume_improvement",
      name: "Multi-column warning produces a single-column draft",
      description: "Resume parsed with pipes ('|') triggers a layout warning; the improver must produce a draft with no pipes.",
      inputSummary: "Pipe-delimited resume that triggers the multi-column warning.",
      expectedBehavior: "draftMarkdown has no '|' characters."
    },
    {
      id: "eval_rimp_skills_only_from_existing",
      suite: "resume_improvement",
      name: "Missing skills section creates skills only from existing skills",
      description: "If the resume mentions a skill, the draft should include a Skills section listing only existing skills.",
      inputSummary: "Resume mentioning Product Management and SQL.",
      expectedBehavior: "draftMarkdown contains a Skills section with both skills and no fabricated entries."
    },
    {
      id: "eval_rimp_no_invented_email",
      suite: "resume_improvement",
      name: "Missing email warning is not invented",
      description: "If the source resume lacks an email, the improvement draft must not invent one.",
      inputSummary: "Resume without an email line.",
      expectedBehavior: "draftMarkdown contains no email and warningsRemaining mentions email."
    },
    {
      id: "eval_rimp_no_fake_metrics",
      suite: "resume_improvement",
      name: "No fake metrics added",
      description: "When the source resume has no quantified achievements, the draft must not add fake numbers.",
      inputSummary: "Resume with no measurable outcomes.",
      expectedBehavior: "draftMarkdown contains no fabricated percentages or dollar amounts."
    },
    {
      id: "eval_rimp_original_not_overwritten",
      suite: "resume_improvement",
      name: "Original resume is not overwritten",
      description: "Saving an improved draft must keep the original resume accessible in version history.",
      inputSummary: "Resume saved → improved draft generated → saved.",
      expectedBehavior: "loadResumeVersions includes the original resume id and the improved resume id."
    },
    {
      id: "eval_rimp_saved_can_be_reanalyzed",
      suite: "resume_improvement",
      name: "Saved improved resume can be re-analyzed",
      description: "After saving a draft, re-analysing produces a fresh report keyed to the improved resume id.",
      inputSummary: "Saved improved resume.",
      expectedBehavior: "improvedReport.resumeId matches the improved resume id; draft.improvedRiskScore is set."
    },
    {
      id: "eval_rimp_risk_score_improves",
      suite: "resume_improvement",
      name: "Risk score improves when warnings are addressed",
      description: "An ATS-friendly draft should reduce the risk score below the original.",
      inputSummary: "Resume with multi-column layout + missing skills section.",
      expectedBehavior: "improvedRiskScore <= originalRiskScore after re-analysis."
    }
  ];

  return cases.map((item) => evalCaseSchema.parse({ ...base, ...item }));
}

export function loadEvalCases(session: AppSession): EvalCase[] {
  const cases = readJson<EvalCase[]>(evalCasesKey(session), []);
  return cases.filter((item) => evalCaseSchema.safeParse(item).success);
}

export function loadEvalRuns(session: AppSession): EvalRun[] {
  const runs = readJson<EvalRun[]>(evalRunsKey(session), []);
  return runs.filter((item) => evalRunSchema.safeParse(item).success);
}

export function loadEvalResults(session: AppSession): EvalResult[] {
  const results = readJson<EvalResult[]>(evalResultsKey(session), []);
  return results.filter((item) => evalResultSchema.safeParse(item).success);
}

function saveEvalCases(session: AppSession, cases: EvalCase[]): EvalCase[] {
  const parsed = cases.map((item) => evalCaseSchema.parse(item));
  writeJson(evalCasesKey(session), parsed);
  return parsed;
}

function saveEvalRuns(session: AppSession, runs: EvalRun[]): EvalRun[] {
  const parsed = runs.map((item) => evalRunSchema.parse(item));
  writeJson(evalRunsKey(session), parsed.slice(0, 50));
  return parsed;
}

function saveEvalResults(session: AppSession, results: EvalResult[]): EvalResult[] {
  const parsed = results.map((item) => evalResultSchema.parse(item));
  writeJson(evalResultsKey(session), parsed.slice(0, 500));
  return parsed;
}

function resultFor(
  session: AppSession,
  run: EvalRun,
  evalCase: EvalCase,
  status: EvalStatus,
  message: string,
  severity: EvalResult["severity"] = status === "passed" ? "info" : "warning"
): EvalResult {
  return evalResultSchema.parse({
    id: createId("eval_result"),
    tenantId: session.tenant.id,
    userId: session.userId,
    evalRunId: run.id,
    evalCaseId: evalCase.id,
    suite: evalCase.suite,
    name: evalCase.name,
    status,
    message,
    severity,
    createdAt: nowIso()
  });
}

async function scoreEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const adapter = new DeterministicScoringAdapter();
  const strongProfile = profile({ tenantId: session.tenant.id, userId: session.userId });
  const strongJob = job({ tenantId: session.tenant.id, userId: session.userId });
  const inputSession = evalSession(session);

  if (evalCase.id === "eval_match_strong_high") {
    const match = await adapter.scoreJob({
      session: inputSession,
      profile: strongProfile,
      job: strongJob,
      existingMatch: null
    });
    return resultFor(
      session,
      run,
      evalCase,
      match.overallScore >= 8 ? "passed" : "failed",
      `Strong match scored ${match.overallScore.toFixed(1)}.`
    );
  }

  if (evalCase.id === "eval_match_weak_low") {
    const match = await adapter.scoreJob({
      session: inputSession,
      profile: strongProfile,
      job: job({
        id: "job_eval_weak",
        title: "Onsite Payroll Accountant",
        company: "MismatchCo",
        location: "Tulsa, OK",
        remoteType: "onsite",
        salaryMin: 60000,
        salaryMax: 80000,
        description: "Own payroll accounting, month-end close, and invoice reconciliation for an onsite finance team.",
        responsibilities: ["Run payroll close"],
        requirements: ["Accounting experience"]
      }),
      existingMatch: null
    });
    return resultFor(
      session,
      run,
      evalCase,
      match.overallScore < 5.5 ? "passed" : "failed",
      `Weak match scored ${match.overallScore.toFixed(1)}.`
    );
  }

  if (evalCase.id === "eval_match_avoid_skip") {
    const match = await adapter.scoreJob({
      session: inputSession,
      profile: profile({ companiesToAvoid: ["ExampleCo"] }),
      job: strongJob,
      existingMatch: null
    });
    return resultFor(
      session,
      run,
      evalCase,
      match.recommendation === "skip" ? "passed" : "failed",
      `Avoid-list recommendation was ${match.recommendation}.`
    );
  }

  if (evalCase.id === "eval_match_incomplete_profile") {
    const match = await adapter.scoreJob({
      session: inputSession,
      profile: profile({
        fullName: "",
        email: "",
        targetTitles: [],
        targetIndustries: [],
        verifiedFacts: [],
        careerSummary: ""
      }),
      job: strongJob,
      existingMatch: null
    });
    const gapFound = match.topGaps.some((gap) =>
      gap.toLowerCase().includes("profile is incomplete")
    );
    return resultFor(
      session,
      run,
      evalCase,
      gapFound ? "passed" : "failed",
      gapFound ? "Incomplete profile gap was present." : "Incomplete profile gap was missing."
    );
  }

  const match = await adapter.scoreJob({
    session: inputSession,
    profile: strongProfile,
    job: job({
      id: "job_eval_low",
      title: "Facilities Coordinator",
      company: "LowFitCo",
      description: "Coordinate office supplies and onsite maintenance.",
      responsibilities: ["Stock office supplies"],
      requirements: ["Facilities coordination"],
      remoteType: "onsite",
      location: "Boise, ID"
    }),
    existingMatch: null
  });
  return resultFor(
    session,
    run,
    evalCase,
    queueFromRecommendation(match.recommendation) === "browse" ? "passed" : "failed",
    `Low-score recommendation ${match.recommendation} mapped to ${queueFromRecommendation(match.recommendation)}.`
  );
}

async function packageEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const generator = new DeterministicApplicationPackageGenerator();
  const baseJob = job();
  const baseProfile = profile();
  const baseResume = resume();
  const application = applicationRecord();

  if (evalCase.id === "eval_package_no_fake_claims") {
    const generated = await generator.generate({
      session: evalSession(session),
      application,
      profile: baseProfile,
      resume: baseResume,
      job: baseJob,
      match: null
    });
    const warnings = checkUnsupportedClaims({
      text: [
        generated.resumeMarkdown,
        generated.coverLetter,
        ...generated.answers.map((answer) => answer.answer)
      ].join("\n"),
      profile: baseProfile,
      resume: baseResume,
      job: baseJob
    });
    const noFakeTitle = !generated.resumeMarkdown.includes("Chief Revenue Officer");
    return resultFor(
      session,
      run,
      evalCase,
      warnings.length === 0 && noFakeTitle ? "passed" : "failed",
      `Generated package produced ${warnings.length} unsupported-claim warnings.`
    );
  }

  if (evalCase.id === "eval_package_fake_claim_checker") {
    const warnings = checkUnsupportedClaims({
      text:
        "I worked at Google as a Chief Revenue Officer, used Kubernetes, earned AWS Certified credentials, and improved conversion by 40%.",
      profile: baseProfile,
      resume: baseResume,
      job: baseJob
    });
    return resultFor(
      session,
      run,
      evalCase,
      warnings.length >= 4 ? "passed" : "failed",
      `Unsupported-claim checker returned ${warnings.length} warnings.`
    );
  }

  const generated = await generator.generate({
    session: evalSession(session),
    application,
    profile: profile({
      verifiedFacts: [],
      careerSummary: "",
      targetTitles: [],
      targetIndustries: []
    }),
    resume: {
      ...baseResume,
      parsedText:
        "Resume text extraction has not run yet. Add verified facts before using this resume."
    },
    job: baseJob,
    match: null
  });
  const hasLowConfidenceAnswer = generated.answers.some(
    (answer) => answer.confidence === "low" && answer.needsUserReview
  );
  return resultFor(
    session,
    run,
    evalCase,
    hasLowConfidenceAnswer ? "passed" : "failed",
    hasLowConfidenceAnswer
      ? "Missing evidence produced low-confidence answers."
      : "Missing evidence did not lower answer confidence."
  );
}

async function atsEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const greenhouseAdapter = new GreenhouseATSAdapter();
  const leverAdapter = new LeverATSAdapter();
  const baseProfile = profile();
  const basePackage = applicationPackage("approved");
  const baseAnswers = applicationAnswers();

  if (evalCase.id === "eval_ats_greenhouse_fixture_detection") {
    const detection = greenhouseAdapter.detect(greenhouseFixturePage());
    return resultFor(
      session,
      run,
      evalCase,
      detection.adapterType === "greenhouse" && detection.confidence >= 0.8
        ? "passed"
        : "failed",
      `Detected ${detection.adapterType} at ${Math.round(detection.confidence * 100)}% confidence.`
    );
  }

  if (evalCase.id === "eval_ats_lever_fixture_detection") {
    const detection = leverAdapter.detect(leverFixturePage());
    return resultFor(
      session,
      run,
      evalCase,
      detection.adapterType === "lever" && detection.confidence >= 0.8
        ? "passed"
        : "failed",
      `Detected ${detection.adapterType} at ${Math.round(detection.confidence * 100)}% confidence.`
    );
  }

  if (evalCase.id === "eval_ats_safe_field_mapping") {
    const form = greenhouseAdapter.analyzeForm(greenhouseFixturePage());
    const plan = greenhouseAdapter.createFillPlan(baseProfile, basePackage, form, {
      answers: baseAnswers,
      resume: resume(),
      mode: "dry_run"
    });
    const filled = new Set(plan.fieldsFilled.map((field) => field.fieldId));
    const passed =
      [...filled].some((fieldId) => fieldId.includes("first_name")) &&
      [...filled].some((fieldId) => fieldId.includes("email")) &&
      [...filled].some((fieldId) => fieldId.includes("resume")) &&
      plan.fieldsFilled.some((field) => field.source === "application_answer");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Fill plan mapped ${plan.fieldsFilled.length} safe fields.`
    );
  }

  if (evalCase.id === "eval_ats_uncertain_field_pause") {
    const form = greenhouseAdapter.analyzeForm(greenhouseFixturePage());
    const plan = greenhouseAdapter.createFillPlan(baseProfile, basePackage, form, {
      answers: [],
      resume: resume(),
      mode: "dry_run"
    });
    const reasons = plan.uncertainFields.map((field) => field.reason);
    const passed =
      reasons.includes("low_confidence") ||
      reasons.includes("unclear_required") ||
      reasons.includes("final_submit");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Pause reasons: ${reasons.join(", ")}.`
    );
  }

  if (evalCase.id === "eval_ats_no_submit_without_approval") {
    const adapter = createATSBrowserAutomationAdapter();
    const submit = await adapter.submit({
      id: "browser_eval",
      tenantId: session.tenant.id,
      userId: session.userId,
      jobId: "job_eval",
      applicationRecordId: "app_eval",
      applicationPackageId: "pkg_eval",
      atsType: "greenhouse",
      adapterName: "greenhouse-ats-adapter",
      adapterConfidence: 0.95,
      fillMode: "dry_run",
      status: "ready_for_review",
      fieldsDetected: [],
      fieldsFilled: [],
      uncertainFields: [],
      fillPlan: [],
      screenshotUrl: null,
      errorMessage: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    });
    return resultFor(
      session,
      run,
      evalCase,
      !submit.submitted && !submit.confirmationDetected ? "passed" : "failed",
      submit.message ?? "Submit result did not include a message."
    );
  }

  if (evalCase.id === "eval_real_site_greenhouse_summary") {
    const realSite = createDryRunSnapshot(session, {
      sourceUrl: "https://boards.greenhouse.io/example/jobs/1234567"
    });
    const passed =
      realSite.snapshot.atsType === "greenhouse" &&
      realSite.snapshot.adapterConfidence >= 0.8 &&
      realSite.snapshot.submitBlocked &&
      realSite.snapshot.validationSummary.adapterDetectedCorrectly &&
      realSite.snapshot.validationSummary.submitBlocked;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Snapshot ${realSite.snapshot.atsType} at ${Math.round(realSite.snapshot.adapterConfidence * 100)}% confidence; submit blocked=${realSite.snapshot.submitBlocked}.`
    );
  }

  if (evalCase.id === "eval_real_site_lever_summary") {
    const realSite = createDryRunSnapshot(session, {
      sourceUrl: "https://jobs.lever.co/example/abc123"
    });
    const passed =
      realSite.snapshot.atsType === "lever" &&
      realSite.snapshot.adapterConfidence >= 0.8 &&
      realSite.snapshot.submitBlocked &&
      realSite.snapshot.validationSummary.adapterDetectedCorrectly &&
      realSite.snapshot.validationSummary.submitBlocked;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Snapshot ${realSite.snapshot.atsType} at ${Math.round(realSite.snapshot.adapterConfidence * 100)}% confidence; submit blocked=${realSite.snapshot.submitBlocked}.`
    );
  }

  if (evalCase.id === "eval_real_site_token_redaction") {
    const tokenValue = "abcdef1234567890abcdef1234567890";
    const realSite = createDryRunSnapshot(session, {
      sourceUrl: `https://boards.greenhouse.io/example/jobs/123?token=${tokenValue}&code=oauthcode1234567890&api_key=keyABC`
    });
    const containsToken = realSite.snapshot.redactedUrl.includes(tokenValue);
    const containsRedactedMarker =
      realSite.snapshot.redactedUrl.includes("[redacted-token]");
    const passed = !containsToken && containsRedactedMarker;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Redacted URL: ${realSite.snapshot.redactedUrl}`
    );
  }

  if (evalCase.id === "eval_real_site_value_redaction") {
    const realSite = createDryRunSnapshot(session, {
      sourceUrl:
        "https://boards.greenhouse.io/example/jobs/123?email=jane.doe@example.com&phone=+1-555-0100"
    });
    const passed =
      !realSite.snapshot.redactedUrl.includes("jane.doe@example.com") &&
      !realSite.snapshot.redactedUrl.includes("555-0100") &&
      realSite.snapshot.redactedUrl.includes("[redacted-value]");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Redacted URL: ${realSite.snapshot.redactedUrl}`
    );
  }

  if (evalCase.id === "eval_real_site_submit_always_blocked") {
    const sessionWithExt: ExtensionSession = {
      id: "ext_eval_block",
      tenantId: session.tenant.id,
      userId: session.userId,
      extensionInstanceId: "eval",
      pageUrl: "https://boards.greenhouse.io/example/jobs/777",
      pageTitle: "Eval Page",
      hostname: "boards.greenhouse.io",
      status: "submit_approved",
      applicationPackageId: null,
      applicationRecordId: null,
      jobId: null,
      browserApplicationSessionId: null,
      fieldsDetected: [
        {
          id: "greenhouse_first_name",
          label: "First name",
          fieldType: "text",
          required: true,
          sensitive: false,
          confidence: 0.93,
          source: "profile",
          sourceField: "fullName"
        }
      ],
      fieldsFilled: [],
      uncertainFields: [],
      fillPlan: [
        {
          fieldId: "greenhouse_first_name",
          label: "First name",
          action: "fill",
          source: "profile",
          sourceField: "fullName",
          valuePreview: "Saved profile field: fullName",
          confidence: 0.93,
          reason: ""
        }
      ],
      pageStructureHash: "hash",
      authorizedAt: nowIso(),
      fillApprovedAt: nowIso(),
      submitApprovedAt: nowIso(),
      submittedAt: null,
      disconnectedAt: null,
      errorMessage: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const realSite = createDryRunSnapshot(session, {
      sourceUrl: "https://boards.greenhouse.io/example/jobs/777",
      extensionSession: sessionWithExt
    });
    const passed =
      realSite.snapshot.submitBlocked &&
      realSite.snapshot.validationSummary.submitBlocked;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `submitBlocked=${realSite.snapshot.submitBlocked}; reason=${realSite.snapshot.submitBlockedReason}`
    );
  }

  if (evalCase.id === "eval_real_site_sensitive_paused") {
    const sensitiveExt: ExtensionSession = {
      id: "ext_eval_sensitive",
      tenantId: session.tenant.id,
      userId: session.userId,
      extensionInstanceId: "eval",
      pageUrl: "https://boards.greenhouse.io/example/jobs/888",
      pageTitle: "Eval Page",
      hostname: "boards.greenhouse.io",
      status: "fill_plan_ready",
      applicationPackageId: null,
      applicationRecordId: null,
      jobId: null,
      browserApplicationSessionId: null,
      fieldsDetected: [
        {
          id: "greenhouse_eeoc_gender",
          label: "Gender",
          fieldType: "select",
          required: false,
          sensitive: true,
          confidence: 0.18,
          source: "user_required",
          sourceField: "demographic defaults"
        }
      ],
      fieldsFilled: [],
      uncertainFields: [
        {
          fieldId: "greenhouse_eeoc_gender",
          label: "Gender",
          reason: "demographic",
          required: false,
          guidance: "Voluntary demographic questions require manual input."
        }
      ],
      fillPlan: [
        {
          fieldId: "greenhouse_eeoc_gender",
          label: "Gender",
          action: "pause",
          source: "user_required",
          sourceField: "demographic defaults",
          valuePreview: "User review required",
          confidence: 0.18,
          reason: "Voluntary demographic questions require manual input."
        }
      ],
      pageStructureHash: "hash",
      authorizedAt: nowIso(),
      fillApprovedAt: null,
      submitApprovedAt: null,
      submittedAt: null,
      disconnectedAt: null,
      errorMessage: "",
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const realSite = createDryRunSnapshot(session, {
      sourceUrl: "https://boards.greenhouse.io/example/jobs/888",
      extensionSession: sensitiveExt
    });
    const passed =
      realSite.snapshot.sensitiveFieldCount === 1 &&
      realSite.snapshot.pausedFieldCount >= 1 &&
      realSite.snapshot.validationSummary.sensitiveFieldsPaused;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Sensitive=${realSite.snapshot.sensitiveFieldCount} paused=${realSite.snapshot.pausedFieldCount}`
    );
  }

  const greenhousePlan = greenhouseAdapter.createFillPlan(
    baseProfile,
    basePackage,
    greenhouseAdapter.analyzeForm(greenhouseFixturePage()),
    { answers: baseAnswers, resume: resume(), mode: "dry_run" }
  );
  const leverPlan = leverAdapter.createFillPlan(
    baseProfile,
    basePackage,
    leverAdapter.analyzeForm(leverFixturePage()),
    { answers: baseAnswers, resume: resume(), mode: "dry_run" }
  );
  const demographicFilled = [...greenhousePlan.fieldsFilled, ...leverPlan.fieldsFilled]
    .some((field) => field.sourceField === "demographic defaults");
  const demographicPaused = [...greenhousePlan.uncertainFields, ...leverPlan.uncertainFields]
    .some((field) => field.reason === "demographic");
  return resultFor(
    session,
    run,
    evalCase,
    !demographicFilled && demographicPaused ? "passed" : "failed",
    demographicPaused
      ? "Demographic fields paused without default answers."
      : "Demographic pause was missing."
  );
}

async function browserEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const sandbox = evalSession(session);
  const app = applicationRecord({
    tenantId: sandbox.tenant.id,
    userId: sandbox.userId
  });
  saveApplications(sandbox, [app]);
  const approvedPackage = applicationPackage("approved");
  const answers = applicationAnswers();
  const baseContext = {
    session: sandbox,
    actorUserId: sandbox.userId,
    applicationPackage: approvedPackage,
    application: app,
    job: job(),
    profile: profile({ tenantId: sandbox.tenant.id, userId: sandbox.userId }),
    resume: resume(),
    answers
  };

  if (evalCase.id === "eval_browser_approved_package_required") {
    try {
      await startBrowserApplicationSession({
        ...baseContext,
        applicationPackage: applicationPackage("ready_for_review")
      });
      return resultFor(session, run, evalCase, "failed", "Unapproved package started.");
    } catch {
      return resultFor(session, run, evalCase, "passed", "Unapproved package was blocked.");
    }
  }

  const started = await startBrowserApplicationSession(baseContext);

  if (evalCase.id === "eval_browser_submit_approval_required") {
    const ready = markBrowserSessionReadyForReview(sandbox, started.session.id);
    try {
      await submitApprovedBrowserApplication(sandbox, ready.session.id);
      return resultFor(session, run, evalCase, "failed", "Submit ran before approval.");
    } catch {
      return resultFor(session, run, evalCase, "passed", "Submit before approval was blocked.");
    }
  }

  if (evalCase.id === "eval_browser_sensitive_pause") {
    const reasons = started.session.uncertainFields.map((field) => field.reason);
    const passed = reasons.includes("demographic") && reasons.includes("final_submit");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Pause reasons: ${reasons.join(", ")}.`
    );
  }

  if (evalCase.id === "eval_browser_captcha_login_pause") {
    const linkedInStarted = await startBrowserApplicationSession({
      ...baseContext,
      job: job({
        id: "job_eval_linkedin",
        applicationUrl: "https://linkedin.com/jobs/view/123",
        atsType: "api"
      })
    });
    const reasons = linkedInStarted.session.uncertainFields.map((field) => field.reason);
    const passed = reasons.includes("captcha") && reasons.includes("login_challenge");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Pause reasons: ${reasons.join(", ")}.`
    );
  }

  if (evalCase.id === "eval_browser_manual_fallback") {
    const manual = markBrowserSessionManualRequired(
      sandbox,
      started.session.id,
      "Eval requires manual fallback."
    );
    return resultFor(
      session,
      run,
      evalCase,
      manual.session.status === "manual_required" ? "passed" : "failed",
      `Manual fallback status was ${manual.session.status}.`
    );
  }

  const ready = markBrowserSessionReadyForReview(sandbox, started.session.id);
  try {
    approveBrowserSubmit(sandbox, ready.session.id, {
      actorUserId: "coach_or_admin",
      approvedByUser: true
    });
    return resultFor(session, run, evalCase, "failed", "Non-job-seeker approved submit.");
  } catch {
    return resultFor(session, run, evalCase, "passed", "Non-job-seeker approval was blocked.");
  }
}

async function careerOpsEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const sandbox = evalSession(session);
  // Each Career Ops eval gets a fresh sandbox so state from one eval cannot
  // leak into the next. The browser localStorage mock used in tests does not
  // expose enumerable keys, so clearScopedWorkspace silently no-ops there;
  // we explicitly remove the keys we know this eval writes.
  clearScopedWorkspace(sandbox.tenant.id, sandbox.userId);
  if (typeof window !== "undefined") {
    [
      "profile",
      "resume",
      "normalized_jobs",
      "applications",
      "application_packages",
      "application_answers",
      "job_matches",
      "job_source_configs",
      "scan_runs",
      "career_ops_runs",
      "career_ops_settings",
      "audit_logs",
      "feedback_events",
      "usage_metering_events"
    ].forEach((resource) => {
      window.localStorage.removeItem(
        scopedKey(sandbox.tenant.id, sandbox.userId, resource)
      );
    });
  }

  function seedProfile(overrides: Partial<UserProfile> = {}) {
    const merged = userProfileSchema.parse({
      ...profile(),
      ...overrides,
      tenantId: sandbox.tenant.id,
      userId: sandbox.userId
    });
    writeJson(scopedKey(sandbox.tenant.id, sandbox.userId, "profile"), merged);
  }

  function seedJobs(jobs: NormalizedJob[]) {
    const scoped = jobs.map((item) =>
      ({ ...item, tenantId: sandbox.tenant.id, userId: sandbox.userId })
    );
    saveNormalizedJobs(sandbox, scoped);
  }

  if (evalCase.id === "eval_career_ops_idempotent_jobs") {
    seedProfile();
    seedJobs([job({ id: "job_idem_1", scoringStatus: "queued" })]);
    const first = await runCareerOps(sandbox);
    const second = await runCareerOps(sandbox);
    const passed =
      loadNormalizedJobs(sandbox).length === 1 &&
      second.run.jobsScored === 0;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `First run scored ${first.run.jobsScored}; second run scored ${second.run.jobsScored}; total jobs ${loadNormalizedJobs(sandbox).length}.`
    );
  }

  if (evalCase.id === "eval_career_ops_avoided_company_no_package") {
    seedProfile({ companiesToAvoid: ["BlockedCo"] });
    seedJobs([
      job({
        id: "job_blocked",
        company: "BlockedCo",
        title: "Staff Product Manager",
        scoringStatus: "queued"
      })
    ]);
    saveCareerOpsSettings(sandbox, {
      preparePackagesForHighScoreJobs: true,
      highScoreThreshold: 0
    });
    const result = await runCareerOps(sandbox);
    const packagesAfter = loadApplicationPackages(sandbox);
    const passed =
      result.run.packagesPrepared === 0 &&
      packagesAfter.length === 0 &&
      result.run.digestSummary.warnings.some((warning) =>
        warning.toLowerCase().includes("avoided")
      );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Packages prepared: ${result.run.packagesPrepared}; warnings: ${result.run.digestSummary.warnings.join(" | ")}`
    );
  }

  if (evalCase.id === "eval_career_ops_incomplete_profile_warning") {
    // Intentionally do not seed a profile.
    seedJobs([job({ id: "job_incomplete", scoringStatus: "queued" })]);
    const result = await runCareerOps(sandbox);
    const passed = result.run.digestSummary.warnings.some((warning) =>
      warning.toLowerCase().includes("profile is incomplete")
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Warnings: ${result.run.digestSummary.warnings.join(" | ")}`
    );
  }

  if (evalCase.id === "eval_career_ops_high_score_routes_to_apply") {
    seedProfile();
    seedJobs([
      job({ id: "job_strong", scoringStatus: "queued" })
    ]);
    const result = await runCareerOps(sandbox);
    const passed = result.run.applyReviewCount >= 1;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Apply: ${result.run.applyReviewCount} / Maybe: ${result.run.maybeCount} / Browse: ${result.run.browseCount}`
    );
  }

  if (evalCase.id === "eval_career_ops_low_score_browsable") {
    seedProfile({ targetTitles: ["Underwater Welder"], targetIndustries: ["Welding"] });
    seedJobs([
      job({
        id: "job_weak",
        title: "Junior Florist",
        company: "Bouquets Inc",
        description: "Floral arrangement.",
        responsibilities: ["Trim stems"],
        requirements: ["Floral training"],
        scoringStatus: "queued"
      })
    ]);
    const result = await runCareerOps(sandbox);
    const passed = result.run.browseCount >= 1;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Apply: ${result.run.applyReviewCount} / Maybe: ${result.run.maybeCount} / Browse: ${result.run.browseCount}`
    );
  }

  if (evalCase.id === "eval_career_ops_no_submit_actions") {
    seedProfile();
    seedJobs([job({ id: "job_no_submit", scoringStatus: "queued" })]);
    saveCareerOpsSettings(sandbox, {
      preparePackagesForHighScoreJobs: true,
      highScoreThreshold: 0
    });
    const before = loadApplications(sandbox).length;
    const result = await runCareerOps(sandbox);
    const after = loadApplications(sandbox);
    const submittedAfter = after.filter((app) => app.status === "submitted").length;
    const submitAuditFired = result.auditEvents.some(
      (event) => event.action === "application_submitted"
    );
    const passed =
      submittedAfter === 0 && !submitAuditFired && after.length >= before;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Submitted apps: ${submittedAfter}; submit audit fired: ${submitAuditFired}.`
    );
  }

  return resultFor(
    session,
    run,
    evalCase,
    "failed",
    `Unknown career_ops eval: ${evalCase.id}`,
    "warning"
  );
}

async function intelligenceEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const sandbox = evalSession(session);
  if (typeof window !== "undefined") {
    [
      "profile",
      "resume",
      "normalized_jobs",
      "applications",
      "application_packages",
      "application_answers",
      "job_matches",
      "job_source_configs",
      "scan_runs",
      "career_ops_runs",
      "career_ops_settings",
      "company_intelligence",
      "recruiter_leads",
      "job_risk_signals",
      "audit_logs"
    ].forEach((resource) => {
      window.localStorage.removeItem(
        scopedKey(sandbox.tenant.id, sandbox.userId, resource)
      );
    });
  }

  if (evalCase.id === "eval_intel_suspicious_domain") {
    const signals = detectJobRiskSignals(
      job({
        id: "job_susp",
        applicationUrl: "https://bit.ly/abc123def",
        scoringStatus: "queued"
      })
    );
    const passed = signals.some(
      (signal) =>
        signal.riskType === "suspicious_domain" && signal.severity === "high"
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Risk signals: ${signals.map((s) => s.riskType).join(", ") || "none"}`
    );
  }

  if (evalCase.id === "eval_intel_fee_request") {
    const signals = detectJobRiskSignals(
      job({
        id: "job_fee",
        description:
          "Send your resume and a $250 training fee to start onboarding immediately.",
        scoringStatus: "queued"
      })
    );
    const passed = signals.some(
      (signal) =>
        signal.riskType === "fee_request" && signal.severity === "high"
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Risk signals: ${signals.map((s) => s.riskType).join(", ") || "none"}`
    );
  }

  if (evalCase.id === "eval_intel_vague_description") {
    const signals = detectJobRiskSignals(
      job({
        id: "job_vague",
        description: "Hiring now. Apply.",
        responsibilities: [],
        requirements: [],
        scoringStatus: "queued"
      })
    );
    const passed = signals.some((signal) => signal.riskType === "vague_description");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Risk signals: ${signals.map((s) => s.riskType).join(", ") || "none"}`
    );
  }

  if (evalCase.id === "eval_intel_marked_estimated") {
    const result = await generateCompanyIntelligence(
      sandbox,
      job({ id: "job_intel" }),
      profile()
    );
    const passed =
      result.intelligence.source === "deterministic" &&
      result.intelligence.confidence === "low";
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `source=${result.intelligence.source} confidence=${result.intelligence.confidence}`
    );
  }

  if (evalCase.id === "eval_intel_no_invented_recruiters") {
    const result = addRecruiterLead(sandbox, {
      jobId: "job_recruiter",
      company: "ExampleCo",
      name: ""
    });
    const passed = result.lead.name === "" && result.lead.source === "manual";
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `lead.name=${JSON.stringify(result.lead.name)} source=${result.lead.source}`
    );
  }

  if (evalCase.id === "eval_intel_high_risk_blocks_package_prep") {
    // Reuse the standard strong-fit job content so it scores high enough to
    // land in apply_review, then swap in a suspicious-domain URL so it also
    // trips a high-severity risk signal.
    const highRiskJob = job({
      id: "job_highrisk",
      applicationUrl: "https://bit.ly/highrisk",
      scoringStatus: "queued"
    });
    // Seed sandbox profile + job + settings with package prep enabled.
    const seededProfile = userProfileSchema.parse({
      ...profile(),
      tenantId: sandbox.tenant.id,
      userId: sandbox.userId
    });
    writeJson(
      scopedKey(sandbox.tenant.id, sandbox.userId, "profile"),
      seededProfile
    );
    saveNormalizedJobs(sandbox, [
      { ...highRiskJob, tenantId: sandbox.tenant.id, userId: sandbox.userId }
    ]);
    saveCareerOpsSettings(sandbox, {
      preparePackagesForHighScoreJobs: true,
      highScoreThreshold: 0,
      overrideHighRiskPackagePrep: false
    });
    const blockedRun = await runCareerOps(sandbox);
    const blockedPackages = loadApplicationPackages(sandbox).length;
    const blockedWarning = blockedRun.run.digestSummary.warnings.some((w) =>
      w.toLowerCase().includes("high-risk")
    );

    saveCareerOpsSettings(sandbox, {
      overrideHighRiskPackagePrep: true
    });
    const overrideRun = await runCareerOps(sandbox);
    const overridePackages = loadApplicationPackages(sandbox).length;

    const passed =
      blockedPackages === 0 &&
      blockedWarning &&
      overridePackages >= blockedPackages &&
      overrideRun.run.status === "completed";
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `blockedPackages=${blockedPackages} blockedWarning=${blockedWarning} overridePackages=${overridePackages}`
    );
  }

  return resultFor(
    session,
    run,
    evalCase,
    "failed",
    `Unknown company_intelligence eval: ${evalCase.id}`,
    "warning"
  );
}

async function onboardingEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const sandbox = evalSession(session);
  if (typeof window !== "undefined") {
    [
      "profile",
      "resume",
      "normalized_jobs",
      "applications",
      "application_packages",
      "application_answers",
      "job_matches",
      "job_source_configs",
      "scan_runs",
      "career_ops_runs",
      "career_ops_settings",
      "company_intelligence",
      "recruiter_leads",
      "job_risk_signals",
      "audit_logs",
      "onboarding_state"
    ].forEach((resource) => {
      window.localStorage.removeItem(
        scopedKey(sandbox.tenant.id, sandbox.userId, resource)
      );
    });
  }

  const sandboxProfile = userProfileSchema.parse({
    ...profile(),
    tenantId: sandbox.tenant.id,
    userId: sandbox.userId
  });

  if (evalCase.id === "eval_onboarding_product_role_returns_product_jobs") {
    const result = await recommendApplyReadyJobs(sandbox, {
      targetRoles: ["Senior Product Manager"],
      profile: sandboxProfile,
      allowDemoJobs: true
    });
    const passed = result.jobs.some((job) =>
      job.title.toLowerCase().includes("product")
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Demo jobs: ${result.jobs.map((j) => j.title).join(", ") || "none"}`
    );
  }

  if (evalCase.id === "eval_onboarding_data_role_returns_data_jobs") {
    const result = await recommendApplyReadyJobs(sandbox, {
      targetRoles: ["Senior Data Scientist"],
      profile: sandboxProfile,
      allowDemoJobs: true
    });
    const passed = result.jobs.some((job) => {
      const title = job.title.toLowerCase();
      return title.includes("data") || title.includes("analyt") || title.includes("ml");
    });
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `Demo jobs: ${result.jobs.map((j) => j.title).join(", ") || "none"}`
    );
  }

  if (evalCase.id === "eval_onboarding_demo_jobs_when_empty") {
    const result = await recommendApplyReadyJobs(sandbox, {
      targetRoles: ["Senior Product Manager"],
      profile: sandboxProfile,
      allowDemoJobs: true
    });
    const allDemo = result.jobs.every((job) => isDemoJob(job));
    const passed =
      result.showsDemoBanner && result.jobs.length > 0 && allDemo;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `showsDemoBanner=${result.showsDemoBanner} jobs=${result.jobs.length} allDemo=${allDemo}`
    );
  }

  if (evalCase.id === "eval_onboarding_strong_first") {
    const result = await recommendApplyReadyJobs(sandbox, {
      targetRoles: ["Senior Product Manager"],
      profile: sandboxProfile,
      allowDemoJobs: true
    });
    const strongGroup = result.groups.find(
      (group) => group.label === "Strong matches"
    );
    const passed = (strongGroup?.matches.length ?? 0) > 0;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `strongCount=${strongGroup?.matches.length ?? 0}`
    );
  }

  if (evalCase.id === "eval_onboarding_no_submit") {
    const result = await recommendApplyReadyJobs(sandbox, {
      targetRoles: ["Senior Product Manager"],
      profile: sandboxProfile,
      allowDemoJobs: true
    });
    const apps = loadApplications(sandbox);
    const submittedApps = apps.filter((app) => app.status === "submitted").length;
    const submitAuditFired = result.auditEvents.some(
      (event) => event.action === "application_submitted"
    );
    const passed = submittedApps === 0 && !submitAuditFired;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `submittedApps=${submittedApps} submitAuditFired=${submitAuditFired}`
    );
  }

  if (evalCase.id === "eval_onboarding_completes_after_review") {
    const recommended = await recommendApplyReadyJobs(sandbox, {
      targetRoles: ["Senior Product Manager"],
      profile: sandboxProfile,
      allowDemoJobs: true
    });
    const firstJob = recommended.jobs[0];
    if (!firstJob) {
      return resultFor(session, run, evalCase, "failed", "No demo job available");
    }
    await recordOnboardingJobReviewed(sandbox, firstJob.id);
    await recordOnboardingCompleted(sandbox, "user_started_review");
    const state = loadOnboardingState(sandbox);
    const passed = Boolean(state.onboardingCompletedAt);
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `onboardingCompletedAt=${state.onboardingCompletedAt ?? "null"}`
    );
  }

  if (evalCase.id === "eval_onboarding_demo_clearly_marked") {
    const result = await recommendApplyReadyJobs(sandbox, {
      targetRoles: ["Senior Product Manager"],
      profile: sandboxProfile,
      allowDemoJobs: true
    });
    const allMarked = result.jobs.every(
      (job) =>
        isDemoJob(job) && job.description.startsWith("[Demo job]")
    );
    return resultFor(
      session,
      run,
      evalCase,
      allMarked ? "passed" : "failed",
      `allMarked=${allMarked} sample=${result.jobs[0]?.id ?? "none"}`
    );
  }

  return resultFor(
    session,
    run,
    evalCase,
    "failed",
    `Unknown onboarding eval: ${evalCase.id}`,
    "warning"
  );
}

async function resumeIntelligenceEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const sandbox = evalSession(session);
  if (typeof window !== "undefined") {
    [
      "resume",
      "resume_intelligence_reports",
      "job_target_recommendations",
      "audit_logs",
      "profile"
    ].forEach((resource) => {
      window.localStorage.removeItem(
        scopedKey(sandbox.tenant.id, sandbox.userId, resource)
      );
    });
  }

  function makeResume(text: string): Resume {
    const now = nowIso();
    return {
      id: "resume_eval",
      tenantId: sandbox.tenant.id,
      userId: sandbox.userId,
      originalFileName: "resume.txt",
      fileUrl: "local://resume.txt",
      parsedText: text,
      status: "parsed",
      createdAt: now
    };
  }

  const cleanProductResume = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe
https://github.com/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; partnered with engineering and design.
Shipped major roadmap; +20% activation, +12% retention.
Customer discovery interviews; led cross-functional team of 4 engineers.

Skills
Product Management, Roadmap, Customer Discovery, SQL, Figma`;

  if (evalCase.id === "eval_ri_clean_resume_high_confidence") {
    const result = await analyzeResumeIntelligence(
      sandbox,
      makeResume(cleanProductResume)
    );
    const report = result.report;
    const passed =
      report.confidenceByField.fullName === "high" &&
      report.confidenceByField.email === "high" &&
      report.confidenceByField.linkedinUrl === "high" &&
      report.atsRiskLevel === "low";
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `name=${report.confidenceByField.fullName} email=${report.confidenceByField.email} linkedin=${report.confidenceByField.linkedinUrl} risk=${report.atsRiskLevel}`
    );
  }

  if (evalCase.id === "eval_ri_missing_email_warning") {
    const text = cleanProductResume.replace(/jane\.doe@example\.com\n/, "");
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const passed =
      result.report.missingFields.includes("email") &&
      result.report.suggestedFixes.some(
        (fix) => fix.field === "email" && fix.severity === "high"
      );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `missing=${result.report.missingFields.join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_missing_phone_warning") {
    const text = cleanProductResume.replace(/\+1 555-555-0100\n/, "");
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const passed =
      result.report.missingFields.includes("phone") &&
      result.report.suggestedFixes.some((fix) => fix.field === "phone");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `missing=${result.report.missingFields.join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_unclear_dates_warning") {
    const text = cleanProductResume.replace(/2022 - 2026/, "recently");
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const passed = result.report.ambiguousFields.includes("dates");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `ambiguous=${result.report.ambiguousFields.join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_no_quantified_creates_suggestion") {
    const text = `Jane Doe\nSenior Product Manager\nRemote\njane.doe@example.com\n+1 555-555-0100\nhttps://www.linkedin.com/in/janedoe\n\nExperience\nSenior Product Manager — DemoLabs — 2022 - 2026\nWorked on roadmap and discovery.\nSkills\nProduct Management, Roadmap`;
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const passed = result.report.suggestedFixes.some(
      (fix) => fix.field === "quantifiedAchievements"
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `fixes=${result.report.suggestedFixes.map((f) => f.field).join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_table_layout_warning") {
    const text = `Jane Doe | Senior PM | jane@example.com | +1 555-555-0100\nLinkedIn | https://www.linkedin.com/in/janedoe`;
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const passed = result.report.parsingWarnings.some((warning) =>
      warning.toLowerCase().includes("multi-column")
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `warnings=${result.report.parsingWarnings.join(" | ")}`
    );
  }

  if (evalCase.id === "eval_ri_skills_not_invented") {
    const text = `Jane Doe\nNo recognisable role keywords here. Just personal description.`;
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const passed = result.report.extractedProfile.skills.length === 0;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `skills=${result.report.extractedProfile.skills.join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_product_role_recommendation") {
    const result = await analyzeResumeIntelligence(
      sandbox,
      makeResume(cleanProductResume)
    );
    const titles = result.recommendation.strongestRoles.map((role) =>
      role.title.toLowerCase()
    );
    const passed = titles.some((title) => title.includes("product"));
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `strongest=${titles.join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_data_role_recommendation") {
    const text = `Jane Doe
Senior Data Engineer
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Data Engineer — DemoData — 2022 - 2026
Built data pipelines, owned the warehouse and analytics ETL.
Snowflake, Airflow, SQL, dbt.

Skills
Data Engineering, SQL, Pipelines, Snowflake`;
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const titles = result.recommendation.strongestRoles.map((role) =>
      role.title.toLowerCase()
    );
    const passed = titles.some(
      (title) => title.includes("data") || title.includes("analyt")
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `strongest=${titles.join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_ai_role_recommendation") {
    const text = `Jane Doe
AI Engineer
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
AI Engineer — DemoAI — 2022 - 2026
Shipped LLM agents and RAG systems; built model evals across prompts and tools.

Skills
LLM, Agents, RAG, Model Evals, Python`;
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const titles = result.recommendation.strongestRoles.map((role) =>
      role.title.toLowerCase()
    );
    const passed = titles.some((title) => title.includes("ai"));
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `strongest=${titles.join(",")}`
    );
  }

  if (evalCase.id === "eval_ri_stretch_clearly_labeled") {
    const result = await analyzeResumeIntelligence(
      sandbox,
      makeResume(cleanProductResume)
    );
    const passed = result.recommendation.stretchRoles.every(
      (role) => role.fitLevel === "stretch" && role.confidence === "low"
    );
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `stretchCount=${result.recommendation.stretchRoles.length}`
    );
  }

  if (evalCase.id === "eval_ri_no_strong_without_evidence") {
    const text = `Jane Doe\nNo recognisable role keywords here. Just personal description.\njane.doe@example.com\n+1 555-555-0100\nhttps://www.linkedin.com/in/janedoe`;
    const result = await analyzeResumeIntelligence(sandbox, makeResume(text));
    const passed = result.recommendation.strongestRoles.length === 0;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `strongCount=${result.recommendation.strongestRoles.length}`
    );
  }

  if (evalCase.id === "eval_ri_avoid_includes_explanation") {
    const result = await analyzeResumeIntelligence(
      sandbox,
      makeResume(cleanProductResume)
    );
    const allHaveWhy = result.recommendation.rolesToAvoid.every(
      (role) => role.why.trim().length > 0
    );
    return resultFor(
      session,
      run,
      evalCase,
      allHaveWhy ? "passed" : "failed",
      `avoidCount=${result.recommendation.rolesToAvoid.length}`
    );
  }

  if (evalCase.id === "eval_ri_target_titles_populate_after_confirmation") {
    const result = await analyzeResumeIntelligence(
      sandbox,
      makeResume(cleanProductResume)
    );
    const selection = selectionFromRecommendation(result.recommendation);
    const firstStrong = result.recommendation.strongestRoles[0]?.title ?? "";
    const passed =
      selection.selectedRoles.length > 0 && selection.selectedRoles[0] === firstStrong;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `firstSelected=${selection.selectedRoles[0] ?? "none"}`
    );
  }

  return resultFor(
    session,
    run,
    evalCase,
    "failed",
    `Unknown resume_intelligence eval: ${evalCase.id}`,
    "warning"
  );
}

async function resumeImprovementEval(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  const sandbox = evalSession(session);
  if (typeof window !== "undefined") {
    [
      "resume",
      "resume_versions",
      "resume_intelligence_reports",
      "job_target_recommendations",
      "resume_improvement_drafts",
      "audit_logs"
    ].forEach((resource) => {
      window.localStorage.removeItem(
        scopedKey(sandbox.tenant.id, sandbox.userId, resource)
      );
    });
  }

  function makeResume(text: string, id = "resume_eval"): Resume {
    const now = nowIso();
    return {
      id,
      tenantId: sandbox.tenant.id,
      userId: sandbox.userId,
      originalFileName: "resume.txt",
      fileUrl: "local://resume.txt",
      parsedText: text,
      status: "parsed",
      createdAt: now
    };
  }

  const RICH_RESUME = `Jane Doe
Senior Product Manager
Remote
jane.doe@example.com
+1 555-555-0100
https://www.linkedin.com/in/janedoe

Experience
Senior Product Manager — DemoLabs — 2022 - 2026
Led B2B SaaS workflow automation roadmap; +20% activation, +12% retention.
Skills
Product Management, Roadmap, SQL`;

  const PIPED_RESUME = `Jane Doe | Senior PM | jane@example.com | +1 555-555-0100\nLinkedIn | https://www.linkedin.com/in/janedoe\nProduct Management | Roadmap | SQL`;

  if (evalCase.id === "eval_rimp_multi_column_to_single_column") {
    const resume = saveResume(sandbox, makeResume(PIPED_RESUME, "resume_pipes"));
    await analyzeResumeIntelligence(sandbox, resume);
    const draft = await generateResumeImprovementDraft(sandbox, resume.id);
    const passed = !draft.draft.draftMarkdown.includes("|");
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `pipesInDraft=${draft.draft.draftMarkdown.includes("|")}`
    );
  }

  if (evalCase.id === "eval_rimp_skills_only_from_existing") {
    const resume = saveResume(sandbox, makeResume(RICH_RESUME, "resume_skills"));
    await analyzeResumeIntelligence(sandbox, resume);
    const draft = await generateResumeImprovementDraft(sandbox, resume.id);
    const md = draft.draft.draftMarkdown;
    const hasSection = /## Skills/.test(md);
    const hasProductManagement = md.includes("Product Management");
    const hasSql = md.includes("SQL");
    // Negative check: no fabricated skills like Java, Kubernetes that aren't on the resume.
    const hasInventedSkill = /\b(Java|Kubernetes|Go)\b/.test(md);
    const passed =
      hasSection && hasProductManagement && hasSql && !hasInventedSkill;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `section=${hasSection} pm=${hasProductManagement} sql=${hasSql} invented=${hasInventedSkill}`
    );
  }

  if (evalCase.id === "eval_rimp_no_invented_email") {
    const resume = saveResume(
      sandbox,
      makeResume(
        RICH_RESUME.replace("jane.doe@example.com\n", ""),
        "resume_no_email"
      )
    );
    await analyzeResumeIntelligence(sandbox, resume);
    const draft = await generateResumeImprovementDraft(sandbox, resume.id);
    const md = draft.draft.draftMarkdown;
    const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(md);
    const remainingMentionsEmail = draft.draft.warningsRemaining.some((w) =>
      w.toLowerCase().includes("email")
    );
    const passed = !hasEmail && remainingMentionsEmail;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `hasEmail=${hasEmail} remainingMentionsEmail=${remainingMentionsEmail}`
    );
  }

  if (evalCase.id === "eval_rimp_no_fake_metrics") {
    const text = `Jane Doe\nSenior Product Manager\njane@example.com\n+1 555-555-0100\nhttps://www.linkedin.com/in/janedoe\n\nExperience\nSenior Product Manager — DemoLabs — 2022 - 2026\nWorked on roadmap and discovery.\nSkills\nProduct Management`;
    const resume = saveResume(sandbox, makeResume(text, "resume_no_metrics"));
    await analyzeResumeIntelligence(sandbox, resume);
    const draft = await generateResumeImprovementDraft(sandbox, resume.id);
    const md = draft.draft.draftMarkdown;
    // The deterministic improver may include a placeholder reminder bracketed in [] but no raw % or $.
    const hasFakePercent = /\d+\s*%/.test(md.replace(/\[[^\]]+\]/g, ""));
    const hasFakeDollar = /\$\d+/.test(md.replace(/\[[^\]]+\]/g, ""));
    const passed = !hasFakePercent && !hasFakeDollar;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `hasFakePercent=${hasFakePercent} hasFakeDollar=${hasFakeDollar}`
    );
  }

  if (evalCase.id === "eval_rimp_original_not_overwritten") {
    const resume = saveResume(sandbox, makeResume(RICH_RESUME, "resume_orig"));
    await analyzeResumeIntelligence(sandbox, resume);
    const draft = await generateResumeImprovementDraft(sandbox, resume.id);
    const saved = saveResumeImprovementDraft(sandbox, draft.draft.id);
    const versions = loadResumeVersions(sandbox);
    const hasOriginal = versions.some((v) => v.id === resume.id);
    const hasImproved = versions.some((v) => v.id === saved.improvedResume.id);
    const passed = hasOriginal && hasImproved;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `versions=${versions.length} hasOriginal=${hasOriginal} hasImproved=${hasImproved}`
    );
  }

  if (evalCase.id === "eval_rimp_saved_can_be_reanalyzed") {
    const resume = saveResume(sandbox, makeResume(RICH_RESUME, "resume_reanalyze"));
    await analyzeResumeIntelligence(sandbox, resume);
    const draft = await generateResumeImprovementDraft(sandbox, resume.id);
    const saved = saveResumeImprovementDraft(sandbox, draft.draft.id);
    const reanalyzed = await reanalyzeImprovedResume(sandbox, saved.draft.id);
    const passed =
      reanalyzed.improvedReport.resumeId === saved.improvedResume.id &&
      reanalyzed.draft.improvedRiskScore !== null;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `reportResumeId=${reanalyzed.improvedReport.resumeId} improvedScore=${reanalyzed.draft.improvedRiskScore}`
    );
  }

  if (evalCase.id === "eval_rimp_risk_score_improves") {
    const resume = saveResume(sandbox, makeResume(PIPED_RESUME, "resume_improves"));
    await analyzeResumeIntelligence(sandbox, resume);
    const draft = await generateResumeImprovementDraft(sandbox, resume.id);
    const saved = saveResumeImprovementDraft(sandbox, draft.draft.id);
    const reanalyzed = await reanalyzeImprovedResume(sandbox, saved.draft.id);
    const original = reanalyzed.draft.originalRiskScore;
    const improved = reanalyzed.draft.improvedRiskScore ?? Number.POSITIVE_INFINITY;
    const passed = improved <= original;
    return resultFor(
      session,
      run,
      evalCase,
      passed ? "passed" : "failed",
      `original=${original} improved=${improved}`
    );
  }

  return resultFor(
    session,
    run,
    evalCase,
    "failed",
    `Unknown resume_improvement eval: ${evalCase.id}`,
    "warning"
  );
}

async function evaluateCase(
  evalCase: EvalCase,
  session: AppSession,
  run: EvalRun
): Promise<EvalResult> {
  try {
    if (evalCase.suite === "match_score") {
      return await scoreEval(evalCase, session, run);
    }

    if (evalCase.suite === "application_package") {
      return await packageEval(evalCase, session, run);
    }

    if (evalCase.suite === "ats_adapter") {
      return await atsEval(evalCase, session, run);
    }

    if (evalCase.suite === "career_ops") {
      return await careerOpsEval(evalCase, session, run);
    }

    if (evalCase.suite === "company_intelligence") {
      return await intelligenceEval(evalCase, session, run);
    }

    if (evalCase.suite === "onboarding") {
      return await onboardingEval(evalCase, session, run);
    }

    if (evalCase.suite === "resume_intelligence") {
      return await resumeIntelligenceEval(evalCase, session, run);
    }

    if (evalCase.suite === "resume_improvement") {
      return await resumeImprovementEval(evalCase, session, run);
    }

    return await browserEval(evalCase, session, run);
  } catch (error) {
    return resultFor(
      session,
      run,
      evalCase,
      "failed",
      error instanceof Error ? error.message : "Eval failed unexpectedly.",
      "critical"
    );
  }
}

export async function runEvalSuite(
  session: AppSession,
  suite: EvalRunSuite = "all"
): Promise<EvalRunBundle> {
  const timestamp = nowIso();
  const allCases = defaultEvalCases(session);
  const selectedCases =
    suite === "all" ? allCases : allCases.filter((item) => item.suite === suite);
  const run = evalRunSchema.parse({
    id: createId("eval_run"),
    tenantId: session.tenant.id,
    userId: session.userId,
    suite,
    status: "running",
    startedAt: timestamp,
    finishedAt: null,
    passCount: 0,
    failCount: 0
  });
  saveEvalCases(session, allCases);
  saveEvalRuns(session, [run, ...loadEvalRuns(session)]);

  const results: EvalResult[] = [];
  for (const evalCase of selectedCases) {
    results.push(await evaluateCase(evalCase, session, run));
  }

  const passCount = results.filter((result) => result.status === "passed").length;
  const failCount = results.length - passCount;
  const completedRun = evalRunSchema.parse({
    ...run,
    status: failCount > 0 ? "failed" : "completed",
    finishedAt: nowIso(),
    passCount,
    failCount
  });
  saveEvalRuns(
    session,
    loadEvalRuns(session).map((item) =>
      item.id === completedRun.id ? completedRun : item
    )
  );
  saveEvalResults(session, [...results, ...loadEvalResults(session)]);

  return {
    run: completedRun,
    cases: allCases,
    results
  };
}

export function summarizeLatestEvalRun(
  runs: EvalRun[],
  results: EvalResult[]
): {
  latestRun: EvalRun | null;
  passCount: number;
  failCount: number;
  failedResults: EvalResult[];
} {
  const latestRun =
    runs
      .slice()
      .sort(
        (a, b) =>
          new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
      )[0] ?? null;
  if (!latestRun) {
    return { latestRun: null, passCount: 0, failCount: 0, failedResults: [] };
  }

  const latestResults = results.filter((result) => result.evalRunId === latestRun.id);
  return {
    latestRun,
    passCount: latestResults.filter((result) => result.status === "passed").length,
    failCount: latestResults.filter((result) => result.status === "failed").length,
    failedResults: latestResults.filter((result) => result.status === "failed")
  };
}
