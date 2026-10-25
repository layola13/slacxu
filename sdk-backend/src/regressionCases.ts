/** Regression case definitions + loader (R2: owned by the SDK).
 *
 * Loading cases is a pure filesystem read (tests/cases/regression/*.case.json)
 * with no host state, so the implementation lives here; the host's
 * regressionRunner imports it and adds the runner/report machinery.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** One regression case definition (host: regressionRunner). */
export interface RegressionCase {
  id: string;
  title: string;
  component: string;
  tags?: string[];
  category?: "state_machine" | "protocol_stream" | "lifecycle" | "hook_ordering" | "custom";
  description?: string;
  input?: Record<string, unknown>;
  simulation?: {
    rounds?: Array<Record<string, unknown>>;
    events?: Array<Record<string, unknown>>;
  };
  negativeMatcher?: {
    forbiddenPatterns?: string[];
    forbiddenErrors?: string[];
    forbiddenStates?: Record<string, unknown>;
  };
  positiveInvariants?: {
    requiredPatterns?: string[];
    requiredStates?: Record<string, unknown>;
    minSegments?: number;
  };
  runner?: string;
}

export interface RegressionCaseFilter {
  id?: string;
  component?: string;
  tag?: string | string[];
  tags?: string[];
  category?: string;
}

export function resolveRegressionCasesDir(cwd?: string): string {
  const root = cwd ? resolve(cwd) : process.cwd();
  return join(root, "tests", "cases", "regression");
}

/**
 * Loads all regression cases matching the optional filter from `tests/cases/regression/*.case.json`.
 */
export function loadRegressionCases(filter?: RegressionCaseFilter, cwd?: string): RegressionCase[] {
  const dir = resolveRegressionCasesDir(cwd);
  if (!existsSync(dir)) return [];

  const files = readdirSync(dir).filter((file) => file.endsWith(".json"));
  const cases: RegressionCase[] = [];

  for (const file of files) {
    try {
      const fullPath = join(dir, file);
      const raw = readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(raw) as RegressionCase;
      if (!parsed.id || !parsed.component) continue;

      if (filter) {
        if (filter.id && parsed.id.toLowerCase() !== filter.id.toLowerCase()) {
          continue;
        }
        if (filter.component) {
          const cFilter = filter.component.toLowerCase().replace(/^[\\/]+|[\\/]+$/g, "");
          const target = parsed.component.toLowerCase();
          const targetBase = basename(target);
          if (!target.includes(cFilter) && !cFilter.includes(targetBase) && !targetBase.includes(cFilter)) {
            continue;
          }
        }
        if (filter.category && parsed.category !== filter.category) {
          continue;
        }
        const filterTags = Array.isArray(filter.tags)
          ? filter.tags
          : (typeof filter.tag === "string" ? [filter.tag] : (Array.isArray(filter.tag) ? filter.tag : []));
        if (filterTags.length > 0) {
          const caseTags = (parsed.tags || []).map((t) => t.toLowerCase());
          const hasMatch = filterTags.some((t) => caseTags.includes(t.toLowerCase()));
          if (!hasMatch) continue;
        }
      }

      cases.push(parsed);
    } catch {
      // Ignore corrupted case files
    }
  }

  return cases.sort((a, b) => a.id.localeCompare(b.id));
}
