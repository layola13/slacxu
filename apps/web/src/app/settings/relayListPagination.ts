export const RELAY_SETTINGS_PAGE_SIZE = 25;

export type RelayListPage<T> = {
  items: T[];
  page: number;
  pageCount: number;
  start: number;
  end: number;
};

export function paginateRelayList<T>(
  items: T[],
  requestedPage: number,
  pageSize = RELAY_SETTINGS_PAGE_SIZE,
): RelayListPage<T> {
  const safePageSize = Math.max(1, Math.floor(pageSize));
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const page = Math.min(Math.max(0, Math.floor(requestedPage)), pageCount - 1);
  const offset = page * safePageSize;
  const pageItems = items.slice(offset, offset + safePageSize);
  return {
    items: pageItems,
    page,
    pageCount,
    start: pageItems.length === 0 ? 0 : offset + 1,
    end: offset + pageItems.length,
  };
}
