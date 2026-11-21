// hesiasun-identite-cron — rejeu horaire des envois d'identité vers HésiaSun restés en attente.
// Spec : docs/superpowers/specs/2026-11-21-identite-entreprise-saisie-unique-hesiasun-design.md (lot 3)
//
// Pattern : pg_cron (minute 20 de chaque heure, seulement s'il existe une organisation en attente) → cette edge
// (verify_jwt:false, MDH_CRON_SECRET) → org_hesiasun_en_attente() → pousserIdentite(), la MÊME fonction que
// l'écran, une organisation après l'autre. Au-delà de 24 h d'échecs le rejeu cesse (aRejouer) : l'erreur reste
// affichée dans l'onglet Identité, « Renvoyer » reste possible.
//
// Réponse : 200 { vues, envoyees, encore_en_attente, abandonnees, erreurs }.
// Journal : l'identifiant de l'organisation et un code, jamais l'identité ni la clé.
// Env : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_CRON_SECRET, MDH_HESIASUN_URL.

import { requireSharedSecret, jsonResponse, buildCorsHeaders, getAdminClient, sanitizeError } from "../_shared/auth.ts";
import { lireReglages, noter, pousserIdentite } from "../_shared/hesiasunIdentite.ts";
import { aRejouer, lireEtatLiaison } from "../_shared/organisation/liaisonHesiasun.js";

const BUDGET_MS = 40_000;

Deno.serve(async (req: Request) => {
  const debut = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  const authError = requireSharedSecret(req, Deno.env.get("MDH_CRON_SECRET") || "", "MDH_CRON_SECRET");
  if (authError) return authError;

  try {
    const admin = getAdminClient();
    const { data, error } = await admin.rpc("org_hesiasun_en_attente");
    if (error) return jsonResponse({ error: sanitizeError(error, "lecture des envois en attente impossible") }, 500, req);

    const organisations = ((data ?? []) as { org_id: string }[]).map((l) => l.org_id);
    let envoyees = 0, encore = 0, abandonnees = 0, erreurs = 0;
    for (const orgId of organisations) {
      if (Date.now() - debut >= BUDGET_MS) { encore++; continue; }
      const reglages = await lireReglages(admin, orgId);
      const etat = reglages ? lireEtatLiaison(reglages) : null;
      if (!etat) { erreurs++; continue; }
      if (!aRejouer(etat, Date.now())) {
        // 24 h d'échecs : on cesse de rejouer, l'erreur reste affichée.
        if (await noter(admin, orgId, { ...etat, en_attente: false })) abandonnees++; else erreurs++;
        console.warn(`[hesiasun-identite-cron] ${orgId} : rejeu abandonné (${etat.erreur ?? "sans code"})`);
        continue;
      }
      const r = await pousserIdentite(admin, orgId);
      if (r.ok) envoyees++;
      else if (r.etat?.en_attente) encore++;
      else { erreurs++; console.warn(`[hesiasun-identite-cron] ${orgId} : ${r.code}`); }
    }
    return jsonResponse({ vues: organisations.length, envoyees, encore_en_attente: encore, abandonnees, erreurs }, 200, req);
  } catch (err) {
    return jsonResponse({ error: sanitizeError(err, "rejeu HésiaSun : erreur interne") }, 500, req);
  }
});
