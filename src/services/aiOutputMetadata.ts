import type {
  AIOutputMetadata,
  AIOutputType,
  AppSession
} from "../models/domain";
import { aiOutputMetadataSchema } from "../models/schemas";
import { readJson, scopedKey, writeJson } from "../lib/storage";

interface AIOutputMetadataInput {
  outputType: AIOutputType;
  resourceType: string;
  resourceId: string;
  modelName: string;
  promptVersion: string;
  provider?: string;
  mode?: string;
  inputHash?: string;
  outputHash?: string;
  tokenInput?: number;
  tokenOutput?: number;
}

function createId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID()}`;
}

function metadataKey(session: AppSession): string {
  return scopedKey(session.tenant.id, session.userId, "ai_output_metadata");
}

export function loadAIOutputMetadata(session: AppSession): AIOutputMetadata[] {
  const metadata = readJson<AIOutputMetadata[]>(metadataKey(session), []);
  return metadata.filter((item) => aiOutputMetadataSchema.safeParse(item).success);
}

export function saveAIOutputMetadata(
  session: AppSession,
  metadata: AIOutputMetadata[]
): AIOutputMetadata[] {
  const parsed = metadata.map((item) => aiOutputMetadataSchema.parse(item));
  writeJson(metadataKey(session), parsed.slice(0, 1000));
  return parsed;
}

export function recordAIOutputMetadata(
  session: AppSession,
  input: AIOutputMetadataInput
): AIOutputMetadata {
  const metadata = aiOutputMetadataSchema.parse({
    id: createId("ai_meta"),
    tenantId: session.tenant.id,
    userId: session.userId,
    outputType: input.outputType,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    modelName: input.modelName,
    promptVersion: input.promptVersion,
    provider: input.provider ?? "local",
    mode: input.mode ?? "deterministic",
    inputHash: input.inputHash ?? "not_recorded",
    outputHash: input.outputHash ?? "not_recorded",
    tokenInput: input.tokenInput ?? 0,
    tokenOutput: input.tokenOutput ?? 0,
    createdAt: new Date().toISOString()
  });

  saveAIOutputMetadata(session, [metadata, ...loadAIOutputMetadata(session)]);
  return metadata;
}

export function summarizeAIOutputMetadata(
  metadata: AIOutputMetadata[]
): Record<string, number> {
  return metadata.reduce<Record<string, number>>((counts, item) => {
    counts[item.outputType] = (counts[item.outputType] ?? 0) + 1;
    return counts;
  }, {});
}
