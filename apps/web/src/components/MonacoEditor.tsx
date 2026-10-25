import Editor, { loader, type EditorProps } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

loader.config({ monaco });

export function MonacoEditor(props: EditorProps) {
  return <Editor {...props} />;
}
