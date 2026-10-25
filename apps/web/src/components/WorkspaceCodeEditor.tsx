import { Box, Typography } from "@mui/material";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

export function WorkspaceCodeEditor({
  path,
  content,
  onChange
}: {
  path: string;
  content: string;
  onChange: (content: string) => void;
}) {
  // 二进制内容无法按文本展示：给出明确提示而非空白编辑器。
  if (content.includes("\0")) {
    return (
      <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
        <Typography color="text.secondary">Binary file preview is not supported: {path}</Typography>
      </Box>
    );
  }
  return (
    <Box sx={{ height: "100%", minHeight: 0, overflow: "hidden", position: "relative" }}>
      <Editor
        height="100%"
        path={path}
        language={languageForPath(path)}
        value={content}
        loading="Loading editor..."
        options={{
          ariaLabel: "Explorer editor content",
          lineNumbers: "on",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 13,
          wordWrap: "on",
          automaticLayout: true,
          renderLineHighlight: "all"
        }}
        onChange={(value) => onChange(value ?? "")}
      />
    </Box>
  );
}

export function WorkspacePlainTextViewer({ path, content }: { path: string; content: string }) {
  const lines = content.split("\n");
  return (
    <Box
      data-testid="workspace-plain-text-viewer"
      aria-label={`Text preview ${path}`}
      sx={{ height: "100%", minHeight: 0, overflow: "auto", display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", bgcolor: "#101418", color: "#e7edf2" }}
    >
      <Box component="pre" aria-hidden sx={{ m: 0, p: 1, textAlign: "right", color: "#7d8590", userSelect: "none" }}>
        {lines.map((_, index) => `${index + 1}`).join("\n")}
      </Box>
      <Box component="pre" sx={{ m: 0, p: 1, fontSize: 12, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {content || "(empty file)"}
      </Box>
    </Box>
  );
}

function languageForPath(path: string): string {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  switch (extension) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
      return "javascript";
    case "json":
      return "json";
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "yml":
    case "yaml":
      return "yaml";
    case "sh":
      return "shell";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "java":
      return "java";
    case "xml":
      return "xml";
    default:
      return "plaintext";
  }
}
