/**
 * Back-compat shim: canonical CLI backend predicates live in app/cli.
 * `useThreadRuntimeSelections` and `CliBackendIcon` keep importing from here.
 */
export {
  isCodexCliBackend,
  isClaudeCliBackend,
  isAuggieCliBackend,
  isAgyCliBackend,
  isGrokCliBackend,
  isMuseCliBackend,
  isPiCliBackend,
  isOpencodeCliBackend,
  isMiniCliBackend,
  normalizeThreadCliBackend,
  type ThreadCliBackend,
} from "../cli/cliBackendKind";
