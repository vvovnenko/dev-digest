/* Root — sends the user to the first repo's PR list, or onboarding if no repos. */
"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { EmptyState, Button, Skeleton } from "@devdigest/ui";
import { useShellCrumb } from "@/components/app-shell";
import { PageContainer } from "@/components/page-shell";
import { useRepos } from "@/lib/hooks";
import { s } from "./styles";

export function HomeView() {
  const t = useTranslations("shell.home");
  const router = useRouter();
  const { data: repos, isLoading, isError } = useRepos();
  useShellCrumb([{ label: t("breadcrumb") }]);

  React.useEffect(() => {
    if (repos && repos.length > 0) {
      router.replace(`/repos/${repos[0]!.id}/pulls`);
    }
  }, [repos, router]);

  return (
    <PageContainer title={t("title")} subtitle={t("subtitle")}>
      {isLoading ? (
        <div style={s.skeletons}>
          <Skeleton height={20} width={240} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </div>
      ) : isError || !repos || repos.length === 0 ? (
        <EmptyState
          icon="GitBranch"
          title={t("emptyTitle")}
          body={t("emptyBody")}
          cta={t("emptyCta")}
          onCta={() => router.push("/onboarding")}
        />
      ) : (
        <div>
          <p style={s.redirecting}>{t("redirecting")}</p>
          <Button kind="primary" onClick={() => router.push(`/repos/${repos[0]!.id}/pulls`)}>
            {t("open", { name: repos[0]!.full_name })}
          </Button>
        </div>
      )}
    </PageContainer>
  );
}
