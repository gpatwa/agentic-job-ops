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
import { readJson, scopedKey, writeJson } from "../lib/storage";
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
import { saveApplications } from "./applicationService";
import {
  GreenhouseATSAdapter,
  LeverATSAdapter,
  greenhouseFixturePage,
  leverFixturePage
} from "./atsAdapters";
import { createDryRunSnapshot } from "./realSiteDryRunService";

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
