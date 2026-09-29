"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { FormField, TextInput, SelectInput, SearchableSelect, Textarea, Toggle, Button } from "@devdigest/ui";
import type { Agent, CiFailOn, Provider, ReviewStrategy } from "@devdigest/shared";
import { useUpdateAgent, useProviderModels, type UpdateAgentInput } from "@/lib/hooks/agents";
import { useToast } from "@/lib/toast";
import { toModelOptions } from "@/lib/model-label";
import { PROVIDER_OPTIONS } from "../../../../../constants";
import { CI_FAIL_ON_VALUES, OUTPUT_SCHEMA_VALUE, STRATEGY_VALUES } from "./constants";
import { s } from "./styles";

type ConfigPatch = UpdateAgentInput["patch"];

/**
 * Config tab — name/description/provider/model/system-prompt + enabled toggle.
 *
 * The form keeps only what the user changed (`draft`); every other field shows
 * the latest agent from the cache, and Save sends only the draft. So a change
 * made elsewhere in the meantime — the list's enabled toggle — is shown here
 * and never overwritten. The parent keys this component by agent id, which
 * starts a fresh draft for each agent.
 */
export function ConfigTab({ agent }: { agent: Agent }) {
  const t = useTranslations("agents");
  const toast = useToast();
  const update = useUpdateAgent();
  const [draft, setDraft] = React.useState<ConfigPatch>({});
  const edit =
    <K extends keyof ConfigPatch>(key: K) =>
    (value: ConfigPatch[K]) =>
      setDraft((d) => ({ ...d, [key]: value }));

  const name = draft.name ?? agent.name;
  const description = draft.description ?? agent.description;
  const provider = draft.provider ?? agent.provider;
  const model = draft.model ?? agent.model;
  const systemPrompt = draft.system_prompt ?? agent.system_prompt;
  const strategy = draft.strategy ?? agent.strategy;
  const ciFailOn = draft.ci_fail_on ?? agent.ci_fail_on;
  const repoIntel = draft.repo_intel ?? agent.repo_intel;
  const enabled = draft.enabled ?? agent.enabled;

  // A model belongs to its provider: switching provider clears the model until
  // one is picked (Save waits for it); switching back restores the saved one.
  const changeProvider = (next: Provider) =>
    setDraft((d) => ({ ...d, provider: next, model: next === agent.provider ? undefined : "" }));

  const { data: models } = useProviderModels(provider);
  // Show the price (USD per 1M in/out tokens) in the label when the provider
  // exposes it (OpenRouter) so a cheap model is easy to pick; value stays the id.
  const modelOptions = toModelOptions(models);
  const hasModel = modelOptions.some((o) => (typeof o === "string" ? o : o.value) === model);
  if (model && !hasModel) modelOptions.unshift(model);
  // Empty list after load = provider key missing/invalid (listModels failed) —
  // guide the user instead of showing a silent one-item dropdown.
  const noModels = models !== undefined && models.length === 0;

  // Friendly labels for the strategy select (values come from constants).
  const strategyOptions = STRATEGY_VALUES.map((v) => ({ value: v, label: t(`config.strategyOptions.${v}`) }));
  const ciFailOnOptions = CI_FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`config.ciFailOnOptions.${v}`) }));

  const save = () => {
    const sent = draft;
    update.mutate(
      { id: agent.id, patch: sent },
      {
        // Failures are surfaced by the global mutation error toast; confirm the
        // save with a success toast (not just the inline "Saved (vN)" note).
        onSuccess: (data) => {
          // Drop what was saved; keep anything typed while the request was in flight.
          setDraft((d) => {
            const rest: ConfigPatch = { ...d };
            for (const key of Object.keys(sent) as (keyof ConfigPatch)[]) {
              if (rest[key] === sent[key]) delete rest[key];
            }
            return rest;
          });
          toast.success(t("config.savedToast", { version: data.version }));
        },
      },
    );
  };

  return (
    <div style={s.wrap}>
      <div style={s.header}>
        <h2 style={s.h2}>{t("config.title")}</h2>
        <label style={s.enabledLabel}>
          {t("config.enabled")}
          <Toggle on={enabled} onChange={edit("enabled")} size={16} />
        </label>
      </div>
      <FormField label={t("config.name")} required>
        <TextInput value={name} onChange={edit("name")} />
      </FormField>
      <FormField label={t("config.description")}>
        <TextInput value={description} onChange={edit("description")} />
      </FormField>
      <FormField label={t("config.provider")}>
        <SelectInput
          value={provider}
          onChange={(v) => changeProvider(v as Provider)}
          options={[...PROVIDER_OPTIONS]}
        />
      </FormField>
      <FormField
        label={t("config.model")}
        hint={noModels ? t("config.modelEmptyHint", { provider }) : t("config.modelHint")}
      >
        <SearchableSelect
          value={model}
          onChange={edit("model")}
          options={modelOptions}
          placeholder={t("config.modelSearch")}
        />
      </FormField>
      <FormField label={t("config.strategy")} hint={t("config.strategyHint")}>
        <SelectInput
          value={strategy}
          onChange={(v) => edit("strategy")(v as ReviewStrategy)}
          options={strategyOptions}
        />
      </FormField>
      <FormField label={t("config.ciFailOn")} hint={t("config.ciFailOnHint")}>
        <SelectInput
          value={ciFailOn}
          onChange={(v) => edit("ci_fail_on")(v as CiFailOn)}
          options={ciFailOnOptions}
        />
      </FormField>
      <FormField label={t("config.repoIntel")} hint={t("config.repoIntelHint")}>
        <label style={s.enabledLabel}>
          <Toggle on={repoIntel} onChange={edit("repo_intel")} size={16} />
        </label>
      </FormField>
      <FormField label={t("config.systemPrompt")} hint={t("config.systemPromptHint")}>
        <Textarea value={systemPrompt} onChange={edit("system_prompt")} rows={8} mono />
      </FormField>
      <FormField label={t("config.outputSchema")}>
        <SelectInput value={OUTPUT_SCHEMA_VALUE} options={[OUTPUT_SCHEMA_VALUE]} />
      </FormField>
      <div style={s.actions}>
        <Button kind="primary" icon="Check" onClick={save} disabled={update.isPending || !model}>
          {update.isPending ? t("config.saving") : t("config.save")}
        </Button>
        {update.isSuccess && (
          <span style={s.savedNote}>{t("config.saved", { version: update.data?.version })}</span>
        )}
      </div>
    </div>
  );
}
