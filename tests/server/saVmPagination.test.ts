import { describe, expect, test } from "bun:test";
import { paginateItems, resolvePagination } from "../../apps/server/src/saVmTool.js";

describe("saVm pagination contract", () => {
  test("resolvePagination: legacy input without page params is not paginated", () => {
    const pg = resolvePagination({}, { defaultSize: 50, maxSize: 500, legacyLimit: 50 });
    expect(pg.paginated).toBe(false);
    expect(pg.page).toBe(1);
    expect(pg.page_size).toBe(50);
    expect(pg.offset).toBe(0);
  });

  test("resolvePagination: page/page_size aliases resolve", () => {
    const a = resolvePagination({ page: 3, page_size: 10 } as any, { defaultSize: 50, maxSize: 500 });
    expect(a.paginated).toBe(true);
    expect(a.page).toBe(3);
    expect(a.page_size).toBe(10);
    expect(a.offset).toBe(20);
    const b = resolvePagination({ p: 2, perPage: 7 } as any, { defaultSize: 50, maxSize: 500 });
    expect(b.page).toBe(2);
    expect(b.page_size).toBe(7);
    expect(b.offset).toBe(7);
    const c = resolvePagination({ offset: 15, page_size: 10 } as any, { defaultSize: 50, maxSize: 500 });
    expect(c.paginated).toBe(true);
    expect(c.offset).toBe(15);
  });

  test("resolvePagination: page_size falls back to legacy limit", () => {
    const pg = resolvePagination({ page: 2 } as any, { defaultSize: 50, maxSize: 500, legacyLimit: 20 });
    expect(pg.page_size).toBe(20);
    expect(pg.offset).toBe(20);
  });

  test("paginateItems: total_pages = ceil(total/page_size)", () => {
    const items = Array.from({ length: 95 }, (_, i) => i);
    const pg = resolvePagination({ page: 1, page_size: 10 } as any, { defaultSize: 10, maxSize: 500 });
    const s1 = paginateItems(items, pg);
    expect(s1.total).toBe(95);
    expect(s1.total_pages).toBe(10);
    expect(s1.returned).toBe(10);
    expect(s1.has_next).toBe(true);
    expect(s1.has_prev).toBe(false);
    const pg2 = resolvePagination({ page: 10, page_size: 10 } as any, { defaultSize: 10, maxSize: 500 });
    const s2 = paginateItems(items, pg2);
    expect(s2.returned).toBe(5);
    expect(s2.has_next).toBe(false);
    expect(s2.has_prev).toBe(true);
    const pg3 = resolvePagination({ page: 11, page_size: 10 } as any, { defaultSize: 10, maxSize: 500 });
    const s3 = paginateItems(items, pg3);
    expect(s3.returned).toBe(0);
    expect(s3.total_pages).toBe(10);
  });

  test("paginateItems: empty list yields zero pages", () => {
    const pg = resolvePagination({ page: 1, page_size: 10 } as any, { defaultSize: 10, maxSize: 500 });
    const s = paginateItems([], pg);
    expect(s.total).toBe(0);
    expect(s.total_pages).toBe(0);
    expect(s.returned).toBe(0);
  });
});
