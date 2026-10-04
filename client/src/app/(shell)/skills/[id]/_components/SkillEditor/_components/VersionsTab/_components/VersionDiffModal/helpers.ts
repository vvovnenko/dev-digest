import { MAX_DIFF_CELLS } from "./constants";

export interface DiffLine {
  kind: "same" | "add" | "del";
  text: string;
}

/**
 * Line diff of `before` → `after` (longest common subsequence). The shared head
 * and tail are trimmed first; returns null when the rest is too large to compare.
 */
export function lineDiff(before: string, after: string, maxCells = MAX_DIFF_CELLS): DiffLine[] | null {
  const a = before.split("\n");
  const b = after.split("\n");
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  if (midA.length * midB.length > maxCells) return null;

  // lcs[i][j] = length of the LCS of midA[i..] and midB[j..]
  const rows = midA.length + 1;
  const cols = midB.length + 1;
  const lcs = new Uint32Array(rows * cols);
  for (let i = midA.length - 1; i >= 0; i--) {
    for (let j = midB.length - 1; j >= 0; j--) {
      lcs[i * cols + j] =
        midA[i] === midB[j]
          ? lcs[(i + 1) * cols + j + 1]! + 1
          : Math.max(lcs[(i + 1) * cols + j]!, lcs[i * cols + j + 1]!);
    }
  }

  const middle: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < midA.length && j < midB.length) {
    if (midA[i] === midB[j]) {
      middle.push({ kind: "same", text: midA[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * cols + j]! >= lcs[i * cols + j + 1]!) {
      middle.push({ kind: "del", text: midA[i++]! });
    } else {
      middle.push({ kind: "add", text: midB[j++]! });
    }
  }
  while (i < midA.length) middle.push({ kind: "del", text: midA[i++]! });
  while (j < midB.length) middle.push({ kind: "add", text: midB[j++]! });

  return [
    ...a.slice(0, head).map((text) => ({ kind: "same" as const, text })),
    ...middle,
    ...a.slice(a.length - tail).map((text) => ({ kind: "same" as const, text })),
  ];
}

export interface FieldChange {
  field: "name" | "description" | "type";
  from: string;
  to: string;
}

/** Which of name / description / type differ between two snapshots. */
export function fieldChanges(
  before: { name: string; description: string; type: string },
  after: { name: string; description: string; type: string },
): FieldChange[] {
  return (["name", "description", "type"] as const)
    .filter((f) => before[f] !== after[f])
    .map((field) => ({ field, from: before[field], to: after[field] }));
}
