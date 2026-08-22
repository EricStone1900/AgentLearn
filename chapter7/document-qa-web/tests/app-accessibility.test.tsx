// @vitest-environment jsdom

import {
  cleanup,
  render,
  screen,
} from "@testing-library/react";
import {
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { api } = vi.hoisted(() => {
  return {
    api: {
      health: vi.fn(),
      uploadPdf: vi.fn(),
      askDocument: vi.fn(),
      chat: vi.fn(),
      addNote: vi.fn(),
      searchMemories: vi.fn(),
      getStats: vi.fn().mockResolvedValue({
        sessionId: "session-1",
        userId: "user-1",
        namespace: "document-qa:user-1",
        sessionStartedAt: "2026-08-22T00:00:00.000Z",
        durationSeconds: 0,
        metrics: { documentsLoaded: 0, questionsAsked: 0, notesAdded: 0, agentInteractions: 0 },
        rag: { documents: 0, chunks: 0 },
        memory: { userId: "user-1", totalMemories: 0, memoriesByType: {} },
      }),
      generateReport: vi.fn(),
    },
  };
});

vi.mock("../src/api/assistant-api.js", () => {
  return {
    createAssistantApi: () => api,
  };
});

import {
  App,
} from "../src/app.js";

describe("App 可访问性结构", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("提供跳转主内容入口和清晰的页面层级", () => {
    render(<App />);

    expect(screen.getByRole("link", { name: "跳到主要内容" }).getAttribute("href")).toBe(
      "#main-content",
    );
    expect(screen.getByRole("main").getAttribute("id")).toBe("main-content");
    expect(screen.getByRole("heading", { level: 1 })).not.toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(5);
  });
});
