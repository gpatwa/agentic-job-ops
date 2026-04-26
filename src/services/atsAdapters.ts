import type {
  ApplicationAnswer,
  ApplicationFieldSource,
  ApplicationPackage,
  BrowserApplicationSession,
  BrowserAtsType,
  BrowserFillMode,
  BrowserFillPlanItem,
  DetectedApplicationField,
  FillPlanAction,
  FilledApplicationField,
  Resume,
  UncertainApplicationField,
  UncertainFieldReason,
  UserProfile
} from "../models/domain";

export interface ATSPageSnapshot {
  url: string;
  html: string;
  title?: string;
  safeFixture?: boolean;
}

export interface AdapterDetectionResult {
  adapterType: BrowserAtsType;
  adapterName: string;
  confidence: number;
  reasons: string[];
}

export interface DetectedApplicationForm {
  adapterType: BrowserAtsType;
  adapterName: string;
  confidence: number;
  fields: DetectedApplicationField[];
}

export interface FillPlan {
  adapterType: BrowserAtsType;
  adapterName: string;
  confidence: number;
  mode: BrowserFillMode;
  fieldsDetected: DetectedApplicationField[];
  fieldsFilled: FilledApplicationField[];
  uncertainFields: UncertainApplicationField[];
  items: BrowserFillPlanItem[];
}

export interface FillResult {
  mode: BrowserFillMode;
  fieldsFilled: FilledApplicationField[];
  fieldsSkipped: number;
  submitted: false;
}

export interface ReviewResult {
  readyForReview: boolean;
  screenshotUrl: string | null;
}

export interface SubmitResult {
  submitted: boolean;
  confirmationDetected: boolean;
  message: string;
}

export interface ATSAdapter {
  type: BrowserAtsType;
  name: string;
  detect(page: ATSPageSnapshot): AdapterDetectionResult;
  analyzeForm(page: ATSPageSnapshot): DetectedApplicationForm;
  createFillPlan(
    profile: UserProfile | null,
    applicationPackage: ApplicationPackage,
    detectedForm: DetectedApplicationForm,
    options?: { answers?: ApplicationAnswer[]; resume?: Resume | null; mode?: BrowserFillMode }
  ): FillPlan;
  executeFillPlan(
    page: ATSPageSnapshot,
    fillPlan: FillPlan,
    mode: BrowserFillMode
  ): FillResult;
  prepareForReview(page: ATSPageSnapshot): ReviewResult;
  submitAfterApproval(
    page: ATSPageSnapshot,
    session: BrowserApplicationSession
  ): SubmitResult;
}

interface ParsedControl {
  tag: "input" | "textarea" | "select";
  id: string;
  name: string;
  type: string;
  label: string;
  required: boolean;
  attributes: Record<string, string | boolean>;
}

const DEMOGRAPHIC_TERMS = [
  "demographic",
  "gender",
  "race",
  "ethnicity",
  "veteran",
  "disability",
  "sexual orientation",
  "pronoun",
  "hispanic"
];

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function statusLabel(value: string): string {
  return value.replace(/[_-]/g, " ");
}

function slug(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function parseAttributes(raw: string): Record<string, string | boolean> {
  const attributes: Record<string, string | boolean> = {};
  const attrPattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrPattern.exec(raw))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? true;
  }
  return attributes;
}

function attrString(
  attributes: Record<string, string | boolean>,
  key: string
): string {
  const value = attributes[key.toLowerCase()];
  return typeof value === "string" ? value : "";
}

function hasAttr(attributes: Record<string, string | boolean>, key: string): boolean {
  return Boolean(attributes[key.toLowerCase()]);
}

function labelMap(html: string): Map<string, string> {
  const labels = new Map<string, string>();
  const labelPattern = /<label\b([^>]*)>([\s\S]*?)<\/label>/gi;
  let match: RegExpExecArray | null;
  while ((match = labelPattern.exec(html))) {
    const attrs = parseAttributes(match[1]);
    const forAttr = attrString(attrs, "for");
    if (forAttr) {
      labels.set(forAttr, normalizeText(match[2]));
    }
  }
  return labels;
}

function parseControls(html: string): ParsedControl[] {
  const labels = labelMap(html);
  const controls: ParsedControl[] = [];
  const controlPattern =
    /<(input|textarea|select)\b([^>]*?)(?:>([\s\S]*?)<\/\1>|\/?>)/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = controlPattern.exec(html))) {
    index += 1;
    const tag = match[1].toLowerCase() as ParsedControl["tag"];
    const attributes = parseAttributes(match[2]);
    const id = attrString(attributes, "id");
    const name = attrString(attributes, "name");
    const fallback = `${tag}_${index}`;
    const label =
      labels.get(id) ||
      attrString(attributes, "aria-label") ||
      attrString(attributes, "placeholder") ||
      statusLabel(name || id || fallback);
    controls.push({
      tag,
      id,
      name,
      type: attrString(attributes, "type").toLowerCase(),
      label: normalizeText(label),
      required: hasAttr(attributes, "required") || attrString(attributes, "aria-required") === "true",
      attributes
    });
  }

  return controls;
}

function labelIncludes(label: string, terms: string[]): boolean {
  const normalized = label.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function fieldTypeFor(control: ParsedControl): DetectedApplicationField["fieldType"] {
  if (control.type === "file") {
    return "file";
  }
  if (control.type === "email") {
    return "email";
  }
  if (control.type === "tel" || control.type === "phone") {
    return "phone";
  }
  if (control.type === "url") {
    return "url";
  }
  if (control.type === "checkbox" || control.type === "radio") {
    return "checkbox";
  }
  if (control.tag === "textarea") {
    return "textarea";
  }
  if (control.tag === "select") {
    return "select";
  }
  return "text";
}

function mapLabelToSource(label: string, fieldType: DetectedApplicationField["fieldType"]): {
  source: ApplicationFieldSource;
  sourceField: string;
  sensitive: boolean;
  confidence: number;
} {
  const lower = label.toLowerCase();
  const demographic = labelIncludes(label, DEMOGRAPHIC_TERMS);
  if (demographic) {
    return {
      source: "user_required",
      sourceField: "demographic defaults",
      sensitive: true,
      confidence: 0.18
    };
  }

  if (lower.includes("captcha") || lower.includes("recaptcha")) {
    return {
      source: "user_required",
      sourceField: "captcha",
      sensitive: true,
      confidence: 0.1
    };
  }

  if (lower.includes("salary") || lower.includes("compensation")) {
    return {
      source: "profile",
      sourceField: "salaryTarget",
      sensitive: false,
      confidence: 0.72
    };
  }

  if (lower.includes("first name")) {
    return { source: "profile", sourceField: "fullName", sensitive: false, confidence: 0.93 };
  }

  if (lower.includes("last name")) {
    return { source: "profile", sourceField: "fullName", sensitive: false, confidence: 0.93 };
  }

  if (lower === "name" || lower.includes("full name")) {
    return { source: "profile", sourceField: "fullName", sensitive: false, confidence: 0.95 };
  }

  if (lower.includes("email")) {
    return { source: "profile", sourceField: "email", sensitive: false, confidence: 0.96 };
  }

  if (lower.includes("phone")) {
    return { source: "profile", sourceField: "phone", sensitive: false, confidence: 0.94 };
  }

  if (lower.includes("location") || lower.includes("city")) {
    return { source: "profile", sourceField: "location", sensitive: false, confidence: 0.88 };
  }

  if (lower.includes("linkedin")) {
    return { source: "profile", sourceField: "linkedinUrl", sensitive: false, confidence: 0.9 };
  }

  if (lower.includes("github")) {
    return { source: "profile", sourceField: "githubUrl", sensitive: false, confidence: 0.88 };
  }

  if (lower.includes("portfolio") || lower.includes("website")) {
    return { source: "profile", sourceField: "portfolioUrl", sensitive: false, confidence: 0.86 };
  }

  if (lower.includes("authorization") || lower.includes("authorized")) {
    return {
      source: "profile",
      sourceField: "workAuthorization",
      sensitive: false,
      confidence: 0.78
    };
  }

  if (fieldType === "file" && lower.includes("resume")) {
    return { source: "resume", sourceField: "resumeMarkdown", sensitive: false, confidence: 0.9 };
  }

  if (fieldType === "file" && lower.includes("cover")) {
    return {
      source: "application_package",
      sourceField: "coverLetter",
      sensitive: false,
      confidence: 0.86
    };
  }

  if (lower.includes("additional information") || lower.includes("anything else")) {
    return {
      source: "application_package",
      sourceField: "coverLetter",
      sensitive: false,
      confidence: 0.62
    };
  }

  return {
    source: "user_required",
    sourceField: label,
    sensitive: false,
    confidence: 0.45
  };
}

function detectedFieldFromControl(
  control: ParsedControl,
  adapterType: BrowserAtsType,
  index: number
): DetectedApplicationField {
  const fieldType = fieldTypeFor(control);
  const mapping = mapLabelToSource(control.label, fieldType);
  const sourceId = control.id || control.name || control.label;
  return {
    id: `${adapterType}_${slug(sourceId, `field_${index}`)}`,
    label: control.label,
    fieldType,
    required: control.required,
    sensitive: mapping.sensitive,
    confidence: mapping.confidence,
    source: mapping.source,
    sourceField: mapping.sourceField
  };
}

function addSystemPauseFields(
  html: string,
  fields: DetectedApplicationField[],
  adapterType: BrowserAtsType
): DetectedApplicationField[] {
  const lower = html.toLowerCase();
  const result = [...fields];
  if (
    lower.includes("captcha") ||
    lower.includes("recaptcha") ||
    lower.includes("bot challenge")
  ) {
    result.push({
      id: `${adapterType}_captcha`,
      label: "CAPTCHA or bot challenge",
      fieldType: "captcha",
      required: true,
      sensitive: true,
      confidence: 0.1,
      source: "user_required",
      sourceField: "captcha"
    });
  }

  if (
    lower.includes("log in") ||
    lower.includes("login") ||
    lower.includes("sign in") ||
    lower.includes("password")
  ) {
    result.push({
      id: `${adapterType}_login_challenge`,
      label: "Login challenge",
      fieldType: "unknown",
      required: true,
      sensitive: true,
      confidence: 0.12,
      source: "user_required",
      sourceField: "login"
    });
  }

  result.push({
    id: `${adapterType}_final_submit`,
    label: "Final submit screen",
    fieldType: "checkbox",
    required: true,
    sensitive: true,
    confidence: 0.1,
    source: "user_required",
    sourceField: "final submit"
  });

  return result;
}

function profileHasValue(profile: UserProfile | null, sourceField: string): boolean {
  if (!profile) {
    return false;
  }
  if (sourceField === "salaryTarget") {
    return Boolean(profile.salaryTarget || profile.salaryMin);
  }
  const value = profile[sourceField as keyof UserProfile];
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value !== null && value !== undefined && String(value).trim().length > 0;
}

function answerForField(
  field: DetectedApplicationField,
  answers: ApplicationAnswer[]
): ApplicationAnswer | null {
  const label = field.label.toLowerCase();
  return (
    answers.find((answer) => answer.question.toLowerCase() === label) ??
    answers.find((answer) => {
      const question = answer.question.toLowerCase();
      return question.includes(label) || label.includes(question);
    }) ??
    null
  );
}

function fieldWithAnswerMapping(
  field: DetectedApplicationField,
  answers: ApplicationAnswer[]
): DetectedApplicationField {
  if (field.source !== "user_required" || field.sensitive) {
    return field;
  }
  const answer = answerForField(field, answers);
  if (!answer) {
    return field;
  }
  return {
    ...field,
    source: "application_answer",
    sourceField: answer.question,
    confidence: answer.needsUserReview ? 0.62 : 0.82
  };
}

function canFillField(
  field: DetectedApplicationField,
  profile: UserProfile | null,
  applicationPackage: ApplicationPackage,
  answers: ApplicationAnswer[]
): boolean {
  if (field.sensitive || field.source === "user_required") {
    return false;
  }

  if (field.source === "profile") {
    return profileHasValue(profile, field.sourceField);
  }

  if (field.source === "resume") {
    return applicationPackage.resumeMarkdown.trim().length > 0;
  }

  if (field.source === "application_package") {
    return applicationPackage.coverLetter.trim().length > 0;
  }

  if (field.source === "application_answer") {
    const answer = answers.find((item) => item.question === field.sourceField);
    return Boolean(answer && answer.answer.trim().length > 0 && !answer.needsUserReview);
  }

  return false;
}

function valuePreview(source: ApplicationFieldSource, sourceField: string): string {
  if (source === "profile") {
    return `Saved profile field: ${sourceField}`;
  }
  if (source === "resume") {
    return "Approved resume draft from package";
  }
  if (source === "application_package") {
    return `Approved package content: ${sourceField}`;
  }
  if (source === "application_answer") {
    return `Approved answer: ${sourceField}`;
  }
  return "User review required";
}

function reasonForPause(
  field: DetectedApplicationField,
  filledFieldIds: Set<string>,
  answers: ApplicationAnswer[]
): UncertainApplicationField | null {
  const lower = `${field.id} ${field.label} ${field.sourceField}`.toLowerCase();
  let reason: UncertainFieldReason | null = null;
  let guidance = "Review this field manually before the assistant can continue.";

  if (field.fieldType === "captcha" || lower.includes("captcha")) {
    reason = "captcha";
    guidance = "Human action is required; the assistant will not bypass CAPTCHA.";
  } else if (lower.includes("login")) {
    reason = "login_challenge";
    guidance =
      "Sign in manually if the job board requires authentication; credentials are never handled by the assistant.";
  } else if (lower.includes("final submit")) {
    reason = "final_submit";
    guidance = "Review all filled fields and explicitly approve before submit.";
  } else if (labelIncludes(lower, DEMOGRAPHIC_TERMS) || field.sourceField === "demographic defaults") {
    reason = "demographic";
    guidance =
      "Voluntary demographic questions require saved user defaults or manual input.";
  } else if (lower.includes("salary") && !filledFieldIds.has(field.id)) {
    reason = "salary_missing";
    guidance = "Add salary expectations in the profile or complete this field manually.";
  } else if (field.sensitive) {
    reason = "sensitive";
    guidance = "Sensitive fields require user review before any answer is used.";
  } else if (field.source === "application_answer") {
    const answer = answers.find((item) => item.question === field.sourceField);
    if (answer?.needsUserReview) {
      reason = "low_confidence";
      guidance = "Review the approved answer before using it in an application form.";
    }
  }

  if (!reason && field.required && !filledFieldIds.has(field.id)) {
    reason = field.confidence < 0.55 ? "low_confidence" : "unclear_required";
    guidance = "Required field needs human input before the assistant can continue.";
  }

  if (!reason) {
    return null;
  }

  return {
    fieldId: field.id,
    label: field.label,
    reason,
    required: field.required,
    guidance
  };
}

abstract class BaseATSAdapter implements ATSAdapter {
  abstract type: BrowserAtsType;
  abstract name: string;
  protected abstract urlSignals: string[];
  protected abstract structureSignals: string[];

  detect(page: ATSPageSnapshot): AdapterDetectionResult {
    const url = page.url.toLowerCase();
    const html = page.html.toLowerCase();
    const urlMatches = this.urlSignals.filter((signal) => url.includes(signal));
    const structureMatches = this.structureSignals.filter((signal) =>
      html.includes(signal)
    );
    const confidence = clamp(
      urlMatches.length > 0
        ? 0.86 + Math.min(structureMatches.length, 2) * 0.05
        : structureMatches.length > 0
          ? 0.62 + Math.min(structureMatches.length, 3) * 0.08
          : 0.05
    );
    return {
      adapterType: this.type,
      adapterName: this.name,
      confidence,
      reasons: [...urlMatches, ...structureMatches]
    };
  }

  analyzeForm(page: ATSPageSnapshot): DetectedApplicationForm {
    const controls = parseControls(page.html);
    const fields = addSystemPauseFields(
      page.html,
      controls.map((control, index) =>
        detectedFieldFromControl(control, this.type, index + 1)
      ),
      this.type
    );
    const detection = this.detect(page);
    return {
      adapterType: this.type,
      adapterName: this.name,
      confidence: detection.confidence,
      fields
    };
  }

  createFillPlan(
    profile: UserProfile | null,
    applicationPackage: ApplicationPackage,
    detectedForm: DetectedApplicationForm,
    options: { answers?: ApplicationAnswer[]; resume?: Resume | null; mode?: BrowserFillMode } = {}
  ): FillPlan {
    const answers = options.answers ?? [];
    const mode = options.mode ?? "dry_run";
    const fieldsDetected = detectedForm.fields.map((field) =>
      fieldWithAnswerMapping(field, answers)
    );
    const fieldsFilled = fieldsDetected
      .filter((field) => canFillField(field, profile, applicationPackage, answers))
      .map((field) => ({
        fieldId: field.id,
        label: field.label,
        source: field.source,
        sourceField: field.sourceField,
        valuePreview: valuePreview(field.source, field.sourceField),
        confidence: field.confidence
      }));
    const filledFieldIds = new Set(fieldsFilled.map((field) => field.fieldId));
    const uncertainFields = fieldsDetected
      .map((field) => reasonForPause(field, filledFieldIds, answers))
      .filter((field): field is UncertainApplicationField => Boolean(field));
    const uncertainIds = new Set(uncertainFields.map((field) => field.fieldId));
    const items = fieldsDetected.map((field) => {
      const filled = fieldsFilled.find((item) => item.fieldId === field.id);
      const pause = uncertainFields.find((item) => item.fieldId === field.id);
      const action: FillPlanAction =
        pause
          ? "pause"
          : filled
            ? field.fieldType === "file"
              ? "upload"
              : "fill"
            : "skip";
      return {
        fieldId: field.id,
        label: field.label,
        action,
        source: filled?.source ?? field.source,
        sourceField: filled?.sourceField ?? field.sourceField,
        valuePreview: filled?.valuePreview ?? "No safe value available",
        confidence: filled?.confidence ?? field.confidence,
        reason: pause?.guidance ?? (uncertainIds.has(field.id) ? "Needs review" : "")
      };
    });

    return {
      adapterType: detectedForm.adapterType,
      adapterName: detectedForm.adapterName,
      confidence: detectedForm.confidence,
      mode,
      fieldsDetected,
      fieldsFilled,
      uncertainFields,
      items
    };
  }

  executeFillPlan(
    _page: ATSPageSnapshot,
    fillPlan: FillPlan,
    mode: BrowserFillMode
  ): FillResult {
    const fillable =
      mode === "dry_run"
        ? fillPlan.fieldsFilled
        : fillPlan.fieldsFilled.filter(
            (field) =>
              !fillPlan.uncertainFields.some((pause) => pause.fieldId === field.fieldId)
          );
    return {
      mode,
      fieldsFilled: fillable,
      fieldsSkipped: fillPlan.items.length - fillable.length,
      submitted: false
    };
  }

  prepareForReview(page: ATSPageSnapshot): ReviewResult {
    return {
      readyForReview: true,
      screenshotUrl: page.safeFixture ? null : null
    };
  }

  submitAfterApproval(
    page: ATSPageSnapshot,
    session: BrowserApplicationSession
  ): SubmitResult {
    if (
      session.status !== "approved_for_submit" ||
      session.fillMode !== "submit_after_approval" ||
      !page.safeFixture
    ) {
      return {
        submitted: false,
        confirmationDetected: false,
        message: "Live submit is disabled unless an approved safe fixture submit is configured."
      };
    }

    return {
      submitted: true,
      confirmationDetected: true,
      message: "Safe fixture submission confirmed."
    };
  }
}

export class GreenhouseATSAdapter extends BaseATSAdapter {
  type: BrowserAtsType = "greenhouse";
  name = "greenhouse-ats-adapter";
  protected urlSignals = ["greenhouse.io", "boards.greenhouse.io"];
  protected structureSignals = [
    "greenhouse",
    "application_form",
    "job_application",
    "first name",
    "last name"
  ];
}

export class LeverATSAdapter extends BaseATSAdapter {
  type: BrowserAtsType = "lever";
  name = "lever-ats-adapter";
  protected urlSignals = ["jobs.lever.co", "lever.co"];
  protected structureSignals = [
    "lever",
    "posting-form",
    "application-form",
    "additional information",
    "resume"
  ];
}

export class UnknownATSAdapter extends BaseATSAdapter {
  type: BrowserAtsType = "unknown";
  name = "unknown-ats-adapter";
  protected urlSignals: string[] = [];
  protected structureSignals = ["application", "resume", "email"];

  detect(page: ATSPageSnapshot): AdapterDetectionResult {
    const base = super.detect(page);
    return {
      ...base,
      confidence: Math.min(base.confidence, 0.35)
    };
  }
}

export function defaultATSAdapters(): ATSAdapter[] {
  return [new GreenhouseATSAdapter(), new LeverATSAdapter()];
}

export function selectATSAdapter(
  page: ATSPageSnapshot,
  adapters: ATSAdapter[] = defaultATSAdapters()
): { adapter: ATSAdapter; detection: AdapterDetectionResult } {
  const detections = adapters
    .map((adapter) => ({ adapter, detection: adapter.detect(page) }))
    .sort((a, b) => b.detection.confidence - a.detection.confidence);
  const best = detections[0];
  if (!best || best.detection.confidence < 0.4) {
    const adapter = new UnknownATSAdapter();
    return { adapter, detection: adapter.detect(page) };
  }
  return best;
}

export const greenhouseFixtureHtml = `
<main class="greenhouse job_application" data-ats="greenhouse">
  <form id="application_form">
    <label for="first_name">First Name</label>
    <input id="first_name" name="job_application[first_name]" required />
    <label for="last_name">Last Name</label>
    <input id="last_name" name="job_application[last_name]" required />
    <label for="email">Email</label>
    <input id="email" name="job_application[email]" type="email" required />
    <label for="phone">Phone</label>
    <input id="phone" name="job_application[phone]" type="tel" />
    <label for="resume">Resume</label>
    <input id="resume" name="job_application[resume]" type="file" required />
    <label for="cover_letter">Cover Letter</label>
    <input id="cover_letter" name="job_application[cover_letter]" type="file" />
    <label for="custom_question">What makes you a strong fit?</label>
    <textarea id="custom_question" name="job_application[answers][]"></textarea>
    <label for="eeoc_gender">Gender</label>
    <select id="eeoc_gender" name="job_application[eeoc][gender]"></select>
    <div class="g-recaptcha">CAPTCHA</div>
  </form>
</main>
`;

export const leverFixtureHtml = `
<section class="lever posting-form application-form" data-ats="lever">
  <form>
    <label for="name">Name</label>
    <input id="name" name="name" required />
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required />
    <label for="phone">Phone</label>
    <input id="phone" name="phone" type="tel" />
    <label for="resume">Resume</label>
    <input id="resume" name="resume" type="file" required />
    <label for="linkedin">LinkedIn URL</label>
    <input id="linkedin" name="urls[LinkedIn]" type="url" />
    <label for="portfolio">Portfolio URL</label>
    <input id="portfolio" name="urls[Portfolio]" type="url" />
    <label for="comments">Additional Information</label>
    <textarea id="comments" name="comments"></textarea>
    <label for="veteran">Veteran status</label>
    <select id="veteran" name="eeo[veteran]"></select>
  </form>
</section>
`;

export function greenhouseFixturePage(url = "https://boards.greenhouse.io/example/jobs/123"): ATSPageSnapshot {
  return {
    url,
    html: greenhouseFixtureHtml,
    title: "Greenhouse application fixture",
    safeFixture: true
  };
}

export function leverFixturePage(url = "https://jobs.lever.co/example/abc"): ATSPageSnapshot {
  return {
    url,
    html: leverFixtureHtml,
    title: "Lever application fixture",
    safeFixture: true
  };
}
