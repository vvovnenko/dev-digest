import { describe, it, expect } from "vitest";
import type { Agent } from "@devdigest/shared";
import { changedFields } from "./helpers";

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  enabled: true,
  version: 1,
};

describe("changedFields", () => {
  it("keeps only values that differ from the saved agent", () => {
    expect(changedFields(AGENT, {})).toEqual({});
    expect(changedFields(AGENT, { enabled: true, name: "Sec 2" })).toEqual({ name: "Sec 2" });
    expect(changedFields(AGENT, { repo_intel: false, strategy: "single-pass" })).toEqual({ repo_intel: false });
  });

  it("drops an unset model but keeps the empty one a provider switch leaves", () => {
    expect(changedFields(AGENT, { provider: "openai", model: undefined })).toEqual({});
    expect(changedFields(AGENT, { provider: "anthropic", model: "" })).toEqual({ provider: "anthropic", model: "" });
  });
});
