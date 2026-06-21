import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("fs-sync event routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes created events to tree refresh", async () => {
    const refreshPath = vi.fn().mockResolvedValue(undefined);
    const tree = {
      refreshPath,
      removeNode: vi.fn(),
      handleRename: vi.fn().mockResolvedValue(undefined),
    };
    const tabStore = {
      findByPath: vi.fn(),
      closeTabByPath: vi.fn(),
      renameTabPath: vi.fn(),
      reloadTabContent: vi.fn(),
    };
    const callbacks = {
      onStatus: vi.fn(),
      reloadEditor: vi.fn(),
      isActivePath: () => false,
      isPathDirty: () => false,
    };

    const { listen } = await import("@tauri-apps/api/event");
    vi.mocked(listen).mockImplementation(async (_event, handler) => {
      await handler({
        event: "file_changed",
        id: 1,
        payload: {
          path: "/tmp/project/src/new.rs",
          kind: "created",
        },
      });
      return () => {};
    });

    const { initFsSync, teardownFsSync } = await import("./fs-sync");
    await initFsSync({
      tabStore: tabStore as never,
      getFileTree: () => tree as never,
      callbacks,
    });

    expect(refreshPath).toHaveBeenCalledWith("/tmp/project/src");
    await teardownFsSync();
  });
});
