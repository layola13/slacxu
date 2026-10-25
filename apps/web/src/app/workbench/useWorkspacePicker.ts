import { useState } from "react";
import { DEFAULT_LOCAL_WORKSPACE_PICKER_PATH } from "./appConstants";

export function useWorkspacePicker() {
  const [workspacePickerPurpose, setWorkspacePickerPurpose] = useState<"primary" | "additional">("primary");
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [workspacePickerPath, setWorkspacePickerPath] = useState(DEFAULT_LOCAL_WORKSPACE_PICKER_PATH);
  return {
    workspacePickerPurpose,
    setWorkspacePickerPurpose,
    workspacePickerOpen,
    setWorkspacePickerOpen,
    workspacePickerPath,
    setWorkspacePickerPath,
  };
}
