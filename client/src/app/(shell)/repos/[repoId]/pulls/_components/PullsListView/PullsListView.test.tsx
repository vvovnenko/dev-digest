/**
 * The PR list keeps its status chip, search and sort in the URL: search filters
 * as you type and lands in `?q=` after a pause; `?sort=` and `?q=` from the URL
 * are applied on load.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@/lib/types";
import messages from "../../../../../../../../messages/en/prReview.json";

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  useSearchParams: () => new URLSearchParams(nav.search),
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
}));

const pr = (number: number, title: string, updated_at: string): PrMeta =>
  ({
    id: `pr-${number}`,
    number,
    title,
    author: "dev",
    branch: "b",
    base: "main",
    head_sha: "h",
    additions: 1,
    deletions: 1,
    files_count: 1,
    status: "needs_review",
    opened_at: null,
    updated_at,
    score: null,
    cost_usd: null,
    findings_by_severity: null,
  }) as PrMeta;

const PULLS = [
  pr(1, "Add login", "2026-09-01T00:00:00Z"),
  pr(2, "Fix logout", "2026-09-03T00:00:00Z"),
  pr(3, "Refactor login form", "2026-09-02T00:00:00Z"),
];

const sync = vi.hoisted(() => ({ auto: vi.fn(), refresh: vi.fn(), poll: vi.fn() }));
vi.mock("@/lib/hooks", () => ({
  usePulls: () => ({ data: PULLS, isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useRefreshRepo: () => ({ mutate: sync.refresh, isPending: false }),
  useSyncPulls: () => ({ mutate: sync.poll, isPending: false }),
  useAutoSyncPulls: (repoId: string) => sync.auto(repoId),
}));
vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: () => ({ data: undefined, isLoading: false, isError: false }) }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/app" } }),
  useRepoNotFound: () => false,
}));

import { PullsListView } from "./PullsListView";

beforeEach(() => {
  nav.search = "";
  nav.replace.mockReset();
});
afterEach(cleanup);

function renderList() {
  return render(
    <NextIntlClientProvider locale="en" timeZone="UTC" messages={{ prReview: messages }}>
      <PullsListView />
    </NextIntlClientProvider>,
  );
}

const titles = () => screen.getAllByRole("link").map((a) => a.textContent);

describe("PullsListView — URL state", () => {
  it("filters as you type, then writes ?q= once the typing pauses", async () => {
    const user = userEvent.setup();
    renderList();
    expect(titles()).toEqual(["Fix logout", "Refactor login form", "Add login"]); // newest first

    await user.type(screen.getByRole("textbox", { name: "Search pull requests by title or number" }), "login");
    expect(titles()).toEqual(["Refactor login form", "Add login"]);
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(nav.replace).toHaveBeenCalledTimes(1); // one navigation for the whole word
    expect(nav.replace).toHaveBeenLastCalledWith("/repos/r1/pulls?q=login", { scroll: false });
  });

  it("applies ?q= and ?sort= from the URL on load, and writes a new sort to it", async () => {
    const user = userEvent.setup();
    nav.search = "status=all&q=log&sort=oldest";
    renderList();
    expect(screen.getByRole("textbox", { name: "Search pull requests by title or number" })).toHaveValue("log");
    expect(titles()).toEqual(["Add login", "Refactor login form", "Fix logout"]); // oldest first

    await user.selectOptions(screen.getByRole("combobox"), "newest");
    expect(nav.replace).toHaveBeenLastCalledWith("/repos/r1/pulls?status=all&q=log", { scroll: false });
  });
});

describe("PullsListView — GitHub sync", () => {
  it("imports the repo's PRs when the list opens, and Refresh re-clones and imports again", async () => {
    const user = userEvent.setup();
    renderList();
    expect(sync.auto).toHaveBeenCalledWith("r1");

    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(sync.refresh).toHaveBeenCalledWith("r1");
    expect(sync.poll).toHaveBeenCalledWith("r1");
  });
});
