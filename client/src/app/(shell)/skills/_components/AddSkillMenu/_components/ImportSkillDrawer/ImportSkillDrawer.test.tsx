import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { SkillImportPreview } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/skills.json";

const { push, parse, create } = vi.hoisted(() => ({ push: vi.fn(), parse: vi.fn(), create: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, replace: vi.fn() }) }));
vi.mock("@/lib/hooks/skills", () => ({
  usePreviewSkillImport: () => ({ mutate: parse, isPending: false, isError: false }),
  useCreateSkill: () => ({ mutate: create, isPending: false }),
}));

import { ImportSkillDrawer } from "./ImportSkillDrawer";

afterEach(() => {
  cleanup();
  push.mockReset();
  parse.mockReset();
  create.mockReset();
});

const PREVIEW: SkillImportPreview = {
  draft: {
    name: "flaky-test-patterns",
    description: "Apply when tests wait on time.",
    type: "custom",
    body: "## Flag\nA `setTimeout` sleep. ![pixel](https://tracker.test/p.gif)",
  },
  source_file: "flaky-test-patterns/SKILL.md",
  skipped: [{ path: "flaky-test-patterns/scripts/find-sleeps.sh", reason: "script" }],
  warnings: [{ code: "unknown_frontmatter_key", detail: "allowed-tools" }],
  name_taken: false,
};

const renderDrawer = (onClose = vi.fn()) =>
  render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      <ImportSkillDrawer onClose={onClose} />
    </NextIntlClientProvider>,
  );

const zip = (bytes = "PK\x03\x04data", name = "flaky.zip") => new File([bytes], name, { type: "application/zip" });

describe("ImportSkillDrawer", () => {
  it("rejects a file over 512 KiB without a request", async () => {
    const user = userEvent.setup();
    renderDrawer();
    const big = zip();
    Object.defineProperty(big, "size", { value: 512 * 1024 + 1 });
    await user.upload(screen.getByLabelText("Choose file…"), big);
    expect(screen.getByText("flaky.zip is larger than 512 KiB.")).toBeInTheDocument();
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects a file that is not .md or .zip", async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderDrawer();
    await user.upload(screen.getByLabelText("Choose file…"), new File(["echo hi"], "run.sh"));
    expect(screen.getByText("Only .md and .zip files can be imported.")).toBeInTheDocument();
    expect(parse).not.toHaveBeenCalled();
  });

  it("sends the file as base64 and previews the draft with its skipped files and warnings", async () => {
    const user = userEvent.setup();
    parse.mockImplementation((_input, opts) => opts.onSuccess(PREVIEW));
    renderDrawer();
    await user.upload(screen.getByLabelText("Choose file…"), zip("hello"));
    await waitFor(() => expect(parse).toHaveBeenCalled());
    expect(parse.mock.calls[0]![0]).toEqual({ filename: "flaky.zip", content_base64: btoa("hello") });

    expect(screen.getByText("Read before saving")).toBeInTheDocument();
    expect(screen.getByText(/becomes instructions in every agent/)).toBeInTheDocument();
    expect(screen.getByText("flaky-test-patterns/scripts/find-sleeps.sh")).toBeInTheDocument();
    expect(screen.getByText(/script — never run/)).toBeInTheDocument();
    expect(screen.getByText(/Ignored frontmatter key allowed-tools/)).toBeInTheDocument();
    // What the agent will receive, with the image shown as a label, never loaded.
    expect(screen.getByText("flaky-test-patterns", { selector: "h3" })).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
  });

  it("saves only on confirm, as an imported skill, then opens it", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    parse.mockImplementation((_input, opts) => opts.onSuccess(PREVIEW));
    create.mockImplementation((_input, opts) => opts.onSuccess({ id: "s7" }));
    renderDrawer(onClose);
    await user.upload(screen.getByLabelText("Choose file…"), zip());
    await waitFor(() => expect(screen.getByText("Read before saving")).toBeInTheDocument());
    expect(create).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "flaky-tests");
    await user.click(screen.getByRole("button", { name: /Save skill/ }));
    expect(create.mock.calls[0]![0]).toEqual({
      name: "flaky-tests",
      description: "Apply when tests wait on time.",
      type: "custom",
      body: PREVIEW.draft.body,
      source: "imported",
      imported_from: "flaky.zip",
    });
    expect(onClose).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/skills/s7?tab=preview");
  });

  it("blocks saving while the name is taken", async () => {
    const user = userEvent.setup();
    parse.mockImplementation((_input, opts) => opts.onSuccess({ ...PREVIEW, name_taken: true }));
    renderDrawer();
    await user.upload(screen.getByLabelText("Choose file…"), zip());
    await waitFor(() =>
      expect(screen.getByText("A skill with this name already exists — rename it before saving.")).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /Save skill/ })).toBeDisabled();

    await user.type(screen.getByLabelText("Name"), "-2");
    expect(screen.getByRole("button", { name: /Save skill/ })).toBeEnabled();
  });
});
