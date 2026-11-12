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
import { lireReponse, lireReponseLancement, lireReponseSuivi, verdictRun } from "./assistantPieces.js";

const HERMES_URL = (Deno.env.get("MDH_HERMES_URL") || "").replace(/\/+$/, "");
const HERMES_KEY = Deno.env.get("MDH_HERMES_KEY") || "";
const DELAI_MS = 15_000;
/** Une ligne restée sans run_id plus longtemps que cela (lancement interrompu) est close en `delai_depasse`. */
const DELAI_SANS_RUN_MIN = 2;

/** Les deux secrets d'Hermes sont-ils posés ? Sinon l'assistant est indisponible, avant tout quota. */
export function hermesConfigure(): boolean {
  return HERMES_URL !== "" && HERMES_KEY !== "";
}

/**
 * Appel ENTIER borné à 15 s : connexion, en-têtes ET lecture du corps (la minuterie n'est levée qu'après le corps).
 * Ne lève jamais : `statut` null = réseau coupé ou délai dépassé avant les en-têtes ; `texte` null = corps
 * illisible, coupé ou hors délai.
 */
async function appeler(chemin: string, init: RequestInit): Promise<{ statut: number | null; texte: string | null }> {
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), DELAI_MS);
  try {
    let r: Response;
    try {
      r = await fetch(`${HERMES_URL}${chemin}`, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${HERMES_KEY}` },
        signal: ctrl.signal,
      });
    } catch {
      return { statut: null, texte: null };
    }
    try {
      return { statut: r.status, texte: await r.text() };
    } catch {
      return { statut: r.status, texte: null };
    }
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
  const lu = lireReponseLancement(r.statut, r.texte);
  if (lu.runId) return { runId: lu.runId };
  // 429 = trop de runs simultanés (attendu sous charge) : pas journalisé. 401 = clé refusée (configuration).
  if (lu.motif === "injoignable") console.error("[assistant-pieces] Hermes injoignable au lancement (réseau ou délai)");
  else if (lu.motif === "refuse") console.error(`[assistant-pieces] Hermes a refusé le lancement : HTTP ${r.statut}`);
  else if (lu.motif === "illisible") console.error(`[assistant-pieces] réponse de lancement d'Hermes illisible (HTTP ${r.statut})`);
  else if (lu.motif === "sans_run_id") console.error("[assistant-pieces] réponse de lancement d'Hermes sans run_id");
  return { indisponible: true };
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
  const lu = lireReponseSuivi(reponse.statut, reponse.texte);
  // Hermes ne connaît plus ce run (fini depuis plus d'une heure, ou redémarré).
  if (lu.issue === "inconnu") return await delaiDepasse();
  if (lu.issue === "passager" && reponse.statut !== null && reponse.statut >= 400 && reponse.statut < 500) {
    console.error(`[assistant-pieces] Hermes a refusé la lecture du run : HTTP ${reponse.statut}`);
  }
  // Pas d'état lisible (réseau, délai, 5xx, corps illisible) : comme un run encore en route, borné par l'âge.
  const verdict = verdictRun(lu.issue === "lu" ? lu.etat : null, ageMin);
  if (verdict === "en_cours") return "en_cours";
  if (verdict === "echec_delai") return await delaiDepasse();

  const texte = lu.issue === "lu" ? lu.texte : null;
  const usage = lu.issue === "lu" ? lu.usage : null;
  if (verdict === "terminee") {
    await clore(admin, r.id, "terminee", { reponse: lireReponse(texte).structure, texte, usage, erreur: null });
    return "terminee";
  }
  await clore(admin, r.id, "echec", { texte, usage, erreur: "recherche_echouee" });
  return "echec";
}
