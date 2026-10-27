import { expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeProvider, createTheme } from "@mui/material";
import { UnifiedDiffBlock } from "../../apps/web/src/waterfall/ChatDiffView";

const theme = createTheme();

test("UnifiedDiffBlock renders old/new line number gutters for unified hunks", () => {
  const html = renderToStaticMarkup(
    <ThemeProvider theme={theme}>
      <UnifiedDiffBlock text={"@@ -10,2 +10,3 @@\n context\n-old\n+new\n+added"} />
    </ThemeProvider>
  );
  expect((html.match(/data-testid=\"diff-line-number\"/g) ?? []).length).toBe(5);
  expect(html).toContain("  10   10");
  expect(html).toContain("  11   ");
  expect(html).toContain("     11");
  expect(html).toContain("     12");
});
