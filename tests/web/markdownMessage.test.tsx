import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "../../apps/web/src/components/MarkdownMessage";

test("renders strong markdown nested inside list items", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text="* **本地私有化（Local-First）**：数据保留在本地。" />
  );
  expect(html).toMatch(/<strong[^>]*>(?:<span[^>]*>)?本地私有化（Local-First）/);
  expect(html).not.toContain("**本地私有化");
});

test("renders GFM tables instead of exposing markdown source", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={"| 项目 | 状态 |\n| --- | --- |\n| 隐私 | **本地** |"} />
  );
  expect(html).toContain("<table");
  expect(html).toMatch(/<strong[^>]*>(?:<span[^>]*>)?本地/);
  expect(html).not.toContain("| --- | --- |");
});

test("renders the complete privacy policy with Local-First emphasized", () => {
  const html = renderToStaticMarkup(<MarkdownMessage text={readFileSync("PRIVACY.md", "utf8")} />);
  expect(html).toMatch(/<strong[^>]*>(?:<span[^>]*>)?本地私有化（Local-First）/);
  expect(html).not.toContain("**本地私有化（Local-First）**");
});

test("only mounts a preview of long code while the block is collapsed", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined, removeItem: () => undefined, clear: () => undefined }
  });
  const code = Array.from({ length: 100 }, (_, index) => `const line_${String(index).padStart(3, "0")} = ${index};`).join("\n");
  const html = renderToStaticMarkup(<MarkdownMessage text={`\`\`\`ts\n${code}\n\`\`\``} />);
  expect(html).toContain('data-code-line-count="100"');
  expect(html).toContain('data-code-expanded="false"');
  expect(html).toContain("line_027");
  expect(html).not.toContain("line_028");
  expect(html).not.toContain("line_099");
});

test("task list bullets render a checkbox without leaking literal brackets", () => {
  const html = renderToStaticMarkup(
    <MarkdownMessage text={"- [ ] first _(in progress)_\n- [x] done"} />
  );
  expect(html).toContain('type="checkbox"');
  expect(html).not.toContain("[ ]");
  expect(html).not.toContain("[x]");
  expect(html).toContain("first");
});

test("large streaming-size text renders fully on first commit (throttle is trailing-edge)", () => {
  const big = `# 标题\n\n${"段落内容填充 ".repeat(400)}\n\n尾部标记TOKEN`;
  expect(big.length).toBeGreaterThan(2000);
  const html = renderToStaticMarkup(<MarkdownMessage text={big} />);
  expect(html).toContain("尾部标记TOKEN");
  expect(html).toContain("<h1");
  expect(html).not.toContain("# 标题");
});
