import type {
  AppSession,
  ApplicationAnswer,
  ApplicationPackage,
  ApplicationRecord,
  AutopilotAction,
  CompanyIntelligence,
  FollowUpReminder,
  JobMatch,
  JobTargetRecommendation,
  NormalizedJob,
  OnboardingState,
  Resume,
  ResumeIntelligenceReport,
  UserProfile
} from "../models/domain";
import {
  applicationAnswerSchema,
  applicationPackageSchema,
  applicationRecordSchema,
  companyIntelligenceSchema,
  followUpReminderSchema,
  jobTargetRecommendationSchema,
  normalizedJobSchema,
  resumeIntelligenceReportSchema,
  userProfileSchema
} from "../models/schemas";
import { clearScopedWorkspace } from "../lib/storage";
import { appendAuditLog } from "./auditLog";
import {
  loadApplicationAnswers,
  loadApplicationPackages,
  saveApplicationAnswers,
  saveApplicationPackages
} from "./applicationPackage";
import { loadApplications, saveApplications } from "./applicationService";
import {
  loadAutopilotActions,
  loadAutopilotSettings,
  saveAutopilotSettings,
  upsertAutopilotAction
} from "./autopilotService";
import {
  loadCompanyIntelligence,
  saveCompanyIntelligence
} from "./intelligenceService";
import {
  loadNormalizedJobs,
  saveNormalizedJobs
} from "./jobIngestion";
import {
  loadJobMatches,
  saveJobMatches,
  scoreJobsForProfile
} from "./matchEngine";
import {
  loadOnboardingState,
  saveOnboardingState
} from "./onboardingJobRecommendationService";
import { loadUserProfile, saveUserProfile } from "./profileService";
import {
  loadFollowUpReminders,
  saveFollowUpReminders
} from "./recruiterCrmService";
import { createResumeFromText, loadResume, saveResume } from "./resumeService";
import {
  loadJobTargetRecommendations,
  loadResumeIntelligenceReports,
  saveJobTargetRecommendations,
  saveResumeIntelligenceReports
} from "./resumeIntelligenceService";

const DEMO_MARKER = "[Demo]";
const DEMO_PREFIX = "demo_mvp";

export interface DemoSeedWorkspaceSummary {
  hasUserData: boolean;
  hasNonDemoUserData: boolean;
}

export interface RealisticDemoSeedOptions {
  replaceExisting?: boolean;
}

export interface RealisticDemoSeedResult {
  profile: UserProfile;
  resume: Resume;
  resumeIntelligenceReport: ResumeIntelligenceReport;
  jobTargetRecommendation: JobTargetRecommendation;
  onboardingState: OnboardingState;
  jobs: NormalizedJob[];
  matches: JobMatch[];
  applications: ApplicationRecord[];
  packages: ApplicationPackage[];
  answers: ApplicationAnswer[];
  followUpReminder: FollowUpReminder;
  companyIntelligence: CompanyIntelligence;
  autopilotActions: AutopilotAction[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function isDemoText(value: string): boolean {
  return value.toLowerCase().includes("demo");
}

function isDemoId(value: string): boolean {
  return value.startsWith(DEMO_PREFIX) || value.startsWith("demo_job_");
}

function isDemoProfile(profile: UserProfile | null): boolean {
  return Boolean(
    profile &&
      (isDemoId(profile.id) ||
        isDemoText(profile.fullName) ||
        isDemoText(profile.email) ||
        (profile.verifiedFacts.length > 0 && profile.verifiedFacts.every(isDemoText)))
  );
}

function isDemoResume(resume: Resume | null): boolean {
  return Boolean(
    resume &&
      (isDemoId(resume.id) ||
        isDemoText(resume.originalFileName) ||
        isDemoText(resume.parsedText))
  );
}

function allDemo<T>(items: T[], predicate: (item: T) => boolean): boolean {
  return items.length === 0 || items.every(predicate);
}

export function summarizeDemoSeedWorkspace(
  session: AppSession,
  profile: UserProfile | null = loadUserProfile(session),
  resume: Resume | null = loadResume(session)
): DemoSeedWorkspaceSummary {
  const jobs = loadNormalizedJobs(session);
  const matches = loadJobMatches(session);
  const applications = loadApplications(session);
  const packages = loadApplicationPackages(session);
  const answers = loadApplicationAnswers(session);
  const reports = loadResumeIntelligenceReports(session);
  const recommendations = loadJobTargetRecommendations(session);
  const reminders = loadFollowUpReminders(session);
  const intelligence = loadCompanyIntelligence(session);

  const hasUserData = Boolean(
    profile ||
      resume ||
      jobs.length ||
      matches.length ||
      applications.length ||
      packages.length ||
      answers.length ||
      reports.length ||
      recommendations.length ||
      reminders.length ||
      intelligence.length
  );
  const hasNonDemoUserData = Boolean(
    (profile && !isDemoProfile(profile)) ||
      (resume && !isDemoResume(resume)) ||
      !allDemo(jobs, (job) => isDemoId(job.id) || isDemoText(job.title)) ||
      !allDemo(matches, (match) => isDemoId(match.id) || isDemoId(match.jobId)) ||
      !allDemo(applications, (application) => isDemoId(application.id)) ||
      !allDemo(packages, (applicationPackage) => isDemoId(applicationPackage.id)) ||
      !allDemo(answers, (answer) => isDemoId(answer.id)) ||
      !allDemo(reports, (report) => isDemoId(report.id)) ||
      !allDemo(recommendations, (recommendation) => isDemoId(recommendation.id)) ||
      !allDemo(reminders, (reminder) => isDemoId(reminder.id)) ||
      !allDemo(intelligence, (record) => isDemoId(record.id))
  );

  return {
    hasUserData,
    hasNonDemoUserData
  };
}

function demoResumeText(): string {
  return `${DEMO_MARKER} Maya Chen
Senior Product Manager
Remote, United States
maya.demo@example.com
+1 555-0144
https://www.linkedin.com/in/maya-demo-chen
https://maya-demo.example.com

Professional Summary
Product leader focused on B2B SaaS workflow automation, AI operations, customer discovery, and measurable activation/retention improvements.

Experience
Senior Product Manager - WorkflowOS Demo Co - 2021-2026
- ${DEMO_MARKER} Led roadmap for B2B SaaS workflow automation used by operations teams.
- ${DEMO_MARKER} Partnered with engineering, design, sales, and customer success on discovery, prioritization, and launch readiness.
- ${DEMO_MARKER} Improved activation by 18% and retention by 11% through onboarding and workflow redesign.
- ${DEMO_MARKER} Used SQL, product analytics, Figma, and customer interviews to prioritize high-impact work.

Product Manager - Insight Demo Analytics - 2018-2021
- ${DEMO_MARKER} Launched reporting workflows for operations leaders.
- ${DEMO_MARKER} Reduced manual reporting effort by 35% with self-serve dashboards and automation.

Skills
${DEMO_MARKER} Product management, roadmap strategy, B2B SaaS, AI operations, workflow automation, customer discovery, SQL, product analytics, Figma, stakeholder management`;
}

function createDemoProfile(session: AppSession): UserProfile {
  const timestamp = nowIso();
  return userProfileSchema.parse({
    id: `${DEMO_PREFIX}_profile`,
    tenantId: session.tenant.id,
    userId: session.userId,
    fullName: "Maya Chen (Demo Candidate)",
    email: "maya.demo@example.com",
    phone: "+1 555-0144",
    location: "Remote, United States",
    workAuthorization: "Authorized to work in the United States",
    linkedinUrl: "https://www.linkedin.com/in/maya-demo-chen",
    portfolioUrl: "https://maya-demo.example.com",
    githubUrl: "",
    targetTitles: [
      "Senior Product Manager",
      "Staff Product Manager",
      "Lead Product Manager"
    ],
    targetLocations: ["Remote", "San Francisco", "New York"],
    targetIndustries: ["B2B SaaS", "AI operations", "Workflow automation"],
    remotePreference: "remote",
    salaryMin: 165000,
    salaryTarget: 195000,
    companiesToAvoid: ["Acme Demo Staffing"],
    companiesToPrioritize: ["Northstar Demo AI", "Atlas Demo Cloud"],
    careerSummary:
      "[Demo] Senior product manager focused on B2B SaaS workflow automation, AI operations, customer discovery, and measurable activation/retention outcomes.",
    verifiedFacts: [
      "[Demo] Led roadmap for B2B SaaS workflow automation used by operations teams.",
      "[Demo] Improved activation by 18% and retention by 11% through onboarding and workflow redesign.",
      "[Demo] Reduced manual reporting effort by 35% with self-serve dashboards and automation.",
      "[Demo] Used SQL, product analytics, Figma, and customer interviews to prioritize product work.",
      "[Demo] Partnered with engineering, design, sales, and customer success on launch readiness."
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function createDemoResume(session: AppSession): Resume {
  const resume = createResumeFromText(
    session,
    demoResumeText(),
    "demo-realistic-maya-chen-resume.txt"
  );
  return {
    ...resume,
    id: `${DEMO_PREFIX}_resume`,
    fileUrl: `local-demo://resume/${DEMO_PREFIX}_resume.txt`
  };
}

function createResumeIntelligence(
  session: AppSession,
  resume: Resume
): {
  report: ResumeIntelligenceReport;
  recommendation: JobTargetRecommendation;
} {
  const timestamp = nowIso();
  const report = resumeIntelligenceReportSchema.parse({
    id: `${DEMO_PREFIX}_resume_intelligence`,
    tenantId: session.tenant.id,
    userId: session.userId,
    resumeId: resume.id,
    // Demo seed presents itself as a successful LLM run so the
    // customer-facing onboarding (which now hides any non-LLM
    // analysis under an "AI unavailable" card) renders the
    // realistic walkthrough that qa:mvp depends on.
    extractionMode: "llm",
    provider: "openai",
    modelName: "gpt-4.1-mini",
    promptVersion: "resume-intelligence-openai-v1",
    extractedProfile: {
      fullName: "Maya Chen (Demo Candidate)",
      email: "maya.demo@example.com",
      phone: "+1 555-0144",
      location: "Remote, United States",
      linkedinUrl: "https://www.linkedin.com/in/maya-demo-chen",
      githubUrl: "",
      portfolioUrl: "https://maya-demo.example.com",
      currentTitle: "Senior Product Manager",
      seniorityLevel: "Senior",
      yearsOfExperience: 8,
      industries: ["B2B SaaS", "AI operations", "Workflow automation"],
      companies: ["WorkflowOS Demo Co", "Insight Demo Analytics"],
      jobTitles: ["Senior Product Manager", "Product Manager"],
      education: [],
      certifications: [],
      skills: [
        "Product management",
        "Customer discovery",
        "Roadmap strategy",
        "SQL",
        "Product analytics",
        "Figma"
      ],
      tools: ["SQL", "Figma", "Product analytics"],
      projects: ["Workflow automation onboarding redesign"],
      leadershipExamples: [
        "[Demo] Partnered with engineering, design, sales, and customer success."
      ],
      quantifiedAchievements: [
        "[Demo] Improved activation by 18% and retention by 11%.",
        "[Demo] Reduced manual reporting effort by 35%."
      ],
      workAuthorization: "Authorized to work in the United States",
      resumeStrengths: [
        "[Demo] Strong B2B SaaS product management signal.",
        "[Demo] Clear quantified product outcomes.",
        "[Demo] Good ATS-readable text structure."
      ],
      resumeGaps: [
        "[Demo] Could add more detail on team size and product scope."
      ]
    },
    confidenceByField: {
      fullName: "high",
      email: "high",
      phone: "high",
      location: "high",
      linkedinUrl: "high",
      githubUrl: "low",
      portfolioUrl: "medium",
      currentTitle: "high",
      seniorityLevel: "high",
      yearsOfExperience: "medium",
      skills: "high",
      industries: "high"
    },
    missingFields: ["GitHub URL"],
    ambiguousFields: ["Exact team size"],
    parsingWarnings: [
      "[Demo] Portfolio URL is included; confirm it is the preferred public link."
    ],
    atsRiskScore: 18,
    atsRiskLevel: "low",
    suggestedFixes: [
      {
        field: "Experience",
        severity: "low",
        message: "[Demo] Add team size where available.",
        recommendedAction:
          "If this were a real resume, add verified team size or scope details."
      }
    ],
    createdAt: timestamp,
    updatedAt: timestamp
  });

  const recommendation = jobTargetRecommendationSchema.parse({
    id: `${DEMO_PREFIX}_target_recommendations`,
    tenantId: session.tenant.id,
    userId: session.userId,
    resumeId: resume.id,
    reportId: report.id,
    strongestRoles: [
      {
        title: "Senior Product Manager",
        fitLevel: "strong",
        confidence: "high",
        why: "[Demo] Direct match to B2B SaaS workflow automation experience.",
        evidenceFromResume: [
          "[Demo] Led B2B SaaS workflow automation roadmap.",
          "[Demo] Improved activation by 18% and retention by 11%."
        ],
        searchKeywords: ["senior product manager", "b2b saas", "workflow automation"],
        suggestedResumeAngle:
          "[Demo] Lead with workflow automation and activation/retention outcomes."
      },
      {
        title: "Staff Product Manager",
        fitLevel: "strong",
        confidence: "medium",
        why: "[Demo] Strong product leadership signal with some scope details to confirm.",
        evidenceFromResume: [
          "[Demo] Partnered cross-functionally across engineering, design, sales, and customer success."
        ],
        searchKeywords: ["staff product manager", "platform product", "ai operations"],
        suggestedResumeAngle:
          "[Demo] Emphasize strategic roadmap and platform decision-making."
      }
    ],
    adjacentRoles: [
      {
        title: "Product Operations Lead",
        fitLevel: "adjacent",
        confidence: "medium",
        why: "[Demo] Operations workflow and analytics background transfers well.",
        evidenceFromResume: [
          "[Demo] Reduced manual reporting effort by 35%."
        ],
        searchKeywords: ["product operations", "product ops", "workflow operations"],
        suggestedResumeAngle:
          "[Demo] Emphasize systems, process design, and cross-functional operations."
      }
    ],
    stretchRoles: [
      {
        title: "Director of Product",
        fitLevel: "stretch",
        confidence: "low",
        why: "[Demo] More people-management evidence would be needed.",
        evidenceFromResume: ["[Demo] Cross-functional leadership is present."],
        searchKeywords: ["director product", "product leader"],
        suggestedResumeAngle:
          "[Demo] Add verified people-management and portfolio-scope details first."
      }
    ],
    rolesToAvoid: [
      {
        title: "Pure sales role",
        fitLevel: "avoid",
        confidence: "medium",
        why: "[Demo] Resume evidence is product-led rather than quota-carrying sales.",
        evidenceFromResume: ["[Demo] Product management and workflow automation focus."],
        searchKeywords: ["account executive", "sales"],
        suggestedResumeAngle:
          "[Demo] Keep sales roles in Browse unless the user explicitly overrides."
      }
    ],
    recommendedIndustries: ["B2B SaaS", "AI operations", "Workflow automation"],
    recommendedSeniority: "Senior / Staff",
    recommendedSearchKeywords: [
      "senior product manager workflow automation",
      "staff product manager ai operations",
      "b2b saas product manager remote"
    ],
    positioningSummary:
      "[Demo] Position as a senior B2B SaaS product leader for workflow automation and AI operations products.",
    resumePositioningAdvice: [
      "[Demo] Lead with workflow automation outcomes.",
      "[Demo] Keep metrics tied to verified facts.",
      "[Demo] Avoid unsupported claims about AI model ownership."
    ],
    skillGaps: [
      {
        skill: "Enterprise pricing",
        importance: "medium",
        reason: "[Demo] Several target roles mention packaging or pricing.",
        howToClose:
          "Add verified pricing examples only if this were part of the real background."
      }
    ],
    confidence: "high",
    // Match the resume intelligence report so the recommendation
    // panel renders the production-shaped UI (the LLM-only gate
    // refuses to surface deterministic recommendations).
    extractionMode: "llm",
    modelName: "gpt-4.1-mini",
    promptVersion: "resume-intelligence-openai-v1",
    createdAt: timestamp,
    updatedAt: timestamp
  });

  return { report, recommendation };
}

function createDemoJobs(session: AppSession): NormalizedJob[] {
  const timestamp = nowIso();
  const base = {
    tenantId: session.tenant.id,
    userId: session.userId,
    sourceConfigId: null,
    scoringStatus: "queued" as const,
    discoveredAt: timestamp,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return [
    {
      id: `${DEMO_PREFIX}_job_1`,
      sourceJobId: `${DEMO_PREFIX}_job_1`,
      source: "greenhouse" as const,
      title: "[Demo] Senior Product Manager, Workflow Automation",
      company: "Northstar Demo AI",
      location: "Remote (US)",
      remoteType: "remote",
      salaryMin: 180000,
      salaryMax: 220000,
      description:
        "[Demo job] Northstar Demo AI is hiring a Senior Product Manager for B2B SaaS workflow automation. The role owns customer discovery, roadmap strategy, onboarding activation, product analytics, and cross-functional launch readiness with engineering, design, sales, and customer success.",
      responsibilities: [
        "Lead customer discovery for workflow automation teams",
        "Own roadmap strategy for B2B SaaS automation products",
        "Use SQL and product analytics to improve activation and retention"
      ],
      requirements: [
        "Senior product management experience in B2B SaaS",
        "Experience with workflow automation or AI operations",
        "Strong customer discovery and cross-functional execution"
      ],
      applicationUrl: "https://boards.greenhouse.io/northstardemo/jobs/1001",
      atsType: "greenhouse" as const,
      postedAt: daysAgo(3),
      ...base
    },
    {
      id: `${DEMO_PREFIX}_job_2`,
      sourceJobId: `${DEMO_PREFIX}_job_2`,
      source: "lever" as const,
      title: "[Demo] Staff Product Manager, AI Operations",
      company: "Atlas Demo Cloud",
      location: "Remote",
      remoteType: "remote",
      salaryMin: 190000,
      salaryMax: 235000,
      description:
        "[Demo job] Atlas Demo Cloud needs a Staff Product Manager to define AI operations workflows for enterprise customers. The team values B2B SaaS product strategy, roadmap tradeoffs, experimentation, product analytics, and measurable improvements to customer activation.",
      responsibilities: [
        "Shape AI operations workflow strategy",
        "Prioritize enterprise roadmap investments",
        "Partner with engineering and design from discovery through launch"
      ],
      requirements: [
        "Staff or senior product management experience",
        "B2B SaaS platform or operations workflow experience",
        "Strong analytics and customer discovery habits"
      ],
      applicationUrl: "https://jobs.lever.co/atlasdemo/2002",
      atsType: "lever" as const,
      postedAt: daysAgo(5),
      ...base
    },
    {
      id: `${DEMO_PREFIX}_job_3`,
      sourceJobId: `${DEMO_PREFIX}_job_3`,
      source: "greenhouse" as const,
      title: "[Demo] Lead Product Manager, Platform Integrations",
      company: "Orchard Demo Systems",
      location: "San Francisco, CA or Remote",
      remoteType: "hybrid",
      salaryMin: 165000,
      salaryMax: 205000,
      description:
        "[Demo job] Orchard Demo Systems is building platform integrations for operations teams. This Lead Product Manager role emphasizes API partner workflows, customer interviews, roadmap planning, launch readiness, and product analytics for B2B SaaS customers.",
      responsibilities: [
        "Lead roadmap for integrations and workflow automation",
        "Run customer interviews with operations teams",
        "Coordinate launch readiness across product, engineering, and GTM"
      ],
      requirements: [
        "Product management experience in B2B SaaS",
        "Strong systems thinking and stakeholder management",
        "Comfort using analytics to prioritize work"
      ],
      applicationUrl: "https://boards.greenhouse.io/orcharddemo/jobs/3003",
      atsType: "greenhouse" as const,
      postedAt: daysAgo(8),
      ...base
    },
    {
      id: `${DEMO_PREFIX}_job_4`,
      sourceJobId: `${DEMO_PREFIX}_job_4`,
      source: "lever" as const,
      title: "[Demo] Product Operations Lead",
      company: "BrightPath Demo",
      location: "Remote (US)",
      remoteType: "remote",
      salaryMin: 140000,
      salaryMax: 175000,
      description:
        "[Demo job] BrightPath Demo is hiring a Product Operations Lead to improve product planning rituals, reporting workflows, customer feedback loops, and launch process. The work blends product analytics, stakeholder management, and operational execution.",
      responsibilities: [
        "Improve roadmap planning and reporting workflows",
        "Build feedback loops with customer-facing teams",
        "Create self-serve product analytics dashboards"
      ],
      requirements: [
        "Product operations or product management experience",
        "SQL or analytics fluency",
        "Strong cross-functional communication"
      ],
      applicationUrl: "https://jobs.lever.co/brightpathdemo/4004",
      atsType: "lever" as const,
      postedAt: daysAgo(12),
      ...base
    },
    {
      id: `${DEMO_PREFIX}_job_5`,
      sourceJobId: `${DEMO_PREFIX}_job_5`,
      source: "greenhouse" as const,
      title: "[Demo] Growth Product Manager",
      company: "Loopline Demo",
      location: "New York, NY or Remote",
      remoteType: "hybrid",
      salaryMin: 155000,
      salaryMax: 190000,
      description:
        "[Demo job] Loopline Demo needs a Growth Product Manager to improve activation, retention, and experimentation for a B2B SaaS product. The role uses customer discovery, product analytics, onboarding experiments, and stakeholder alignment.",
      responsibilities: [
        "Improve activation and retention funnels",
        "Run onboarding experiments",
        "Partner with design and engineering on growth roadmap"
      ],
      requirements: [
        "Growth product experience",
        "B2B SaaS analytics and experimentation",
        "Customer discovery and cross-functional delivery"
      ],
      applicationUrl: "https://boards.greenhouse.io/looplinedemo/jobs/5005",
      atsType: "greenhouse" as const,
      postedAt: daysAgo(15),
      ...base
    },
    {
      id: `${DEMO_PREFIX}_job_6`,
      sourceJobId: `${DEMO_PREFIX}_job_6`,
      source: "lever" as const,
      title: "[Demo] Backend Infrastructure Engineer",
      company: "Kernel Demo",
      location: "Austin, TX",
      remoteType: "onsite",
      salaryMin: 150000,
      salaryMax: 185000,
      description:
        "[Demo job] Kernel Demo is hiring a backend infrastructure engineer focused on Go services, Kubernetes reliability, observability, and platform automation. This is included so the Browse queue has a lower-fit technical role with useful explanation.",
      responsibilities: [
        "Build backend infrastructure services",
        "Improve Kubernetes reliability",
        "Own observability and incident response"
      ],
      requirements: ["Go", "Kubernetes", "backend infrastructure", "onsite in Austin"],
      applicationUrl: "https://jobs.lever.co/kerneldemo/6006",
      atsType: "lever" as const,
      postedAt: daysAgo(2),
      ...base
    },
    {
      id: `${DEMO_PREFIX}_job_7`,
      sourceJobId: `${DEMO_PREFIX}_job_7`,
      source: "greenhouse" as const,
      title: "[Demo] Enterprise Account Executive",
      company: "Market Demo",
      location: "Remote",
      remoteType: "remote",
      salaryMin: 120000,
      salaryMax: 260000,
      description:
        "[Demo job] Market Demo is hiring an enterprise account executive for quota-carrying sales, pipeline generation, negotiation, forecasting, and customer relationship management. It is intentionally a lower product-fit role.",
      responsibilities: [
        "Own enterprise sales pipeline",
        "Negotiate annual contracts",
        "Forecast quarterly revenue"
      ],
      requirements: ["Quota-carrying SaaS sales", "Pipeline generation", "Negotiation"],
      applicationUrl: "https://boards.greenhouse.io/marketdemo/jobs/7007",
      atsType: "greenhouse" as const,
      postedAt: daysAgo(6),
      ...base
    },
    {
      id: `${DEMO_PREFIX}_job_8`,
      sourceJobId: `${DEMO_PREFIX}_job_8`,
      source: "lever" as const,
      title: "[Demo] Junior Product Analyst",
      company: "Campus Demo",
      location: "Boston, MA",
      remoteType: "onsite",
      salaryMin: 85000,
      salaryMax: 110000,
      description:
        "[Demo job] Campus Demo is hiring a junior product analyst to support dashboards, reporting, SQL analysis, and stakeholder requests. It has some analytics overlap but mismatches seniority, salary, and remote preference.",
      responsibilities: [
        "Build recurring SQL reports",
        "Support product dashboard requests",
        "Document product usage trends"
      ],
      requirements: ["Junior analyst experience", "SQL", "Onsite in Boston"],
      applicationUrl: "https://jobs.lever.co/campusdemo/8008",
      atsType: "lever" as const,
      postedAt: daysAgo(20),
      ...base
    }
  ].map((job) => normalizedJobSchema.parse(job));
}

function simpleHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `demo_h_${(hash >>> 0).toString(36)}`;
}

function createApplicationRecord(
  session: AppSession,
  job: NormalizedJob,
  index: number
): ApplicationRecord {
  const timestamp = nowIso();
  return applicationRecordSchema.parse({
    id: `${DEMO_PREFIX}_application_${index}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: job.id,
    status: "draft_prepared",
    notes: `${DEMO_MARKER} Application package prepared for review. No application has been submitted.`,
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function createApplicationPackage(
  session: AppSession,
  job: NormalizedJob,
  application: ApplicationRecord,
  match: JobMatch | null,
  index: number
): {
  applicationPackage: ApplicationPackage;
  answers: ApplicationAnswer[];
} {
  const timestamp = nowIso();
  const resumeMarkdown = [
    `# ${DEMO_MARKER} Maya Chen - tailored resume draft`,
    "",
    `## Target role`,
    `${job.title} at ${job.company}`,
    "",
    "## Summary",
    `${DEMO_MARKER} Senior B2B SaaS product manager focused on workflow automation, AI operations, customer discovery, and measurable activation/retention outcomes.`,
    "",
    "## Relevant verified experience",
    `- ${DEMO_MARKER} Led roadmap for B2B SaaS workflow automation used by operations teams.`,
    `- ${DEMO_MARKER} Improved activation by 18% and retention by 11% through onboarding and workflow redesign.`,
    `- ${DEMO_MARKER} Used SQL, product analytics, Figma, and customer interviews to prioritize product work.`,
    "",
    "## Match notes",
    match
      ? `${DEMO_MARKER} Match score: ${match.overallScore.toFixed(1)} / 10.`
      : `${DEMO_MARKER} Match score pending.`
  ].join("\n");
  const coverLetter = [
    "Dear hiring team,",
    "",
    `${DEMO_MARKER} I am interested in the ${job.title} role at ${job.company} because it aligns with my verified product background in B2B SaaS workflow automation.`,
    "",
    `${DEMO_MARKER} My relevant experience includes leading workflow automation roadmap work, partnering across engineering/design/GTM, and improving activation by 18% and retention by 11%.`,
    "",
    `${DEMO_MARKER} This is a demo draft for review only. It has not been submitted.`,
    "",
    "Thank you for your consideration."
  ].join("\n");
  const answerDrafts = [
    {
      question: "Why are you interested in this role?",
      answer: `${DEMO_MARKER} This role matches the demo candidate's B2B SaaS workflow automation and AI operations product background.`
    },
    {
      question: "Why this company?",
      answer: `${DEMO_MARKER} The posting suggests ${job.company} is working on the type of workflow and operations problems reflected in the demo resume.`
    },
    {
      question: "What makes you a strong fit?",
      answer: `${DEMO_MARKER} The strongest fit signals are customer discovery, roadmap ownership, SQL/product analytics, and verified activation/retention improvements.`
    },
    {
      question: "Tell us about relevant experience.",
      answer: `${DEMO_MARKER} Relevant demo experience includes leading workflow automation roadmap work and reducing manual reporting effort by 35%.`
    }
  ];
  const applicationPackage = applicationPackageSchema.parse({
    id: `${DEMO_PREFIX}_package_${index}`,
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: job.id,
    applicationRecordId: application.id,
    status: "ready_for_review",
    resumeMarkdown,
    coverLetter,
    generationMode: "deterministic",
    modelName: "deterministic-demo-seed",
    promptVersion: "demo-seed-v1",
    inputHash: simpleHash(JSON.stringify({ job, match })),
    outputHash: simpleHash([resumeMarkdown, coverLetter].join("\n")),
    safetyWarnings: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    approvedAt: null,
    rejectedAt: null
  });
  const answers = answerDrafts.map((draft, answerIndex) =>
    applicationAnswerSchema.parse({
      id: `${DEMO_PREFIX}_answer_${index}_${answerIndex + 1}`,
      tenantId: session.tenant.id,
      userId: session.userId,
      applicationPackageId: applicationPackage.id,
      question: draft.question,
      answer: draft.answer,
      confidence: "high",
      source: "generated",
      needsUserReview: false,
      createdAt: timestamp,
      updatedAt: timestamp
    })
  );

  return { applicationPackage, answers };
}

function createCompanyIntelligence(
  session: AppSession,
  job: NormalizedJob
): CompanyIntelligence {
  const timestamp = nowIso();
  return companyIntelligenceSchema.parse({
    id: `${DEMO_PREFIX}_company_intelligence`,
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: job.id,
    company: job.company,
    summary:
      "[Demo] Estimated company intelligence: this company appears aligned with B2B SaaS workflow automation based on the demo job description.",
    businessModel: "[Demo] Enterprise B2B SaaS",
    industry: "[Demo] AI operations and workflow automation",
    companySize: "[Demo] Mid-market SaaS company",
    fundingStage: "[Demo] Not verified; shown as demo context only",
    recentSignals: [
      "[Demo] Hiring for workflow automation product roles",
      "[Demo] Product role emphasizes customer discovery and launch readiness"
    ],
    whyThisCompany:
      "[Demo] The posting overlaps with the demo candidate's verified workflow automation and product analytics background.",
    interviewPrepNotes: [
      "[Demo] Ask how the team measures activation and retention.",
      "[Demo] Ask which operations workflows are highest priority."
    ],
    compensationSignals:
      "[Demo] Salary range appears compatible with the demo candidate's target.",
    referralStrategy:
      "[Demo] Look for product or operations leaders connected to workflow automation.",
    source: "deterministic",
    confidence: "medium",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

function createFollowUpReminder(
  session: AppSession,
  job: NormalizedJob,
  application: ApplicationRecord
): FollowUpReminder {
  const timestamp = nowIso();
  return followUpReminderSchema.parse({
    id: `${DEMO_PREFIX}_follow_up_reminder`,
    tenantId: session.tenant.id,
    userId: session.userId,
    jobId: job.id,
    applicationRecordId: application.id,
    recruiterContactId: null,
    dueAt: daysFromNow(1),
    reason:
      "[Demo] Follow up after reviewing this prepared package; no message is sent automatically.",
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp
  });
}

export async function seedRealisticB2cDemo(
  session: AppSession,
  options: RealisticDemoSeedOptions = {},
  existingProfile: UserProfile | null = loadUserProfile(session)
): Promise<RealisticDemoSeedResult> {
  const summary = summarizeDemoSeedWorkspace(session, existingProfile);
  if (summary.hasNonDemoUserData && !options.replaceExisting) {
    throw new Error(
      "This workspace already has non-demo data. Confirm before replacing it with the realistic demo."
    );
  }

  if (summary.hasUserData || options.replaceExisting) {
    clearScopedWorkspace(session.tenant.id, session.userId);
  }

  const profile = createDemoProfile(session);
  saveUserProfile(
    session,
    {
      fullName: profile.fullName,
      email: profile.email,
      phone: profile.phone,
      location: profile.location,
      workAuthorization: profile.workAuthorization,
      linkedinUrl: profile.linkedinUrl,
      portfolioUrl: profile.portfolioUrl,
      githubUrl: profile.githubUrl,
      targetTitles: profile.targetTitles.join(", "),
      targetLocations: profile.targetLocations.join(", "),
      targetIndustries: profile.targetIndustries.join(", "),
      remotePreference: profile.remotePreference,
      salaryMin: String(profile.salaryMin ?? ""),
      salaryTarget: String(profile.salaryTarget ?? ""),
      companiesToAvoid: profile.companiesToAvoid.join(", "),
      companiesToPrioritize: profile.companiesToPrioritize.join(", "),
      careerSummary: profile.careerSummary,
      verifiedFacts: profile.verifiedFacts.join(", ")
    },
    profile
  );

  const resume = saveResume(session, createDemoResume(session));
  const { report, recommendation } = createResumeIntelligence(session, resume);
  saveResumeIntelligenceReports(session, [report]);
  saveJobTargetRecommendations(session, [recommendation]);

  const onboardingState = saveOnboardingState(session, {
    selectedTargetRoles: [
      "Senior Product Manager",
      "Staff Product Manager",
      "Product Operations Lead"
    ],
    onboardingJobsGenerated: true,
    onboardingJobsScored: true,
    firstApplyReadyJobsShown: true,
    firstJobReviewed: true,
    onboardingCompletedAt: nowIso()
  });

  const jobs = saveNormalizedJobs(session, createDemoJobs(session));
  const scoring = await scoreJobsForProfile(session, profile, jobs);
  const matches = scoring.matches.filter((match) =>
    jobs.some((job) => job.id === match.jobId)
  );
  const sortedMatches = [...matches].sort((a, b) => b.overallScore - a.overallScore);
  const jobsById = new Map(jobs.map((job) => [job.id, job] as const));
  const packageInputs = sortedMatches
    .map((match) => ({ match, job: jobsById.get(match.jobId) ?? null }))
    .filter((item): item is { match: JobMatch; job: NormalizedJob } =>
      Boolean(item.job)
    )
    .slice(0, 2);
  const applications = packageInputs.map((item, index) =>
    createApplicationRecord(session, item.job, index + 1)
  );
  const packageBundles = packageInputs.map((item, index) =>
    createApplicationPackage(
      session,
      item.job,
      applications[index],
      item.match,
      index + 1
    )
  );
  const packages = packageBundles.map((bundle) => bundle.applicationPackage);
  const answers = packageBundles.flatMap((bundle) => bundle.answers);
  saveApplications(session, applications);
  saveApplicationPackages(session, packages);
  saveApplicationAnswers(session, answers);

  const primaryJob = packageInputs[0]?.job ?? jobs[0];
  const primaryApplication = applications[0];
  const companyIntelligence = createCompanyIntelligence(session, primaryJob);
  saveCompanyIntelligence(session, [companyIntelligence]);
  const followUpReminder = createFollowUpReminder(
    session,
    primaryJob,
    primaryApplication
  );
  saveFollowUpReminders(session, [followUpReminder]);

  saveAutopilotSettings(session, {
    enabled: true,
    runFrequency: "manual",
    autoScoreJobs: true,
    autoPreparePackagesForHighScoreJobs: false,
    requireReviewBeforePackageGeneration: true,
    highScoreThreshold: 8,
    maxPackagesPerRun: 2,
    preferredWorkStyle: "remote",
    targetRoles: profile.targetTitles,
    excludedCompanies: profile.companiesToAvoid
  });
  packages.forEach((applicationPackage) => {
    upsertAutopilotAction(session, {
      type: "review_application_package",
      title: `${DEMO_MARKER} Application package ready to review`,
      reason:
        "[Demo] A tailored application package is ready. Review and edit it before any next step.",
      urgency: "high",
      jobId: applicationPackage.jobId,
      applicationRecordId: applicationPackage.applicationRecordId,
      applicationPackageId: applicationPackage.id,
      primaryCtaLabel: "Review package",
      primaryCtaRoute: `package-review:${applicationPackage.id}`,
      secondaryCtaLabel: "Open applications",
      secondaryCtaRoute: "tracker"
    });
  });
  const untrackedHighMatch = sortedMatches.find(
    (match) => !applications.some((application) => application.jobId === match.jobId)
  );
  if (untrackedHighMatch) {
    const job = jobsById.get(untrackedHighMatch.jobId);
    if (job) {
      upsertAutopilotAction(session, {
        type: "review_high_match_job",
        title: `${DEMO_MARKER} ${job.title.replace(`${DEMO_MARKER} `, "")}`,
        reason: `[Demo] Strong match (${untrackedHighMatch.overallScore.toFixed(1)} / 10). Review before deciding whether to start prep.`,
        urgency: "medium",
        jobId: job.id,
        primaryCtaLabel: "Review job",
        primaryCtaRoute: "jobs",
        secondaryCtaLabel: "Open Action Center",
        secondaryCtaRoute: "action-center"
      });
    }
  }
  upsertAutopilotAction(session, {
    type: "follow_up_due",
    title: `${DEMO_MARKER} Follow-up reminder`,
    reason: followUpReminder.reason,
    urgency: "low",
    jobId: followUpReminder.jobId,
    applicationRecordId: followUpReminder.applicationRecordId,
    primaryCtaLabel: "Open applications",
    primaryCtaRoute: "tracker",
    secondaryCtaLabel: "",
    secondaryCtaRoute: ""
  });

  appendAuditLog(session, {
    action: "demo.realistic_seeded",
    resourceType: "DemoSeed",
    resourceId: `${DEMO_PREFIX}_seed`,
    metadata: {
      demo: true,
      jobs: jobs.length,
      matches: matches.length,
      packages: packages.length,
      submittedApplications: applications.filter((app) => app.status === "submitted")
        .length
    }
  });

  return {
    profile,
    resume,
    resumeIntelligenceReport: report,
    jobTargetRecommendation: recommendation,
    onboardingState,
    jobs,
    matches: saveJobMatches(session, matches),
    applications: loadApplications(session),
    packages: loadApplicationPackages(session),
    answers: loadApplicationAnswers(session),
    followUpReminder,
    companyIntelligence,
    autopilotActions: loadAutopilotActions(session)
  };
}

export function isRealisticDemoEnabled(session: AppSession): boolean {
  return loadAutopilotSettings(session).enabled;
}
