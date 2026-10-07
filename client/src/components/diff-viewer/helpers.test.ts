import { describe, it, expect } from "vitest";
import { parsePatch } from "./helpers";
import { buildThreads, commentTargetFor, keysForLine, lineKey, partitionThreads } from "./comments";
import type { PrReviewComment } from "@/lib/types";

describe("parsePatch", () => {
  it("numbers old and new lines from the hunk header", () => {
    const lines = parsePatch("@@ -10,3 +10,4 @@\n   port: 3000,\n-  a: 1,\n+  a: 2,\n+  b: 3,\n   end");
    expect(lines.map((l) => [l.kind, l.oldNo, l.newNo])).toEqual([
      ["hunk", undefined, undefined],
      ["ctx", 10, 10],
      ["del", 11, undefined],
      ["add", undefined, 11],
      ["add", undefined, 12],
      ["ctx", 12, 13],
    ]);
    expect(lines[1]!.text).toBe("  port: 3000,"); // the leading space of a context line is the diff's, not the code's
  });

  it("returns nothing for a missing patch", () => {
    expect(parsePatch(null)).toEqual([]);
    expect(parsePatch("")).toEqual([]);
  });
});

const comment = (o: Partial<PrReviewComment>): PrReviewComment => ({
  id: 1,
  path: "a.ts",
  line: 5,
  original_line: 5,
  side: "RIGHT",
  body: "b",
  user: "u",
  created_at: "2026-09-28T10:00:00Z",
  html_url: "https://github.com/x",
  in_reply_to_id: null,
  is_outdated: false,
  ...o,
});

describe("diff comments", () => {
  it("groups replies under their root, oldest first; a thread without a line is outdated", () => {
    const threads = buildThreads([
      comment({ id: 2, in_reply_to_id: 1, created_at: "2026-09-28T11:00:00Z" }),
      comment({ id: 1 }),
      comment({ id: 3, line: null }),
    ]);
    expect(threads.map((t) => [t.rootId, t.comments.map((c) => c.id), t.isOutdated])).toEqual([
      [1, [1, 2], false],
      [3, [3], true],
    ]);
  });

  it("keys a line by side, and knows where a + comments", () => {
    expect(lineKey("RIGHT", 5)).toBe("RIGHT:5");
    expect(lineKey("LEFT", null)).toBeNull();
    expect(keysForLine({ kind: "ctx", text: "", oldNo: 4, newNo: 5 })).toEqual(["RIGHT:5", "LEFT:4"]);
    expect(keysForLine({ kind: "del", text: "", oldNo: 4 })).toEqual(["LEFT:4"]);
    expect(commentTargetFor({ kind: "add", text: "", newNo: 7 })).toEqual({ line: 7, side: "RIGHT" });
    expect(commentTargetFor({ kind: "del", text: "", oldNo: 4 })).toEqual({ line: 4, side: "LEFT" });
    expect(commentTargetFor({ kind: "hunk", text: "@@" })).toBeNull();
  });

  it("anchors threads to rendered lines and keeps the rest as outdated, never dropping one", () => {
    const [onLine, offPatch, noLine] = buildThreads([
      comment({ id: 1, line: 5 }),
      comment({ id: 2, line: 99 }),
      comment({ id: 3, line: null }),
    ]);
    const { matched, outdated } = partitionThreads([onLine!, offPatch!, noLine!], new Set(["RIGHT:5"]));
    expect([...matched.keys()]).toEqual(["RIGHT:5"]);
    expect(outdated.map((t) => t.rootId)).toEqual([2, 3]);
  });
});
