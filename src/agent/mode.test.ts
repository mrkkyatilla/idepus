import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cycleAgentMode,
  defaultAgentForMode,
  loadAgentMode,
  modeAllowsPatch,
  saveAgentMode,
} from "./mode";

function createStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", createStorage());
  saveAgentMode("agent");
});

describe("agent mode", () => {
  it("cycles through four modes", () => {
    expect(cycleAgentMode("agent")).toBe("plan");
    expect(cycleAgentMode("plan")).toBe("ask");
    expect(cycleAgentMode("ask")).toBe("multitask");
    expect(cycleAgentMode("multitask")).toBe("agent");
  });

  it("persists to localStorage", () => {
    saveAgentMode("ask");
    expect(loadAgentMode()).toBe("ask");
  });

  it("maps default agents", () => {
    expect(defaultAgentForMode("agent")).toBe("multi-file-editor");
    expect(defaultAgentForMode("ask")).toBe("code-explorer");
    expect(defaultAgentForMode("plan")).toBe("explore-planner");
  });

  it("patch allowed only for agent and multitask", () => {
    expect(modeAllowsPatch("agent")).toBe(true);
    expect(modeAllowsPatch("multitask")).toBe(true);
    expect(modeAllowsPatch("ask")).toBe(false);
    expect(modeAllowsPatch("plan")).toBe(false);
  });
});
