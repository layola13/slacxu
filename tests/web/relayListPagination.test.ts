import { expect, test } from "bun:test";
import { paginateRelayList, RELAY_SETTINGS_PAGE_SIZE } from "../../apps/web/src/app/settings/relayListPagination.ts";

test("relay settings exposes entries beyond the first page", () => {
  const providers = Array.from({ length: 43 }, (_, index) => `relay-${index + 1}`);

  const first = paginateRelayList(providers, 0);
  const second = paginateRelayList(providers, 1);

  expect(first.items).toHaveLength(RELAY_SETTINGS_PAGE_SIZE);
  expect(first.start).toBe(1);
  expect(first.end).toBe(RELAY_SETTINGS_PAGE_SIZE);
  expect(first.pageCount).toBe(2);
  expect(second.items).toEqual(providers.slice(RELAY_SETTINGS_PAGE_SIZE));
  expect(second.start).toBe(RELAY_SETTINGS_PAGE_SIZE + 1);
  expect(second.end).toBe(43);
});

test("relay settings clamps a stale page after filtering", () => {
  const page = paginateRelayList(["relay-1", "relay-2"], 9);

  expect(page.page).toBe(0);
  expect(page.items).toEqual(["relay-1", "relay-2"]);
  expect(page.start).toBe(1);
  expect(page.end).toBe(2);
});
