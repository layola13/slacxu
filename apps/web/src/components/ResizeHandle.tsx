import { Box } from "@mui/material";
import { Separator as PanelResizeHandle } from "react-resizable-panels";

type Props = {
  orientation?: "horizontal" | "vertical";
};

/** VS Code-like resize grip used by every workbench split. */
export function ResizeHandle({ orientation = "horizontal" }: Props) {
  const vertical = orientation === "vertical";
  return (
    <PanelResizeHandle>
      <Box
        sx={{
          width: vertical ? "100%" : 8,
          height: vertical ? 8 : "100%",
          cursor: vertical ? "row-resize" : "col-resize",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "background.default",
          flexShrink: 0,
          "&::before": {
            content: '""',
            width: vertical ? 28 : 1,
            height: vertical ? 1 : 28,
            bgcolor: "divider",
            borderRadius: 999
          },
          "&:hover": {
            bgcolor: "action.hover"
          },
          "&:hover::before": {
            width: vertical ? 36 : 2,
            height: vertical ? 2 : 36,
            bgcolor: "primary.main"
          },
          "&[data-separator][data-resize-handle-active], &:active": {
            bgcolor: "action.selected"
          }
        }}
      />
    </PanelResizeHandle>
  );
}
