/**
 * Shared types for the Agentic Job Ops browser extension <-> app contract.
 *
 * This file is intentionally TypeScript so the app side can import the same
 * shapes. The runtime extension scripts are plain JavaScript and document the
 * contract via JSDoc.
 */

import type { ApplicationFieldType } from "../../src/models/domain";

export type { ApplicationFieldType };

export interface ExtensionPageStructureFieldMessage {
  fieldId: string;
  label: string;
  fieldType: ApplicationFieldType;
  inputName: string;
  inputId: string;
  placeholder: string;
  required: boolean;
  sensitive: boolean;
  /**
   * `true` when the input already has a non-empty value at capture time. The
   * actual value is intentionally NOT included to avoid leaking user-typed
   * data, credentials, or autofilled secrets.
   */
  hasValue: boolean;
}

export interface ExtensionPageStructureMessage {
  pageUrl: string;
  pageTitle: string;
  hostname: string;
  fields: ExtensionPageStructureFieldMessage[];
  hasSubmitButton: boolean;
  hasCaptcha: boolean;
  hasLoginChallenge: boolean;
  capturedAt: string;
}

export interface ExtensionFillFieldRequest {
  fieldId: string;
  inputId?: string;
  inputName?: string;
  /**
   * Display-only preview text the extension may paste into the field. The
   * extension never receives raw secrets from the app; values come from a
   * controlled local source the user explicitly approved.
   */
  valuePreview?: string;
  /**
   * Optional explicit value to write; provided only when the user has
   * explicitly approved the value via the app's review screen.
   */
  value?: string;
}

export type ExtensionRuntimeMessage =
  | { type: "agentic-job-ops/connect-active-tab" }
  | { type: "agentic-job-ops/get-active-session" }
  | { type: "agentic-job-ops/disconnect" }
  | { type: "agentic-job-ops/extract" }
  | { type: "agentic-job-ops/apply-fill-plan"; fields: ExtensionFillFieldRequest[] };

export type ExtensionRuntimeResponse =
  | { ok: true; structure?: ExtensionPageStructureMessage; filledFieldIds?: string[]; session?: { tabId: number; pageUrl: string; pageTitle: string; connectedAt: string } | null }
  | { ok: false; error: string };
