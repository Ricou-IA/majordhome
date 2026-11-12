// _shared/assistantHermes.ts — l'API d'Hermes (agent de recherche de pièces, VPS) vue des edge functions.
// Spec : docs/superpowers/specs/2026-11-11-assistant-pieces-sav-hermes-design.md § 4.
//
// Deux appels seulement, chacun borné à 15 s : démarrer un run (POST /v1/runs) et lire son état
// (GET /v1/runs/{run_id}). L'edge ne patiente jamais pendant la recherche (1 à 3 minutes) : l'écran revient
// demander, et `suivreRecherche` clôt la ligne quand le run est fini, échoué ou trop vieux.
// Ce module ne voit que la consigne (appareil + demande) : aucune donnée du client n'y entre, et rien de la
// consigne, de la réponse ni de la clé n'est journalisé.
//
// Secrets : MDH_HERMES_URL (adresse du serveur, jamais écrite dans le code), MDH_HERMES_KEY.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { lireReponse, verdictRun } from "./assistantPieces.js";

const HERMES_URL = (Deno.env.get("MDH_HERMES_URL") || "").replace(/\/+$/, "");
const HERMES_KEY = Deno.env.get("MDH_HERMES_KEY") || "";
const DELAI_MS = 15_000;
/** Une ligne restée sans run_id plus longtemps que cela (lancement interrompu) est close en `delai_depasse`. */
const DELAI_SANS_RUN_MIN = 2;

type RunHermes = { status?: unknown; output?: unknown; usage?: unknown };

/** Les deux secrets d'Hermes sont-ils posés ? Sinon l'assistant est indisponible, avant tout quota. */
export function hermesConfigure(): boolean {
  return HERMES_URL !== "" && HERMES_KEY !== "";
}

/** Appel borné à 15 s. Ne lève jamais : `null` = réseau coupé ou délai dépassé. */
async function appeler(chemin: string, init: RequestInit): Promise<Response | null> {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    return await fetch(`${HERMES_URL}${chemin}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${HERMES_KEY}` },
      signal: ctrl.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(minuterie);
  }
}

/**
 * Démarre un run. L'id de notre ligne sert de clé d'idempotence et de session : un second envoi de la même
 * recherche ne lance pas un second run. 401, 429, 5xx, réseau ou réponse sans run_id → indisponible.
 */
export async function demarrerRun(consigne: string, idRecherche: string): Promise<{ runId: string } | { indisponible: true }> {
  if (!hermesConfigure()) return { indisponible: true };
  const r = await appeler("/v1/runs", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idRecherche },
    body: JSON.stringify({ input: consigne, session_id: idRecherche }),
  });
  if (!r) {
    console.error("[assistant-pieces] Hermes injoignable au lancement (réseau ou délai)");
    return { indisponible: true };
  }
  if (!r.ok) {
    // 429 = trop de runs simultanés (attendu sous charge) ; 401 = clé refusée (configuration).
    if (r.status !== 429) console.error(`[assistant-pieces] Hermes a refusé le lancement : HTTP ${r.status}`);
    await r.body?.cancel();
    return { indisponible: true };
  }
  const corps = (await r.json().catch(() => null)) as { run_id?: unknown } | null;
  const runId = typeof corps?.run_id === "string" ? corps.run_id.trim() : "";
  if (!runId) {
    console.error("[assistant-pieces] réponse de lancement d'Hermes sans run_id");
    return { indisponible: true };
  }
  return { runId };
}

/** Clôt la ligne par la RPC (une seule fois : `false` = déjà close par l'autre voie, ce n'est pas une erreur). */
async function clore(
  admin: SupabaseClient, id: string, statut: "terminee" | "echec",
  champs: { reponse?: unknown; texte?: string | null; usage?: unknown; erreur?: string | null },
): Promise<void> {
  const { error } = await admin.rpc("assistant_recherche_clore", {
    p_id: id, p_statut: statut, p_reponse: champs.reponse ?? null, p_texte: champs.texte ?? null,
    p_usage: champs.usage ?? null, p_erreur: champs.erreur ?? null,
  });
  if (error) throw error;
}

/**
 * Fait avancer une recherche `en_cours` : lit son run chez Hermes et clôt la ligne quand il y a lieu.
 * `r` doit avoir été relue EN BASE et dans l'organisation de l'appelant (la RPC de clôture ne contrôle pas l'org).
 * Hermes momentanément injoignable (réseau, 5xx, délai) sur une ligne de moins de 15 min : rien n'est écrit.
 */
export async function suivreRecherche(
  admin: SupabaseClient, r: { id: string; run_id: string | null; created_at: string },
): Promise<"en_cours" | "terminee" | "echec"> {
  const ageMin = (Date.now() - new Date(r.created_at).getTime()) / 60_000;
  const delaiDepasse = async () => {
    await clore(admin, r.id, "echec", { erreur: "delai_depasse" });
    return "echec" as const;
  };

  if (!r.run_id) {
    return Number.isFinite(ageMin) && ageMin < DELAI_SANS_RUN_MIN ? "en_cours" : await delaiDepasse();
  }
  if (!hermesConfigure()) {
    // Secrets retirés après le lancement : la ligne attend, la limite d'âge la clôt.
    return verdictRun(null, ageMin) === "en_cours" ? "en_cours" : await delaiDepasse();
  }

  const reponse = await appeler(`/v1/runs/${encodeURIComponent(r.run_id)}`, { method: "GET" });
  if (reponse?.status === 404) {
    await reponse.body?.cancel();
    return await delaiDepasse(); // Hermes ne connaît plus ce run (fini depuis plus d'une heure, ou redémarré)
  }
  const run = reponse?.ok ? ((await reponse.json().catch(() => null)) as RunHermes | null) : null;
  if (reponse && !reponse.ok) {
    if (reponse.status < 500) console.error(`[assistant-pieces] Hermes a refusé la lecture du run : HTTP ${reponse.status}`);
    await reponse.body?.cancel();
  }
  // Pas d'état lisible (réseau, délai, 5xx, corps illisible) : comme un run encore en route, borné par l'âge.
  const verdict = verdictRun(run ? run.status : null, ageMin);
  if (verdict === "en_cours") return "en_cours";
  if (verdict === "echec_delai") return await delaiDepasse();

  const texte = typeof run?.output === "string" ? run.output : null;
  const usage = run?.usage && typeof run.usage === "object" ? run.usage : null;
  if (verdict === "terminee") {
    await clore(admin, r.id, "terminee", { reponse: lireReponse(texte).structure, texte, usage, erreur: null });
    return "terminee";
  }
  await clore(admin, r.id, "echec", { texte, usage, erreur: "recherche_echouee" });
  return "echec";
}
