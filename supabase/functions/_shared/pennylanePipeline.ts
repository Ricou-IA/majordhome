// supabase/functions/_shared/pennylanePipeline.ts
// Seuil pipeline (€ HT) d'une org : `settings.pennylane.pipeline_min_amount_ht`,
// défaut 500. Même règle que `majordhome.pl_pipeline_min_amount_ht(org)` (migration
// 20261012_5) et `pennylanePipelineMinAmountHt(settings)` côté front : une valeur
// absente ou non numérique vaut 500, jamais une erreur en plein cron.
//
// Lecteurs : pennylane-sync-cron, pennylane-backfill-quotes (mono-org, ORG_ID).
// pennylane-sync-quote-status n'en a pas besoin : la RPC
// pennylane_sync_auto_attach_pending lit le réglage elle-même.

export const PIPELINE_MIN_AMOUNT_HT_DEFAULT = 500;

// deno-lint-ignore no-explicit-any
export async function getPipelineMinAmountHt(supabase: any, orgId: string): Promise<number> {
  const { data, error } = await supabase
    .schema("core")
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw new Error(`lecture settings org ${orgId} : ${error.message}`);
  const raw = data?.settings?.pennylane?.pipeline_min_amount_ht;
  if (raw === null || raw === undefined || raw === "") return PIPELINE_MIN_AMOUNT_HT_DEFAULT;
  const n = Number(String(raw).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : PIPELINE_MIN_AMOUNT_HT_DEFAULT;
}
