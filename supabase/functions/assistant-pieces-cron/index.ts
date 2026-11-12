// supabase/functions/assistant-pieces-cron/index.ts
// ============================================================================
// assistant-pieces-cron — filet de sécurité de l'assistant « Trouver une pièce »
// ============================================================================
// Une recherche (majordhome.assistant_recherches) reste `en_cours` tant que l'edge
// assistant-pieces (action `suivre`, appelée par la fenêtre ouverte) ne l'a pas close.
// Si l'utilisateur ferme la fenêtre, personne ne l'interroge : Hermes oublie un run
// fini au bout d'une heure et la ligne resterait `en_cours` pour toujours.
// Ce balayage, appelé chaque minute par pg_cron, fait avancer toutes les recherches
// ouvertes par la MÊME fonction que l'écran (suivreRecherche, _shared/assistantHermes.ts).
//
// Pattern : pg_cron (1 min) → cette edge (verify_jwt:false, MDH_CRON_SECRET) →
//   1. assistant_recherches_en_cours() (50 lignes au plus, les plus anciennes d'abord)
//   2. aucune ligne : réponse immédiate, sans toucher à Hermes
//   3. suivreRecherche(admin, ligne), une ligne après l'autre (le serveur d'Hermes est petit
//      et n'accepte que deux runs simultanés) ; budget de 40 s, le reste passe à la minute suivante.
//
// Journal : l'id de la ligne seulement, jamais la demande ni la réponse.
// Env requis : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MDH_CRON_SECRET (+ MDH_HERMES_URL / MDH_HERMES_KEY
// lus par le module partagé, et seulement s'il y a des lignes à suivre).
// ============================================================================

import {
  requireSharedSecret,
  jsonResponse,
  buildCorsHeaders,
  getAdminClient,
  sanitizeError,
} from "../_shared/auth.ts";
import { suivreRecherche } from "../_shared/assistantHermes.ts";

/** Au-delà, on ne démarre plus de ligne : un suivi en cours peut encore durer 15 s, et pg_net attend 120 s. */
const BUDGET_MS = 40_000;

interface Ligne {
  id: string;
  run_id: string | null;
  created_at: string;
}

Deno.serve(async (req: Request) => {
  const debut = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: buildCorsHeaders(req) });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, req);
  }

  const authError = requireSharedSecret(req, Deno.env.get("MDH_CRON_SECRET") || "", "MDH_CRON_SECRET");
  if (authError) return authError;

  try {
    const admin = getAdminClient();

    const { data, error } = await admin.rpc("assistant_recherches_en_cours");
    if (error) return jsonResponse({ error: sanitizeError(error, "lecture des recherches en cours impossible") }, 500, req);

    const lignes = (data ?? []) as Ligne[];
    if (lignes.length === 0) return jsonResponse({ vues: 0, closes: 0 }, 200, req);

    let closes = 0;
    let enCours = 0;
    let erreurs = 0;
    let reportees = 0;
    for (const ligne of lignes) {
      if (Date.now() - debut >= BUDGET_MS) {
        reportees++;
        continue;
      }
      try {
        const statut = await suivreRecherche(admin, ligne);
        if (statut === "en_cours") enCours++;
        else closes++;
      } catch (e) {
        erreurs++;
        console.error(`[assistant-pieces-cron] suivi en échec pour la recherche ${ligne.id}`, sanitizeError(e, "erreur inattendue"));
      }
    }

    return jsonResponse({ vues: lignes.length, closes, en_cours: enCours, erreurs, reportees }, 200, req);
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "assistant-pieces-cron failed") }, 500, req);
  }
});
