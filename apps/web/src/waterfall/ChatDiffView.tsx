import { memo, useMemo } from "react";
import { generateDiffFile } from "@git-diff-view/file";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import "@git-diff-view/react/styles/diff-view.css";
import { Box } from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";

export const GitFileDiffView = memo(function GitFileDiffView({ beforeText, afterText, filePath }: { beforeText: string; afterText: string; filePath?: string }) {
  const theme = useTheme();
  const lang = guessLangFromPath(filePath);
  const diffFile = useMemo(() => {
    if (!beforeText && !afterText) {
      return null;
    }
    if (isLargeDiffInput(beforeText, afterText)) {
      return null;
    }
    try {
      const instance = generateDiffFile(filePath ?? "old", beforeText, filePath ?? "new", afterText, lang, lang);
      instance.init();
      instance.buildUnifiedDiffLines();
      return instance;
    } catch {
      return null;
    }
  }, [afterText, beforeText, filePath, lang]);

  if (!diffFile) {
    return <UnifiedDiffBlock text={fallbackUnifiedDiff(beforeText, afterText)} />;
  }

  return (
    <Box
      data-testid="file-diff-view"
      sx={{
        maxHeight: "min(54vh, 620px)",
        overflow: "auto",
        "--diff-background-color": "transparent",
        "--diff-text-color": "inherit",
        "--diff-selection-background-color": "rgba(56, 132, 255, 0.24)",
        "--diff-selection-text-color": "inherit",
        "--diff-gutter-insert-background-color": "rgba(46, 160, 67, 0.18)",
        "--diff-gutter-insert-text-color": "inherit",
        "--diff-gutter-delete-background-color": "rgba(248, 81, 73, 0.18)",
        "--diff-gutter-delete-text-color": "inherit",
        "--diff-gutter-selected-background-color": "rgba(255, 220, 120, 0.18)",
        "--diff-gutter-selected-text-color": "inherit",
        "--diff-code-insert-background-color": "rgba(46, 160, 67, 0.10)",
        "--diff-code-insert-text-color": "inherit",
        "--diff-code-delete-background-color": "rgba(248, 81, 73, 0.10)",
        "--diff-code-delete-text-color": "inherit",
        "--diff-code-insert-edit-background-color": "rgba(46, 160, 67, 0.18)",
        "--diff-code-insert-edit-text-color": "inherit",
        "--diff-code-delete-edit-background-color": "rgba(248, 81, 73, 0.18)",
        "--diff-code-delete-edit-text-color": "inherit",
        "--diff-code-selected-background-color": "rgba(255, 220, 120, 0.18)",
        "--diff-code-selected-text-color": "inherit",
        bgcolor: (muiTheme) => alpha(muiTheme.palette.background.paper, muiTheme.palette.mode === "dark" ? 0.3 : 0.82),
        "& .diff-view": {
          minWidth: 640
        },
        "& .hljs-comment, & .hljs-quote": {
          color: (theme) => alpha(theme.palette.text.secondary, theme.palette.mode === "dark" ? 0.88 : 0.92),
          fontStyle: "italic"
        },
        "& .hljs-keyword, & .hljs-selector-tag, & .hljs-literal, & .hljs-template-tag": {
          color: (theme) => (theme.palette.mode === "dark" ? "#C586C0" : "#0000FF")
        },
        "& .hljs-title, & .hljs-section, & .hljs-name": {
          color: (theme) => (theme.palette.mode === "dark" ? "#4EC9B0" : "#267f99")
        },
        "& .hljs-string, & .hljs-attr, & .hljs-symbol, & .hljs-bullet": {
          color: (theme) => (theme.palette.mode === "dark" ? "#CE9178" : "#A31515")
        },
        "& .hljs-number, & .hljs-regexp, & .hljs-link": {
          color: (theme) => (theme.palette.mode === "dark" ? "#B5CEA8" : "#098658")
        },
        "& .hljs-variable, & .hljs-template-variable, & .hljs-params, & .hljs-meta": {
          color: (theme) => (theme.palette.mode === "dark" ? "#9CDCFE" : "#001080")
        },
        "& .hljs-built_in, & .hljs-builtin-name, & .hljs-class": {
          color: (theme) => (theme.palette.mode === "dark" ? "#4FC1FF" : "#267f99")
        },
        "& .hljs-addition": {
          color: (theme) => theme.palette.success.main
        },
        "& .hljs-deletion": {
          color: (theme) => theme.palette.error.main
        }
      }}
    >
      <DiffView
        diffFile={diffFile}
        diffViewMode={DiffModeEnum.Unified}
        diffViewTheme={theme.palette.mode === "dark" ? "dark" : "light"}
        diffViewHighlight
        diffViewAddWidget={false}
        diffViewWrap={false}
        diffViewFontSize={12}
      />
    </Box>
  );
});

export const UnifiedDiffBlock = memo(function UnifiedDiffBlock({ text }: { text: string }) {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const numberedLines = useMemo(() => annotateUnifiedDiffLines(lines), [lines]);
  const renderPlainText = lines.length > MAX_STYLED_DIFF_LINES || text.length > MAX_STYLED_DIFF_CHARS;
  return (
    <Box
      data-testid="file-unified-diff"
      component="pre"
      sx={{
        m: 0,
        p: 1,
        maxHeight: "min(54vh, 620px)",
        overflow: "auto",
        whiteSpace: "pre",
        overflowWrap: "normal",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
        lineHeight: 1.5,
        color: "text.primary",
        bgcolor: (theme) => alpha(theme.palette.common.black, theme.palette.mode === "dark" ? 0.2 : 0.035),
        "& .diff-add": {
          display: "block",
          color: (theme) => (theme.palette.mode === "dark" ? "#7EE787" : "#116329"),
          bgcolor: "rgba(46, 160, 67, 0.10)"
        },
        "& .diff-del": {
          display: "block",
          color: (theme) => (theme.palette.mode === "dark" ? "#FFA198" : "#82071E"),
          bgcolor: "rgba(248, 81, 73, 0.10)"
        },
        "& .diff-meta": {
          display: "block",
          color: (theme) => (theme.palette.mode === "dark" ? "#79C0FF" : "#0969DA")
        },
        "& .diff-context": {
          display: "block"
        }
      }}
    >
      {renderPlainText ? text : numberedLines.map((entry, index) => (
        <span key={`${index}:${entry.text.slice(0, 24)}`} className={diffLineClassName(entry.text)}>
          <span
            data-testid="diff-line-number"
            aria-hidden="true"
            style={{ display: "inline-block", width: "7.5em", marginRight: "0.75em", color: "rgba(127, 127, 127, 0.82)", userSelect: "none", textAlign: "right" }}
          >
            {formatDiffLineNumbers(entry.oldLine, entry.newLine)}
          </span>
          {entry.text || " "}
          {index < numberedLines.length - 1 ? "\n" : ""}
        </span>
      ))}
    </Box>
  );
});

const MAX_STYLED_DIFF_LINES = 1_200;
const MAX_STYLED_DIFF_CHARS = 96_000;

function isLargeDiffInput(beforeText: string, afterText: string): boolean {
  const totalChars = beforeText.length + afterText.length;
  if (totalChars > MAX_STYLED_DIFF_CHARS) {
    return true;
  }
  return countLinesUntil(beforeText, MAX_STYLED_DIFF_LINES + 1) + countLinesUntil(afterText, MAX_STYLED_DIFF_LINES + 1) > MAX_STYLED_DIFF_LINES;
}

function countLinesUntil(text: string, limit: number): number {
  let lines = 1;
  for (let index = 0; index < text.length && lines < limit; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += 1;
    }
  }
  return lines;
}

export function diffTextStats(beforeText: string, afterText: string, filePath?: string): { additions: number; deletions: number } | undefined {
  try {
    const lang = guessLangFromPath(filePath);
    const diff = generateDiffFile(filePath ?? "old", beforeText, filePath ?? "new", afterText, lang, lang);
    diff.initRaw();
    return { additions: diff.additionLength, deletions: diff.deletionLength };
  } catch {
    return undefined;
  }
}

export function diffLineStats(text: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
    } else if (line.startsWith("-")) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}

export function fileChangeStatsLabel(additions: number, deletions: number): string {
  if (additions === 0 && deletions === 0) {
    return "";
  }
  return `(+${additions} -${deletions})`;
}

function fallbackUnifiedDiff(beforeText: string, afterText: string): string {
  const beforeLines = beforeText.split(/\r?\n/).filter((line) => line.length > 0).map((line) => `-${line}`);
  const afterLines = afterText.split(/\r?\n/).filter((line) => line.length > 0).map((line) => `+${line}`);
  return [...beforeLines, ...afterLines].join("\n");
}

type AnnotatedDiffLine = { text: string; oldLine?: number; newLine?: number };

function annotateUnifiedDiffLines(lines: string[]): AnnotatedDiffLine[] {
  let oldLine = 1;
  let newLine = 1;
  return lines.map((text) => {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      return { text };
    }
    if (text.startsWith("diff ") || text.startsWith("index ") || text.startsWith("---") || text.startsWith("+++")) {
      return { text };
    }
    if (text.startsWith("+") && !text.startsWith("+++")) {
      const entry = { text, newLine };
      newLine += 1;
      return entry;
    }
    if (text.startsWith("-") && !text.startsWith("---")) {
      const entry = { text, oldLine };
      oldLine += 1;
      return entry;
    }
    const entry = { text, oldLine, newLine };
    oldLine += 1;
    newLine += 1;
    return entry;
  });
}

function formatDiffLineNumbers(oldLine?: number, newLine?: number): string {
  return `${oldLine == null ? "  " : String(oldLine).padStart(4, " ")} ${newLine == null ? "  " : String(newLine).padStart(4, " ")}`;
}

function diffLineClassName(line: string): "diff-add" | "diff-del" | "diff-meta" | "diff-context" {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) {
    return "diff-meta";
  }
  if (line.startsWith("+")) {
    return "diff-add";
  }
  if (line.startsWith("-")) {
    return "diff-del";
  }
  return "diff-context";
}

function guessLangFromPath(filePath?: string): string {
  if (!filePath) return "txt";
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    scss: "scss",
    html: "html",
    vue: "vue",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    zsh: "bash",
    bash: "bash",
    dockerfile: "dockerfile",
    lua: "lua",
    php: "php",
    dart: "dart"
  };
  return (ext && map[ext]) || "txt";
}
