/**
 * Skills hooks: a URL import posts to `/skills/import/url`, caches the saved skill under its
 * detail key and refreshes every skill query (the list shows it at once); a failed import
 * writes nothing to the cache.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Skill } from "@devdigest/shared";

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return { ...actual, api: { get: vi.fn(), post, put: vi.fn(), del: vi.fn() } };
});

import { ApiError } from "../api";
import { useImportSkillFromUrl } from "./skills";
import { skillKeys } from "./keys";

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return { qc, wrapper };
}

const SKILL: Skill = {
  id: "s9",
  name: "malicious-skill",
  description: "",
  type: "custom",
  source: "imported_url",
  body: "## Rule",
  enabled: true,
  version: 1,
  injection_detected: true,
};

afterEach(() => {
  post.mockReset();
});

describe("useImportSkillFromUrl", () => {
  it("posts the URL, caches the saved skill and refreshes the skill list", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(skillKeys.list, []);
    post.mockResolvedValue(SKILL);
    const { result } = renderHook(() => useImportSkillFromUrl(), { wrapper });
    const input = { url: "https://raw.githubusercontent.com/org/repo/main/skill.md" };
    await act(() => result.current.mutateAsync(input));
    expect(post).toHaveBeenCalledWith("/skills/import/url", input);
    expect(qc.getQueryData(skillKeys.detail("s9"))).toEqual(SKILL);
    expect(qc.getQueryState(skillKeys.list)?.isInvalidated).toBe(true);
  });

  it("leaves the cache alone when the import fails", async () => {
    const { qc, wrapper } = setup();
    qc.setQueryData(skillKeys.list, []);
    post.mockRejectedValue(new ApiError("A skill with this name already exists", 409, "conflict"));
    const { result } = renderHook(() => useImportSkillFromUrl(), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync({ url: "https://x.test/a.md", name: "taken" })).rejects.toThrow(
        "already exists",
      );
    });
    expect(qc.getQueryState(skillKeys.list)?.isInvalidated).toBe(false);
    expect(qc.getQueryData(skillKeys.detail("s9"))).toBeUndefined();
  });
});
