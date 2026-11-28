// supabase/functions/fournisseur-aspirer-modele/index.ts
// ============================================================================
// Relais modèle de l'aspirateur de sites fournisseurs. Le service VPS (ops/aspirateur) n'a AUCUNE clé de l'API Claude
// (il héberge un navigateur qui lit des pages tierces, sur la machine d'Hermes) : chaque appel au modèle passe ici.
// verify_jwt = false + requireSharedSecret(MDH_ASPIRATEUR_KEY) : seul le service appelle.
// L'edge FIXE le modèle selon l'usage (apprendre | lire), refuse tout outil autre que les six de l'agent (aucun outil
// serveur), plafonne les tokens, et compte le coût de chaque appel contre le plafond du travail AVANT de rendre la
// réponse (aspiration_cout_ajouter) : travail au plafond ⇒ plus aucun appel.
// Règles : src/lib/aspirateur/relais.js (copie _shared/aspirateur/relais.js). Spec 2026-11-28 aspirateur § 7.1.
// Corps : { aspiration_id, usage, system, messages, tools?, max_tokens? } → { data: { content, stop_reason, model }, error: null }
//         ou { data: null, error: code } (codes de src/lib/aspirateur/codes.js). Rien du contenu n'est journalisé.
// Env : ANTHROPIC_API_KEY, MDH_ASPIRATEUR_KEY, ASPIRATEUR_MODELE_APPRENDRE?, ASPIRATEUR_MODELE_LIRE?, SUPABASE_*.
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { requireSharedSecret, jsonResponse, getAdminClient } from "../_shared/auth.ts";
import { coutUsd, coutMaximalUsd, outilsValides, parametresModele } from "../_shared/aspirateur/relais.js";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELAI_MS = 120_000;

const erreur = (code: string, req: Request) => jsonResponse({ data: null, error: code }, 200, req);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);
  const refus = requireSharedSecret(req, Deno.env.get("MDH_ASPIRATEUR_KEY") || "", "MDH_ASPIRATEUR_KEY");
  if (refus) return refus;

  // deno-lint-ignore no-explicit-any
  let corps: any = {};
  try { corps = await req.json(); } catch { corps = {}; }
  const aspirationId = typeof corps.aspiration_id === "string" ? corps.aspiration_id : "";
  if (!UUID.test(aspirationId) || typeof corps.system !== "string" || !Array.isArray(corps.messages)) return erreur("requete_invalide", req);
  if (!outilsValides(corps.tools)) return erreur("requete_invalide", req);
  const params = parametresModele(corps.usage, corps, {
    apprendre: Deno.env.get("ASPIRATEUR_MODELE_APPRENDRE") || undefined,
    lire: Deno.env.get("ASPIRATEUR_MODELE_LIRE") || undefined,
  });
  if (!params) return erreur("requete_invalide", req);
  if (!ANTHROPIC_API_KEY) return erreur("service_indisponible", req);

  const admin = getAdminClient();
  // RÉSERVATION du coût maximal de l'appel avant de le faire (relecture I6) : des appels simultanés ne peuvent pas
  // dépasser le plafond. Travail clos, en attente de confirmation ou inconnu ⇒ refus. Régularisé après l'appel.
  const reserve = coutMaximalUsd(params as { model: string; max_tokens: number });
  const { data: etat, error: errEtat } = await admin.rpc("aspiration_cout_ajouter", { p_aspiration_id: aspirationId, p_usd: reserve });
  if (errEtat) return erreur(errEtat.message === "travail_inconnu" ? "travail_inconnu" : "service_indisponible", req);
  const rendre = (usd: number) => admin.rpc("aspiration_cout_ajouter", { p_aspiration_id: aspirationId, p_usd: usd });
  if (etat?.depasse === true) { await rendre(-reserve); return erreur("plafond_atteint", req); }

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
  const ctrl = new AbortController();
  const minuterie = setTimeout(() => ctrl.abort(), DELAI_MS);
  // deno-lint-ignore no-explicit-any
  let reponse: any;
  try {
    // deno-lint-ignore no-explicit-any
    reponse = await client.beta.messages.create(params as any, { signal: ctrl.signal });
  } catch (e) {
    console.error("[fournisseur-aspirer-modele] appel refusé", aspirationId, (e as { status?: number })?.status ?? "réseau");
    await rendre(-reserve);
    return erreur("service_indisponible", req);
  } finally {
    clearTimeout(minuterie);
  }

  const usd = coutUsd(reponse?.model || String(params.model), reponse?.usage);
  const { data: apres, error: errCout } = await rendre(usd - reserve);
  if (errCout) return erreur("service_indisponible", req);
  console.log("[fournisseur-aspirer-modele]", aspirationId, corps.usage, reponse?.model, reponse?.stop_reason, usd);

  return jsonResponse({
    data: { content: reponse?.content ?? [], stop_reason: reponse?.stop_reason ?? null, model: reponse?.model ?? null, plafond_atteint: apres?.depasse === true },
    error: null,
  }, 200, req);
});
