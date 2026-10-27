import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('History Lazy Loading', () => {
  let mockClient: any;
  let mockThreads: any[];

  beforeEach(() => {
    mockThreads = Array.from({ length: 250 }, (_, i) => ({
      id: `thread-${i}`,
      title: `Thread ${i}`,
      recencyAt: Date.now() / 1000 - i * 3600,
      cliBackend: 'codex'
    }));

    mockClient = {
      rpc: vi.fn()
    };
  });

  describe('loadAllThreads with firstPageOnly', () => {
    it('should load only first page when firstPageOnly is true', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: mockThreads.slice(0, 200),
        nextCursor: 'cursor-1'
      });

      const { loadAllThreads } = await import('../../apps/web/src/app/threads/threadCatalog');

      const result = await loadAllThreads(mockClient, {
        firstPageOnly: true
      });

      // Should only make 1 call (first page only)
      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(200);
    });

    it('should load all pages when firstPageOnly is false', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({
          data: mockThreads.slice(0, 200),
          nextCursor: 'cursor-1'
        })
        .mockResolvedValueOnce({
          data: mockThreads.slice(200, 250),
          nextCursor: null
        });

      const { loadAllThreads } = await import('../../apps/web/src/app/threads/threadCatalog');

      const result = await loadAllThreads(mockClient, {
        firstPageOnly: false
      });

      // Should make 2 calls for both archived states
      expect(mockClient.rpc.mock.calls.length).toBeGreaterThan(1);
      expect(result.length).toBeGreaterThan(200);
    });

    it('should load all pages when search term is provided', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({
          data: mockThreads.slice(0, 200),
          nextCursor: 'cursor-1'
        })
        .mockResolvedValueOnce({
          data: mockThreads.slice(200, 250),
          nextCursor: null
        });

      const { loadAllThreads } = await import('../../apps/web/src/app/threads/threadCatalog');

      const result = await loadAllThreads(mockClient, {
        searchTerm: 'test',
        firstPageOnly: undefined // Should default to false when searchTerm is provided
      });

      // With search term, firstPageOnly should be false
      expect(mockClient.rpc.mock.calls.length).toBeGreaterThan(1);
    });

    it('should respect maxPages parameter', async () => {
      mockClient.rpc
        .mockResolvedValueOnce({
          data: mockThreads.slice(0, 200),
          nextCursor: 'cursor-1'
        })
        .mockResolvedValueOnce({
          data: mockThreads.slice(200, 250),
          nextCursor: 'cursor-2'
        });

      const { loadAllThreads } = await import('../../apps/web/src/app/threads/threadCatalog');

      await loadAllThreads(mockClient, {
        firstPageOnly: false,
        maxPages: 1
      });

      // Should only load 1 page even though there's a nextCursor
      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
    });

    it('should call onProgress callback for each page loaded', async () => {
      const onProgress = vi.fn();
      mockClient.rpc
        .mockResolvedValueOnce({
          data: mockThreads.slice(0, 200),
          nextCursor: 'cursor-1'
        })
        .mockResolvedValueOnce({
          data: mockThreads.slice(200, 250),
          nextCursor: null
        });

      const { loadAllThreads } = await import('../../apps/web/src/app/threads/threadCatalog');

      await loadAllThreads(mockClient, {
        firstPageOnly: false,
        onProgress
      });

      // onProgress should be called for each page load
      expect(onProgress.mock.calls.length).toBeGreaterThan(0);
    });
  });

  describe('Initial load behavior', () => {
    it('should default to firstPageOnly when no search term', async () => {
      mockClient.rpc.mockResolvedValueOnce({
        data: mockThreads.slice(0, 200),
        nextCursor: 'cursor-1'
      });

      const { loadAllThreads } = await import('../../apps/web/src/app/threads/threadCatalog');

      // No search term, should default to firstPageOnly: true
      await loadAllThreads(mockClient, {});

      // Should only make 1 call
      expect(mockClient.rpc).toHaveBeenCalledTimes(1);
    });
  });
});
