import { expect, test } from "bun:test";
import { planChunks } from "../../scripts/app-split/plan";
import { assertAllUnderLimit } from "../../scripts/app-split/types";

// 合成小 App：import 头 + 小声明 + 一个 1500 行巨函数，验证合并与窗口逻辑。
function buildSynthetic(): string {
  const lines: string[] = [];
  lines.push(`import { useState } from "react";`);
  for (let i = 0; i < 10; i++) lines.push(`const C${i} = ${i};`);
  lines.push(`export function App() {`);
  for (let i = 0; i < 1500; i++) lines.push(`  const v${i} = ${i};`);
  lines.push(`}`);
  lines.push(`export function tailUtil() { return 1; }`);
  return lines.join("\n");
}

test("app-split plan covers all lines with zero >700 violations", () => {
  const content = buildSynthetic();
  const total = content.split("\n").length;
  const { plan } = planChunks("synthetic.tsx", content, 700);
  expect(plan.chunks.length).toBeGreaterThan(0);
  expect(plan.chunks[0]!.startLine).toBe(1);
  expect(plan.chunks[plan.chunks.length - 1]!.endLine).toBe(total);
  // 全覆盖连续无缝
  for (let i = 1; i < plan.chunks.length; i++) {
    expect(plan.chunks[i]!.startLine).toBe(plan.chunks[i - 1]!.endLine + 1);
  }
  expect(assertAllUnderLimit(plan)).toEqual([]);
});

test("app-split plan merges tiny decls instead of one-file-per-line", () => {
  const content = buildSynthetic();
  const { plan } = planChunks("synthetic.tsx", content, 700);
  // 头部 11 行小声明必须合并，不能 1 行 1 文件
  expect(plan.chunks.length).toBeLessThan(10);
});

test("app-split plan keeps the import header in place as raw", () => {
  const content = buildSynthetic();
  const { plan } = planChunks("synthetic.tsx", content, 700);
  const header = plan.chunks[0]!;
  expect(header.startLine).toBe(1);
  expect(header.keepInPlace).toBe(true);
  expect(header.mode).toBe("raw");
});

test("app-split giant windows end balanced at statement ends", () => {
  const lines = [`import { useState } from "react";`, `export function App() {`];
  for (let i = 0; i < 1500; i++) {
    lines.push(`  const v${i} = useMemo(() => {`);
    lines.push(`    return ${i};`);
    lines.push(`  }, []);`);
  }
  lines.push(`}`);
  const content = lines.join("\n");
  const { plan } = planChunks("giant.tsx", content, 700);
  const windows = plan.chunks.filter((c) => c.keepInPlace !== true && c.endLine < lines.length);
  expect(windows.length).toBeGreaterThan(0);
  for (const w of windows) {
    // 落点语句结束（硬门：不腰斩）
    const last = lines[w.endLine - 1]!.trim();
    expect(/;\s*$/.test(last) || last === "}" || last === "").toBe(true);
    // 切片相对深度最小（完整语句序列；首窗含函数签名故为 1，其余为 0）
    const slice = lines.slice(w.startLine - 1, w.endLine);
    let depth = 0;
    let minDepth = 0;
    for (const line of slice) {
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
      if (depth < minDepth) minDepth = depth;
    }
    expect(depth).toBeLessThanOrEqual(1);
    expect(minDepth).toBeGreaterThanOrEqual(0);
  }
});
