import type { JsonValue } from "@codex-ui/shared";
import codexConfigSchema from "./codexConfigSchema.json";

/**
 * Curated Codex user-config surface for the Settings page.
 * Theme plugins and provider API keys stay out of this module by design.
 */
export type CodexConfigQuickView = {
  model: string | null;
  reviewModel: string | null;
  modelProvider: string | null;
  modelReasoningEffort: string | null;
  modelReasoningSummary: string | null;
  modelVerbosity: string | null;
  approvalPolicy: string | null;
  sandboxMode: string | null;
  webSearch: string | null;
  serviceTier: string | null;
  instructions: string | null;
  developerInstructions: string | null;
};

export type CodexUserConfigView = CodexConfigQuickView & {
  rawConfig: Record<string, unknown>;
};

export type CodexConfigFieldKey = keyof CodexConfigQuickView;

export type CodexConfigEdit = {
  keyPath: string;
  value: JsonValue;
  mergeStrategy: "replace";
};

type JsonSchemaLike = JsonSchema | boolean;

type JsonSchema = {
  $ref?: string;
  allOf?: JsonSchemaLike[];
  anyOf?: JsonSchemaLike[];
  oneOf?: JsonSchemaLike[];
  type?: string | string[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  title?: string;
  properties?: Record<string, JsonSchemaLike>;
  additionalProperties?: boolean | JsonSchemaLike;
  items?: JsonSchemaLike;
};

export type DynamicCodexConfigField = {
  keyPath: string;
  label: string;
  description: string;
  kind: "boolean" | "number" | "text" | "select" | "textarea" | "json";
  group: string;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
  readOnly?: boolean;
  source: "schema" | "runtime";
};

const schemaRoot = codexConfigSchema as unknown as JsonSchema & { definitions?: Record<string, JsonSchemaLike> };

export const CODEX_CONFIG_KEY_PATHS: Record<CodexConfigFieldKey, string> = {
  model: "model",
  reviewModel: "review_model",
  modelProvider: "model_provider",
  modelReasoningEffort: "model_reasoning_effort",
  modelReasoningSummary: "model_reasoning_summary",
  modelVerbosity: "model_verbosity",
  approvalPolicy: "approval_policy",
  sandboxMode: "sandbox_mode",
  webSearch: "web_search",
  serviceTier: "service_tier",
  instructions: "instructions",
  developerInstructions: "developer_instructions"
};

export const CODEX_CONFIG_FIELD_META: Array<{
  key: CodexConfigFieldKey;
  keyPath: string;
  label: string;
  description: string;
  kind: "text" | "select" | "textarea";
  options?: Array<{ value: string; label: string }>;
  /** When true, field is shown read-only (managed elsewhere or display-only). */
  readOnly?: boolean;
}> = [
  {
    key: "model",
    keyPath: CODEX_CONFIG_KEY_PATHS.model,
    label: "Default model",
    description: "Codex user config model default (provider activation may override for the active session).",
    kind: "text"
  },
  {
    key: "reviewModel",
    keyPath: CODEX_CONFIG_KEY_PATHS.reviewModel,
    label: "Review model",
    description: "Optional review_model used for review sessions.",
    kind: "text"
  },
  {
    key: "modelProvider",
    keyPath: CODEX_CONFIG_KEY_PATHS.modelProvider,
    label: "Model provider",
    description: "Engine model_provider key. Third-party relays are activated from the Config inspector, not rewritten as API keys here.",
    kind: "text",
    readOnly: true
  },
  {
    key: "modelReasoningEffort",
    keyPath: CODEX_CONFIG_KEY_PATHS.modelReasoningEffort,
    label: "Default reasoning effort",
    description: "Persisted model_reasoning_effort in user config.toml.",
    kind: "select",
    options: [
     { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
      { value: "xhigh", label: "Extra high" },
    ]
  },
  {
    key: "modelReasoningSummary",
    keyPath: CODEX_CONFIG_KEY_PATHS.modelReasoningSummary,
    label: "Reasoning summary",
    description: "Persisted model_reasoning_summary.",
    kind: "select",
    options: [
      { value: "auto", label: "Auto" },
      { value: "concise", label: "Concise" },
      { value: "detailed", label: "Detailed" },
      { value: "none", label: "None" }
    ]
  },
  {
    key: "modelVerbosity",
    keyPath: CODEX_CONFIG_KEY_PATHS.modelVerbosity,
    label: "Model verbosity",
    description: "Persisted model_verbosity for Responses models.",
    kind: "select",
    options: [
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" }
    ]
  },
  {
    key: "serviceTier",
    keyPath: CODEX_CONFIG_KEY_PATHS.serviceTier,
    label: "Service tier",
    description: "Optional service_tier for model requests.",
    kind: "text"
  },
  {
    key: "approvalPolicy",
    keyPath: CODEX_CONFIG_KEY_PATHS.approvalPolicy,
    label: "Approval policy",
    description: "Default approval_policy for new threads (string forms only).",
    kind: "select",
    options: [
      { value: "untrusted", label: "Untrusted" },
      { value: "on-request", label: "On request" },
      { value: "never", label: "Never" }
    ]
  },
  {
    key: "sandboxMode",
    keyPath: CODEX_CONFIG_KEY_PATHS.sandboxMode,
    label: "Sandbox mode",
    description: "Default sandbox_mode for command execution.",
    kind: "select",
    options: [
      { value: "read-only", label: "Read only" },
      { value: "workspace-write", label: "Workspace write" },
      { value: "danger-full-access", label: "Danger full access" }
    ]
  },
  {
    key: "webSearch",
    keyPath: CODEX_CONFIG_KEY_PATHS.webSearch,
    label: "Web search",
    description: "Default web_search mode.",
    kind: "select",
    options: [
      { value: "disabled", label: "Disabled" },
      { value: "cached", label: "Cached" },
      { value: "indexed", label: "Indexed" },
      { value: "live", label: "Live" }
    ]
  },
  {
    key: "instructions",
    keyPath: CODEX_CONFIG_KEY_PATHS.instructions,
    label: "User instructions",
    description: "Persisted instructions prepended for Codex sessions.",
    kind: "textarea"
  },
  {
    key: "developerInstructions",
    keyPath: CODEX_CONFIG_KEY_PATHS.developerInstructions,
    label: "Developer instructions",
    description: "Persisted developer_instructions for engine-level guidance.",
    kind: "textarea"
  }
];

export const EMPTY_CODEX_USER_CONFIG: CodexUserConfigView = {
  model: null,
  reviewModel: null,
  modelProvider: null,
  modelReasoningEffort: null,
  modelReasoningSummary: null,
  modelVerbosity: null,
  approvalPolicy: null,
  sandboxMode: null,
  webSearch: null,
  serviceTier: null,
  instructions: null,
  developerInstructions: null,
  rawConfig: {}
};

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asNullableString(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

/**
 * Map a raw Codex Config object (or partial) into the curated Settings view.
 */
export function configToUserView(config: unknown): CodexUserConfigView {
  const record = asRecord(config);
  const approval = record.approval_policy;
  return {
    model: asNullableString(record.model),
    reviewModel: asNullableString(record.review_model),
    modelProvider: asNullableString(record.model_provider),
    modelReasoningEffort: asNullableString(record.model_reasoning_effort),
    modelReasoningSummary: asNullableString(record.model_reasoning_summary),
    modelVerbosity: asNullableString(record.model_verbosity),
    approvalPolicy: typeof approval === "string" ? approval : null,
    sandboxMode: asNullableString(record.sandbox_mode),
    webSearch: asNullableString(record.web_search),
    serviceTier: asNullableString(record.service_tier),
    instructions: asNullableString(record.instructions),
    developerInstructions: asNullableString(record.developer_instructions),
    rawConfig: record
  };
}

/**
 * Parse a config/read RPC result into the curated Settings view.
 */
export function parseConfigReadResponse(result: unknown): CodexUserConfigView {
  const root = asRecord(result);
  const config = root.config ?? result;
  return configToUserView(config);
}

/**
 * Build params for config/value/write for a single curated field.
 * Returns null when the field is read-only or the value is empty/null (clear not supported here).
 */
export function buildConfigValueWrite(
  field: CodexConfigFieldKey,
  value: string | null
): { keyPath: string; value: JsonValue; mergeStrategy: "replace" } | null {
  const meta = CODEX_CONFIG_FIELD_META.find((entry) => entry.key === field);
  if (!meta || meta.readOnly) {
    return null;
  }
  if (value == null) {
    return null;
  }
  // Allow empty string only for free-text instruction fields.
  if (value === "" && meta.kind !== "textarea") {
    return null;
  }
  return {
    keyPath: CODEX_CONFIG_KEY_PATHS[field],
    value,
    mergeStrategy: "replace"
  };
}

export function buildDynamicConfigValueWrite(
  keyPath: string,
  value: JsonValue
): { keyPath: string; value: JsonValue; mergeStrategy: "replace" } | null {
  if (!keyPath.trim()) {
    return null;
  }
  return {
    keyPath,
    value,
    mergeStrategy: "replace"
  };
}

/**
 * Build params for config/batchWrite with reloadUserConfig.
 */
export function buildConfigBatchWrite(
  edits: Array<{ field: CodexConfigFieldKey; value: string | null }>
): { edits: CodexConfigEdit[]; reloadUserConfig: true } | null {
  const mapped: CodexConfigEdit[] = [];
  for (const edit of edits) {
    const write = buildConfigValueWrite(edit.field, edit.value);
    if (write) {
      mapped.push(write);
    }
  }
  if (mapped.length === 0) {
    return null;
  }
  return { edits: mapped, reloadUserConfig: true };
}

/**
 * Diff two views into field edits (writable fields only).
 */
export function diffConfigViews(
  previous: CodexUserConfigView,
  next: CodexUserConfigView
): Array<{ field: CodexConfigFieldKey; value: string | null }> {
  const edits: Array<{ field: CodexConfigFieldKey; value: string | null }> = [];
  for (const meta of CODEX_CONFIG_FIELD_META) {
    if (meta.readOnly) {
      continue;
    }
    if (previous[meta.key] !== next[meta.key]) {
      edits.push({ field: meta.key, value: next[meta.key] });
    }
  }
  return edits;
}

/**
 * Apply an outbound write into a local view (for optimistic / re-read simulation).
 */
export function applyConfigWriteToView(
  current: CodexUserConfigView,
  keyPath: string,
  value: JsonValue
): CodexUserConfigView {
  const field = (Object.entries(CODEX_CONFIG_KEY_PATHS) as Array<[CodexConfigFieldKey, string]>).find(
    ([, path]) => path === keyPath
  )?.[0];
  return {
    ...current,
    ...(field ? { [field]: asNullableString(value) } : null),
    rawConfig: setConfigValueAtPath(current.rawConfig, keyPath, value)
  };
}

export function getDynamicCodexConfigFields(config?: Record<string, unknown>): DynamicCodexConfigField[] {
  const fields = flattenSchemaProperties(schemaRoot.properties ?? {}, []);
  const knownTopLevel = new Set(Object.keys(schemaRoot.properties ?? {}));
  const runtimeFields = Object.keys(config ?? {})
    .filter((key) => !knownTopLevel.has(key))
    .sort((a, b) => a.localeCompare(b))
    .map<DynamicCodexConfigField>((key) => ({
      keyPath: key,
      label: labelFromPath(key),
      description: "Runtime config key returned by config/read but not present in the bundled Codex schema.",
      kind: inferRuntimeKind((config ?? {})[key]),
      group: "runtime",
      source: "runtime"
    }));

  return [...fields, ...runtimeFields];
}

export function getConfigValueAtPath(config: Record<string, unknown>, keyPath: string): unknown {
  let current: unknown = config;
  for (const segment of keyPath.split(".")) {
    if (!segment) {
      return undefined;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function setConfigValueAtPath(config: Record<string, unknown>, keyPath: string, value: JsonValue): Record<string, unknown> {
  const segments = keyPath.split(".").filter(Boolean);
  if (segments.length === 0) {
    return config;
  }
  const next: Record<string, unknown> = { ...config };
  let cursor = next;
  segments.forEach((segment, index) => {
    if (index === segments.length - 1) {
      cursor[segment] = value;
      return;
    }
    const existing = cursor[segment];
    const child = existing && typeof existing === "object" && !Array.isArray(existing) ? { ...(existing as Record<string, unknown>) } : {};
    cursor[segment] = child;
    cursor = child;
  });
  return next;
}

export function formatConfigValueForField(field: DynamicCodexConfigField, value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (field.kind === "json") {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

export function parseDynamicConfigFieldValue(
  field: DynamicCodexConfigField,
  value: string | boolean
): { value: JsonValue } | { error: string } {
  if (field.kind === "boolean") {
    return { value: Boolean(value) };
  }
  if (typeof value !== "string") {
    return { error: "Expected a text value." };
  }
  if (field.kind === "number") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { error: "Number fields cannot be empty." };
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return { error: "Enter a valid number." };
    }
    return { value: parsed };
  }
  if (field.kind === "json") {
    const trimmed = value.trim();
    if (!trimmed) {
      return { error: "JSON fields cannot be empty." };
    }
    try {
      return { value: JSON.parse(trimmed) as JsonValue };
    } catch {
      return { error: "Enter valid JSON." };
    }
  }
  return { value };
}

function flattenSchemaProperties(properties: Record<string, JsonSchemaLike>, parentPath: string[]): DynamicCodexConfigField[] {
  const fields: DynamicCodexConfigField[] = [];
  for (const key of Object.keys(properties).sort((a, b) => a.localeCompare(b))) {
    const keyPath = [...parentPath, key];
    const schema = resolveSchema(properties[key]);
    fields.push(fieldFromSchema(keyPath, schema));

    const childProperties = schema.properties ?? {};
    for (const child of flattenSchemaProperties(childProperties, keyPath)) {
      fields.push(child);
    }
  }
  return fields;
}

function resolveSchema(schema: JsonSchemaLike | undefined, seen = new Set<string>()): JsonSchema {
  if (!schema) {
    return {};
  }
  if (typeof schema === "boolean") {
    return {};
  }
  let resolved: JsonSchema = schema;
  if (schema.$ref?.startsWith("#/definitions/")) {
    const name = schema.$ref.slice("#/definitions/".length);
    if (!seen.has(name)) {
      seen.add(name);
      resolved = mergeSchema(resolveSchema(schemaRoot.definitions?.[name], seen), withoutRef(schema));
    }
  }
  if (resolved.allOf?.length) {
    return resolved.allOf.reduce<JsonSchema>((acc, entry) => mergeSchema(acc, resolveSchema(entry, seen)), withoutAllOf(resolved));
  }
  const unionEntries = resolved.anyOf ?? resolved.oneOf;
  if (unionEntries?.length) {
    const objectBranches = unionEntries
      .map((entry) => resolveSchema(entry, new Set(seen)))
      .filter((entry) => entry.type === "object" || Boolean(entry.properties));
    if (objectBranches.length > 0) {
      return objectBranches.reduce<JsonSchema>((acc, entry) => mergeSchema(acc, entry), withoutUnion(resolved));
    }
  }
  return resolved;
}

function withoutRef(schema: JsonSchema): JsonSchema {
  const { $ref: _ref, ...rest } = schema;
  return rest;
}

function withoutAllOf(schema: JsonSchema): JsonSchema {
  const { allOf: _allOf, ...rest } = schema;
  return rest;
}

function withoutUnion(schema: JsonSchema): JsonSchema {
  const { anyOf: _anyOf, oneOf: _oneOf, ...rest } = schema;
  return rest;
}

function mergeSchema(base: JsonSchema, override: JsonSchema): JsonSchema {
  return {
    ...base,
    ...override,
    properties: {
      ...(base.properties ?? {}),
      ...(override.properties ?? {})
    }
  };
}

function fieldFromSchema(path: string[], schema: JsonSchema): DynamicCodexConfigField {
  const keyPath = path.join(".");
  const enumValues = extractEnum(schema);
  return {
    keyPath,
    label: labelFromPath(keyPath),
    description: dynamicFieldDescription(keyPath, schema),
    kind: inferSchemaKind(schema, enumValues),
    group: path[0] ?? "config",
    options: enumValues?.map((value) => ({ value, label: labelFromValue(value) })),
    defaultValue: schema.default,
    readOnly: false,
    source: "schema"
  };
}

function dynamicFieldDescription(keyPath: string, schema: JsonSchema): string {
  if (keyPath === "features.multi_agent_v2.tool_namespace") {
    return "Optional advanced namespace for multi-agent tools. Leave empty for ordinary function tools; third-party relays must preserve Responses API namespace and function names.";
  }
  return schema.description || `Codex config setting: ${keyPath}`;
}

function inferSchemaKind(schema: JsonSchema, enumValues?: string[]): DynamicCodexConfigField["kind"] {
  if (enumValues?.length) {
    return "select";
  }
  const type = Array.isArray(schema.type) ? schema.type.find((entry) => entry !== "null") : schema.type;
  if (type === "boolean") {
    return "boolean";
  }
  if (type === "number" || type === "integer") {
    return "number";
  }
  if (type === "string") {
    return isLongTextField(schema) ? "textarea" : "text";
  }
  if (type === "object" || type === "array" || schema.properties || schema.additionalProperties || schema.items) {
    return "json";
  }
  return "json";
}

function inferRuntimeKind(value: unknown): DynamicCodexConfigField["kind"] {
  if (typeof value === "boolean") {
    return "boolean";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "string") {
    return "text";
  }
  return "json";
}

function extractEnum(schema: JsonSchema): string[] | undefined {
  const enumValues = schema.enum;
  if (!enumValues?.length) {
    return undefined;
  }
  const strings = enumValues.filter((value): value is string => typeof value === "string");
  return strings.length === enumValues.length ? strings : undefined;
}

function isLongTextField(schema: JsonSchema): boolean {
  const description = schema.description?.toLowerCase() ?? "";
  return description.includes("instructions") || description.includes("prompt") || description.includes("template");
}

function labelFromPath(keyPath: string): string {
  return keyPath
    .split(".")
    .map((segment) => labelFromValue(segment))
    .join(" / ");
}

function labelFromValue(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
