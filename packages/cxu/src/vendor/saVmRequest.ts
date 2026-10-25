export type SaVmRequestValidation =
  | { ok: true; isParallel: boolean }
  | { ok: false; error: string; code: "CUX-SA-VM-SLA-REQUIRED" | "CUX-SA-VM-INVALID-INPUT" | "CUX-SA-VM-INVALID-PARALLEL" };

export type SaVmParallelNormalization =
  | { ok: true; tasks: Array<Record<string, unknown>> | undefined }
  | { ok: false; error: string };

const MAX_PARALLEL_STRING_BYTES = 256 * 1024;

/**
 * Models routinely send `parallel` as a JSON-encoded string instead of a real
 * array. Without this coercion the batch silently falls through to the script
 * engine and fails with the unrelated "source must be a string", which gives
 * the caller no way to self-correct. Accept the string form (array or single
 * task object) and reject anything that cannot be decoded into task objects.
 */
export function normalizeSaVmParallelTasks(value: unknown): SaVmParallelNormalization {
  if (value === undefined || value === null) return { ok: true, tasks: undefined };

  let candidate: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ok: false, error: "parallel must not be an empty string; pass a JSON array of task objects" };
    if (Buffer.byteLength(trimmed, "utf8") > MAX_PARALLEL_STRING_BYTES) {
      return { ok: false, error: `parallel string exceeds ${MAX_PARALLEL_STRING_BYTES} bytes` };
    }
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error: "parallel must be a JSON array of task objects (e.g. [{ \"action\": \"list_dir\", \"dir\": \".\" }]); a JSON-encoded string is accepted but must decode to an array or a single task object"
      };
    }
  }

  if (!Array.isArray(candidate) && (typeof candidate !== "object" || candidate === null)) {
    return { ok: false, error: `parallel must be an array of task objects (received ${typeof candidate})` };
  }

  const tasks = (Array.isArray(candidate) ? candidate : [candidate]) as unknown[];
  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    if (Array.isArray(task) || typeof task !== "object" || task === null) {
      return { ok: false, error: `parallel[${index}] must be a task object with an 'action' or 'path' field` };
    }
  }

  return { ok: true, tasks: tasks as Array<Record<string, unknown>> };
}

export function validateSaVmRequestBody(body: Record<string, unknown>): SaVmRequestValidation {
  const parallel = normalizeSaVmParallelTasks(body.parallel);
  if (!parallel.ok) {
    return { ok: false, error: parallel.error, code: "CUX-SA-VM-INVALID-PARALLEL" };
  }
  const isParallel = parallel.tasks !== undefined;
  const hasAction = typeof body.action === "string" || typeof body.path === "string";
  const hasSource = typeof body.source === "string";
  if (!isParallel && !hasAction) {
    if (body.language !== undefined && body.language !== "js" && body.language !== "py") {
      return {
        ok: false,
        error: "SA-VM requests require language=\"js\" or language=\"py\" when source is provided (bun branch; sa/sla removed)",
        code: "CUX-SA-VM-SLA-REQUIRED"
      };
    }
    if (!hasSource) {
      return {
        ok: false,
        error: "SA-VM requests require an action (e.g. read_file, find_files, write_file) or source",
        code: "CUX-SA-VM-SLA-REQUIRED"
      };
    }
  }

  const rawAction = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (rawAction === "run_project_check") {
    if (body.profile !== undefined && typeof body.profile !== "string") {
      return {
        ok: false,
        error: "run_project_check requires a string 'profile'",
        code: "CUX-SA-VM-INVALID-INPUT"
      };
    }
    if (body.test_file !== undefined && typeof body.test_file !== "string") {
      return {
        ok: false,
        error: "run_project_check 'test_file' must be a string",
        code: "CUX-SA-VM-INVALID-INPUT"
      };
    }
  } else if (rawAction === "run_bun") {
    if (body.subcommand !== undefined && typeof body.subcommand !== "string") {
      return {
        ok: false,
        error: "run_bun 'subcommand' must be a string",
        code: "CUX-SA-VM-INVALID-INPUT"
      };
    }
    if (body.args !== undefined && (!Array.isArray(body.args) || body.args.some((arg) => typeof arg !== "string"))) {
      return {
        ok: false,
        error: "run_bun 'args' must be an array of strings",
        code: "CUX-SA-VM-INVALID-INPUT"
      };
    }
  }

  return { ok: true, isParallel };
}
