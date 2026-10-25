import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Box, Button, IconButton, Link, Stack, Tooltip, Typography, alpha, useTheme } from "@mui/material";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import UnfoldLessIcon from "@mui/icons-material/UnfoldLess";
import UnfoldMoreIcon from "@mui/icons-material/UnfoldMore";
import WrapTextIcon from "@mui/icons-material/WrapText";
import { marked } from "marked";
import type { Token } from "marked";
import { useI18n } from "../i18n";

type Props = {
  text: string;
};

/** Trailing-edge throttle for streaming text: large growing buffers commit at
 * most every STREAMING_TEXT_COMMIT_MS instead of re-running the full
 * marked.lexer + code highlight pass on every delta. Small buffers and
 * shrinking text (edits/resets) commit immediately so static output is
 * unchanged. */
export const STREAMING_TEXT_COMMIT_MS = 150;
export const STREAMING_TEXT_IMMEDIATE_CHARS = 2000;

export function useThrottledStreamingText(text: string, delayMs = STREAMING_TEXT_COMMIT_MS): string {
  const [committed, setCommitted] = useState(text);
  const committedRef = useRef(text);
  const latestRef = useRef(text);
  const timerRef = useRef<number | null>(null);
  latestRef.current = text;
  useEffect(() => {
    if (text === committedRef.current) return;
    if (text.length < committedRef.current.length || text.length < STREAMING_TEXT_IMMEDIATE_CHARS) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      committedRef.current = text;
      setCommitted(text);
      return;
    }
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const latest = latestRef.current;
      if (latest !== committedRef.current) {
        committedRef.current = latest;
        setCommitted(latest);
      }
    }, delayMs);
  }, [text, delayMs]);
  useEffect(() => () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);
  return committed;
}

export const MarkdownMessage = memo(function MarkdownMessage({ text }: Props) {
  const theme = useTheme();
  const visibleText = useThrottledStreamingText(text);
  const tokens = useMemo(() => marked.lexer(visibleText, { gfm: true, breaks: true }), [visibleText]);

  return (
    <Box
      sx={{
        mt: 0.65,
        fontSize: "var(--chat-font-size, 13px)",
        lineHeight: "var(--chat-line-height, 1.52)",
        overflowWrap: "anywhere",
        "& > :first-of-type": { mt: 0 },
        "& > :last-child": { mb: 0 }
      }}
    >
      {tokens.map((token, index) => renderBlock(token, index, theme.palette.mode))}
    </Box>
  );
});

function renderBlock(token: Token, index: number, mode: "light" | "dark"): ReactNode {
  const raw = token as Record<string, unknown>;
  switch (token.type) {
    case "space":
      return null;
    case "heading":
      return (
        <Typography
          key={index}
          component={`h${Math.min(6, Math.max(1, Number(raw.depth) || 2))}` as "h1"}
          sx={{ mt: 1.15, mb: 0.5, fontSize: headingFontSize(Number(raw.depth)), lineHeight: 1.25, fontWeight: 850 }}
        >
          {renderInline(asTokenArray(raw.tokens), mode)}
        </Typography>
      );
    case "paragraph":
      return (
        <Typography key={index} component="p" sx={{ my: 0.45, fontSize: "inherit", lineHeight: "inherit" }}>
          {renderInline(asTokenArray(raw.tokens), mode)}
        </Typography>
      );
    case "text":
      return (
        <Typography key={index} component="p" sx={{ my: 0.45, fontSize: "inherit", lineHeight: "inherit" }}>
          {asTokenArray(raw.tokens).length > 0
            ? renderInline(asTokenArray(raw.tokens), mode)
            : String(raw.text ?? "")}
        </Typography>
      );
    case "code":
      return <CodeBlock key={index} code={String(raw.text ?? "")} language={typeof raw.lang === "string" ? raw.lang : ""} mode={mode} />;
    case "blockquote":
      return (
        <Box
          key={index}
          sx={{
            my: 1,
            pl: 1.5,
            borderLeft: "3px solid",
            borderColor: "primary.main",
            color: "text.secondary"
          }}
        >
          {asTokenArray(raw.tokens).map((child, childIndex) => renderBlock(child, childIndex, mode))}
        </Box>
      );
    case "list": {
      const ordered = Boolean(raw.ordered);
      return (
        <Box key={index} component={ordered ? "ol" : "ul"} sx={{ my: 0.75, pl: 2.75 }}>
          {asTokenArray(raw.items).map((item, itemIndex) => (
            <Box key={itemIndex} component="li" sx={{ my: 0.25 }}>
              <Stack direction="row" spacing={0.6} alignItems="flex-start">
                {Boolean((item as Record<string, unknown>).task) ? (
                  <Box
                    component="input"
                    type="checkbox"
                    checked={Boolean((item as Record<string, unknown>).checked)}
                    readOnly
                    sx={{ mt: "5px", pointerEvents: "none" }}
                  />
                ) : null}
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  {renderListItemTokens(asTokenArray((item as Record<string, unknown>).tokens), mode)}
                </Box>
              </Stack>
            </Box>
          ))}
        </Box>
      );
    }
    case "table": {
      const header = Array.isArray(raw.header) ? raw.header : [];
      const rows = Array.isArray(raw.rows) ? raw.rows : [];
      return (
        <Box key={index} sx={{ my: 1, maxWidth: "100%", overflowX: "auto", border: "1px solid", borderColor: "divider", borderRadius: 1 }}>
          <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5 }}>
            <Box component="thead" sx={{ bgcolor: "action.hover" }}>
              <Box component="tr">
                {header.map((cell, cellIndex) => (
                  <Box component="th" key={cellIndex} sx={tableCellSx(true)}>
                    {renderInline(asTokenArray((cell as Record<string, unknown>).tokens), mode)}
                  </Box>
                ))}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.map((row, rowIndex) => (
                <Box component="tr" key={rowIndex}>
                  {(Array.isArray(row) ? row : []).map((cell, cellIndex) => (
                    <Box component="td" key={cellIndex} sx={tableCellSx(false)}>
                      {renderInline(asTokenArray((cell as Record<string, unknown>).tokens), mode)}
                    </Box>
                  ))}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      );
    }
    case "hr":
      return <Box key={index} sx={{ my: 1.5, borderTop: "1px solid", borderColor: "divider" }} />;
    default:
      return raw.raw ? (
        <Typography key={index} component="p" sx={{ my: 0.45, fontSize: "inherit", lineHeight: "inherit" }}>
          {String(raw.raw)}
        </Typography>
      ) : null;
  }
}

function renderInline(tokens: Token[], mode: "light" | "dark"): ReactNode[] {
  return tokens.flatMap((token, index) => {
    const raw = token as Record<string, unknown>;
    switch (token.type) {
      case "text":
        return asTokenArray(raw.tokens).length > 0
          ? <span key={index}>{renderInline(asTokenArray(raw.tokens), mode)}</span>
          : linkifyPlainText(String(raw.text ?? ""), `text-${index}`);
      case "strong":
        return <strong key={index}>{renderInline(asTokenArray(raw.tokens), mode)}</strong>;
      case "em":
        return <em key={index}>{renderInline(asTokenArray(raw.tokens), mode)}</em>;
      case "codespan":
        return (
          <Box
            key={index}
            component="code"
            sx={{
              px: 0.5,
              py: 0.125,
              borderRadius: 0.75,
              bgcolor: mode === "dark" ? "rgba(97, 243, 243, 0.12)" : "rgba(24, 119, 242, 0.08)",
              color: mode === "dark" ? "#CAFDF5" : "#0C44AE",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: "0.9em"
            }}
          >
            {String(raw.text ?? "")}
          </Box>
        );
      case "link":
        return (
          <CtrlClickLink key={index} href={String(raw.href ?? "#")}>
            {renderInline(asTokenArray(raw.tokens), mode)}
          </CtrlClickLink>
        );
      case "image": {
        const source = normalizeImageSource(String(raw.href ?? ""));
        const alt = String(raw.text ?? "");
        return source ? (
          <Box
            key={index}
            component="img"
            src={source}
            alt={alt}
            loading="lazy"
            sx={{ display: "block", maxWidth: "100%", maxHeight: 520, my: 1, borderRadius: 1, objectFit: "contain" }}
          />
        ) : <span key={index}>{alt}</span>;
      }
      case "br":
        return <br key={index} />;
      case "checkbox":
        // GFM task bullets ("- [ ]" / "- [x]") already get a native checkbox
        // from the list-item renderer above; the inline token would otherwise
        // leak a literal "[ ]" / "[x]" into the text (mini plan checklists).
        return null;
      case "del":
        return <del key={index}>{renderInline(asTokenArray(raw.tokens), mode)}</del>;
      default:
        return <span key={index}>{String(raw.text ?? raw.raw ?? "")}</span>;
    }
  });
}

function renderListItemTokens(tokens: Token[], mode: "light" | "dark"): ReactNode[] {
  return tokens.flatMap((token, index) => {
    const raw = token as Record<string, unknown>;
    if (token.type === "checkbox") {
      // Swallow the duplicate marker: the list renderer already drew the box.
      return [];
    }
    if (token.type === "text") {
      return (
        <Typography key={index} component="span" sx={{ fontSize: "inherit", lineHeight: "inherit" }}>
          {asTokenArray(raw.tokens).length > 0
            ? renderInline(asTokenArray(raw.tokens), mode)
            : String(raw.text ?? "")}
        </Typography>
      );
    }
    return renderBlock(token, index, mode);
  });
}

function headingFontSize(depth: number): number {
  if (depth <= 1) return 22;
  if (depth === 2) return 19;
  if (depth === 3) return 17;
  return 15;
}

function tableCellSx(header: boolean) {
  return {
    px: 1.25,
    py: 0.8,
    textAlign: "left",
    verticalAlign: "top",
    fontWeight: header ? 800 : 400,
    borderRight: "1px solid",
    borderBottom: "1px solid",
    borderColor: "divider",
    "&:last-child": { borderRight: 0 }
  } as const;
}

function normalizeImageSource(value: string): string | null {
  const trimmed = value.trim();
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return trimmed;
  return null;
}

function linkifyPlainText(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const urlPattern = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = urlPattern.exec(text)) !== null) {
    const rawUrl = trimUrlTail(match[0]);
    const start = match.index;
    const end = start + rawUrl.length;
    if (start > lastIndex) {
      parts.push(<span key={`${keyPrefix}-text-${index++}`}>{text.slice(lastIndex, start)}</span>);
    }
    parts.push(
      <CtrlClickLink key={`${keyPrefix}-url-${index++}`} href={rawUrl}>
        {rawUrl}
      </CtrlClickLink>
    );
    lastIndex = end;
    urlPattern.lastIndex = end;
  }
  if (lastIndex < text.length) {
    parts.push(<span key={`${keyPrefix}-text-${index++}`}>{text.slice(lastIndex)}</span>);
  }
  return parts.length ? parts : [<span key={`${keyPrefix}-text`}>{text}</span>];
}

function CtrlClickLink({ href, children }: { href: string; children: ReactNode }) {
  const normalizedHref = normalizeUrlForOpen(href);
  const title = isLocalHttpUrl(normalizedHref) ? "Ctrl+click to open local link" : "Ctrl+click to open external link";
  return (
    <Link
      href={normalizedHref}
      title={title}
      underline="hover"
      onClick={(event) => {
        event.preventDefault();
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }
        if (!isLocalHttpUrl(normalizedHref) && !window.confirm(`Open external link?\n\n${normalizedHref}`)) {
          return;
        }
        window.open(normalizedHref, "_blank", "noopener,noreferrer");
      }}
      sx={{ cursor: "pointer" }}
    >
      {children}
    </Link>
  );
}

function trimUrlTail(value: string): string {
  return value.replace(/[.,;:!?]+$/g, "");
}

function normalizeUrlForOpen(value: string): string {
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "#";
}

function isLocalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && ["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function CodeBlock({ code, language, mode }: { code: string; language: string; mode: "light" | "dark" }) {
  const theme = useTheme();
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const dark = mode === "dark";
  const normalizedLanguage = normalizeCodeLanguage(language, code);
  const lines = useMemo(() => code.replace(/\n$/, "").split("\n"), [code]);
  const collapsible = lines.length > 18 || code.length > 1800;
  const showExpanded = expanded || !collapsible;
  const renderPlainCode = showExpanded && (lines.length > MAX_HIGHLIGHT_CODE_LINES || code.length > MAX_HIGHLIGHT_CODE_CHARS);
  const visibleLines = useMemo(
    () => renderPlainCode ? [] : showExpanded ? lines : lines.slice(0, COLLAPSED_CODE_PREVIEW_LINES),
    [lines, renderPlainCode, showExpanded]
  );
  const highlightedLines = useMemo(
    () => highlightCodeLines(visibleLines, normalizedLanguage, dark, code.length),
    [code.length, dark, normalizedLanguage, visibleLines]
  );

  async function copyCode() {
    await navigator.clipboard.writeText(code.trimEnd());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  function downloadCode() {
    const extension = extensionForLanguage(normalizedLanguage);
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `codex-code${extension}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Box
      className="code-block"
      data-code-line-count={lines.length}
      data-code-expanded={showExpanded ? "true" : "false"}
      data-code-render-mode={renderPlainCode ? "plain" : "highlighted"}
      sx={{
        position: "relative",
        my: 1.25,
        minWidth: 0,
        width: "100%",
        maxWidth: "100%",
        boxSizing: "border-box",
        border: "1px solid",
        borderColor: dark ? alpha("#FFFFFF", 0.14) : alpha("#0F172A", 0.12),
        borderRadius: 1,
        overflow: "hidden",
        bgcolor: dark ? "#070A0E" : "#F8FAFC",
        "&:hover .code-toolbar": { opacity: 1 }
      }}
    >
      <Box
        sx={{
          px: 1.1,
          minHeight: 32,
          display: "flex",
          alignItems: "center",
          gap: 1,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: dark ? alpha("#FFFFFF", 0.06) : alpha("#0F172A", 0.045)
        }}
      >
        <Typography
          component="span"
          sx={{
            flex: 1,
            minWidth: 0,
            color: "text.secondary",
            fontSize: 12,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: 0,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {normalizedLanguage || "text"}
        </Typography>
        <Stack
          className="code-toolbar"
          direction="row"
          spacing={0.25}
          sx={{
            opacity: { xs: 1, md: 0 },
            transition: "opacity 160ms ease",
            "& .MuiIconButton-root": {
              width: 26,
              height: 26,
              borderRadius: 1
            }
          }}
        >
          <Tooltip title={copied ? t("codeBlock.copied") : t("codeBlock.copy")}>
            <IconButton size="small" aria-label={t("codeBlock.copy")} onClick={() => void copyCode()}>
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t("codeBlock.download")}>
            <IconButton size="small" aria-label={t("codeBlock.download")} onClick={downloadCode}>
              <DownloadIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={wrapped ? t("codeBlock.wrapOff") : t("codeBlock.wrapOn")}>
            <IconButton size="small" aria-label={wrapped ? t("codeBlock.wrapOff") : t("codeBlock.wrapOn")} color={wrapped ? "primary" : "default"} onClick={() => setWrapped((current) => !current)}>
              <WrapTextIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          {collapsible && (
            <Tooltip title={expanded ? t("codeBlock.collapse") : t("codeBlock.expandCode")}>
              <IconButton size="small" aria-label={expanded ? t("codeBlock.collapse") : t("codeBlock.expandCode")} onClick={() => setExpanded((current) => !current)}>
                {expanded ? <UnfoldLessIcon sx={{ fontSize: 16 }} /> : <UnfoldMoreIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            </Tooltip>
          )}
        </Stack>
      </Box>
      <Box
        component="pre"
        sx={{
          position: "relative",
          m: 0,
          p: 0,
          maxHeight: showExpanded ? "min(70vh, 760px)" : 360,
          overflowX: "auto",
          overflowY: "auto",
          color: theme.palette.text.primary,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12.5,
          lineHeight: 1.65,
          whiteSpace: wrapped ? "pre-wrap" : "pre",
          tabSize: 2
        }}
      >
        <code>
          {renderPlainCode ? code.trimEnd() : highlightedLines.map((line, index) => (
            <Box
              key={index}
              component="span"
              sx={{
                display: "grid",
                gridTemplateColumns: "44px minmax(0, 1fr)",
                minHeight: 20.5,
                bgcolor: line.background
              }}
            >
              <Box
                component="span"
                sx={{
                  userSelect: "none",
                  textAlign: "right",
                  pr: 1,
                  color: "text.disabled",
                  borderRight: "1px solid",
                  borderColor: "divider",
                  bgcolor: dark ? alpha("#FFFFFF", 0.03) : alpha("#0F172A", 0.035)
                }}
              >
                {index + 1}
              </Box>
              <Box component="span" sx={{ minWidth: 0, px: 1.25, overflowWrap: wrapped ? "anywhere" : "normal" }}>
                {line.nodes.length > 0 ? line.nodes : " "}
              </Box>
            </Box>
          ))}
        </code>
      </Box>
      {collapsible && !expanded && (
        <Box
          sx={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 54,
            display: "grid",
            placeItems: "end center",
            pb: 0.75,
            background: (theme) =>
              `linear-gradient(180deg, ${alpha(theme.palette.background.paper, 0)} 0%, ${dark ? "#070A0E" : "#F8FAFC"} 78%)`,
            pointerEvents: "none"
          }}
        >
          <Button size="small" variant="contained" onClick={() => setExpanded(true)} sx={{ pointerEvents: "auto", minHeight: 28 }}>
            {t("codeBlock.expand")}
          </Button>
        </Box>
      )}
    </Box>
  );
}

const COLLAPSED_CODE_PREVIEW_LINES = 28;
const MAX_HIGHLIGHT_CODE_LINES = 600;
const MAX_HIGHLIGHT_CODE_CHARS = 48_000;

type HighlightedLine = {
  nodes: ReactNode[];
  background?: string;
};

function highlightCodeLines(lines: string[], language: string, dark: boolean, totalCodeLength: number): HighlightedLine[] {
  const lower = language.toLowerCase();
  if (lower === "diff" || lower.includes("patch")) {
    return lines.map((line) => {
      const color = line.startsWith("+")
        ? dark
          ? "#77ED8B"
          : "#118D57"
        : line.startsWith("-")
          ? dark
            ? "#FFAC82"
            : "#B71D18"
          : line.startsWith("@@")
            ? dark
              ? "#61F3F3"
              : "#0C44AE"
            : undefined;
      return {
        nodes: color ? [<span key="diff" style={{ color }}>{line}</span>] : [line],
        background: line.startsWith("+")
          ? dark
            ? alpha("#22C55E", 0.1)
            : alpha("#22C55E", 0.08)
          : line.startsWith("-")
            ? dark
              ? alpha("#EF4444", 0.1)
              : alpha("#EF4444", 0.08)
            : undefined
      };
    });
  }
  if (lines.length > MAX_HIGHLIGHT_CODE_LINES || totalCodeLength > MAX_HIGHLIGHT_CODE_CHARS) {
    return lines.map((line) => ({ nodes: [line] }));
  }
  return lines.map((line) => ({ nodes: highlightCode(line, language, dark) }));
}

function highlightCodeBlock(code: string, language: string, dark: boolean): ReactNode[] {
  const lower = language.toLowerCase();
  if (lower === "diff" || lower.includes("patch")) {
    return code.split(/(\n)/).map((line, index) => {
      if (line === "\n") {
        return line;
      }
      const color = line.startsWith("+")
        ? dark
          ? "#77ED8B"
          : "#118D57"
        : line.startsWith("-")
          ? dark
            ? "#FFAC82"
            : "#B71D18"
          : line.startsWith("@@")
            ? dark
              ? "#61F3F3"
              : "#0C44AE"
            : undefined;
      return color ? (
        <span key={index} style={{ color }}>
          {line}
        </span>
      ) : (
        line
      );
    });
  }
  return highlightCode(code, language, dark);
}

function normalizeCodeLanguage(language: string, code: string): string {
  const normalized = language.trim().toLowerCase();
  if (normalized === "xml" && /^\s*(?:<\?xml[\s\S]*?\?>\s*)?<svg[\s>]/i.test(code)) {
    return "svg";
  }
  return normalized || "text";
}

function extensionForLanguage(language: string): string {
  switch (language) {
    case "typescript":
    case "ts":
      return ".ts";
    case "tsx":
      return ".tsx";
    case "javascript":
    case "js":
      return ".js";
    case "jsx":
      return ".jsx";
    case "python":
    case "py":
      return ".py";
    case "rust":
    case "rs":
      return ".rs";
    case "json":
      return ".json";
    case "html":
      return ".html";
    case "css":
      return ".css";
    case "shell":
    case "bash":
    case "sh":
      return ".sh";
    case "diff":
    case "patch":
      return ".patch";
    case "text":
      return ".txt";
    default:
      return `.${language || "txt"}`.replace(/[^.A-Za-z0-9_-]/g, "");
  }
}

function highlightCode(code: string, language: string, dark: boolean): ReactNode[] {
  const keywordColor = dark ? "#61F3F3" : "#0C44AE";
  const stringColor = dark ? "#FFD666" : "#B76E00";
  const commentColor = dark ? "#637381" : "#919EAB";
  const numberColor = dark ? "#77ED8B" : "#118D57";
  const operatorColor = dark ? "#C684FF" : "#8E33FF";
  const keywords = keywordSet(language);
  const pattern =
    /(\/\/.*|#.*|\/\*.*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b|[{}()[\].,:;=+\-*/<>!&|?]+)/g;
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code))) {
    if (match.index > last) {
      nodes.push(code.slice(last, match.index));
    }
    const value = match[0];
    let color: string | undefined;
    if (value.startsWith("//") || value.startsWith("#") || value.startsWith("/*")) {
      color = commentColor;
    } else if (value.startsWith("\"") || value.startsWith("'") || value.startsWith("`")) {
      color = stringColor;
    } else if (/^\d/.test(value)) {
      color = numberColor;
    } else if (keywords.has(value)) {
      color = keywordColor;
    } else if (/^[{}()[\].,:;=+\-*/<>!&|?]+$/.test(value)) {
      color = operatorColor;
    }
    nodes.push(color ? <span key={`${match.index}-${value}`} style={{ color }}>{value}</span> : value);
    last = pattern.lastIndex;
  }
  if (last < code.length) {
    nodes.push(code.slice(last));
  }
  return nodes;
}

function keywordSet(language: string): Set<string> {
  const common = ["async", "await", "break", "case", "catch", "const", "continue", "default", "else", "enum", "export", "false", "for", "from", "function", "if", "import", "in", "let", "null", "return", "switch", "throw", "true", "try", "type", "undefined", "while"];
  const rust = ["as", "crate", "dyn", "fn", "impl", "let", "match", "mod", "move", "mut", "pub", "ref", "self", "Self", "struct", "trait", "use", "where"];
  const zig = ["align", "allowzero", "anytype", "asm", "comptime", "const", "defer", "errdefer", "error", "fn", "inline", "noalias", "nosuspend", "opaque", "orelse", "packed", "pub", "resume", "struct", "suspend", "test", "threadlocal", "try", "union", "usingnamespace", "var", "volatile"];
  const shell = ["cd", "do", "done", "echo", "elif", "else", "esac", "fi", "for", "function", "if", "in", "then", "while"];
  const lower = language.toLowerCase();
  if (lower.includes("rust") || lower === "rs") {
    return new Set([...common, ...rust]);
  }
  if (lower.includes("zig")) {
    return new Set([...common, ...zig]);
  }
  if (lower.includes("bash") || lower.includes("shell") || lower === "sh" || lower === "zsh") {
    return new Set([...common, ...shell]);
  }
  return new Set([...common, ...rust, ...zig]);
}

function asTokenArray(value: unknown): Token[] {
  return Array.isArray(value) ? (value as Token[]) : [];
}
