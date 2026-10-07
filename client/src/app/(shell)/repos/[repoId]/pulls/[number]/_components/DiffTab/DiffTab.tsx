"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { SectionLabel, Button } from "@devdigest/ui";
import { DiffViewer, type DiffCommentApi } from "@/components/diff-viewer";
import { usePrComments, useCreatePrComment } from "@/lib/hooks/reviews";
import type { PrFile } from "@devdigest/shared";

interface DiffTabProps {
  prId: string;
  filesCount: number;
  files: PrFile[];
  /** Inline commenting is offered only on open PRs (GitHub rejects otherwise). */
  canComment?: boolean;
}

export function DiffTab({ prId, filesCount, files, canComment }: DiffTabProps) {
  const t = useTranslations("prReview.diffTab");
  const { data: comments } = usePrComments(prId);
  const create = useCreatePrComment(prId);
  // Comments start hidden so the diff is clean by default — toggle to reveal.
  const [showComments, setShowComments] = React.useState(false);

  const commentCount = comments?.length ?? 0;

  const commenting: DiffCommentApi = {
    comments: comments ?? [],
    canComment: !!canComment,
    showComments,
    posting: create.isPending,
    // A failure is toasted once by the global mutation handler; rethrowing keeps
    // the composer open with the draft.
    onSubmit: async (input) => {
      const res = await create.mutateAsync(input);
      setShowComments(true); // a just-posted comment shouldn't stay hidden
      return res;
    },
  };

  return (
    <section>
      <SectionLabel
        icon="Code"
        right={
          commentCount > 0 ? (
            <Button
              kind="ghost"
              size="sm"
              icon={showComments ? "EyeOff" : "Eye"}
              onClick={() => setShowComments((v) => !v)}
            >
              {t(showComments ? "hideComments" : "showComments", { count: commentCount })}
            </Button>
          ) : undefined
        }
      >
        {t("title", { count: filesCount })}
      </SectionLabel>
      <DiffViewer files={files} commenting={commenting} />
    </section>
  );
}
