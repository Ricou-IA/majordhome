// supabase/functions/mailing-rediger/index.ts
// ============================================================================
// mailing-rediger — rédaction assistée d'un e-mail (page du mail, bouton « Rédiger » et retouches)
// ============================================================================
// Spec : docs/superpowers/specs/2026-11-21-createur-mail-une-page-habillage-design.md § 5.5.
//
// verify_jwt:true. Corps : { org_id, consigne, intention, objet, corps, nature, variables }.
// Réponse : toujours HTTP 200 `{ data, error }` où `error` est un CODE de `REDACTION_CODES` (les refus d'accès de
// `requireOrgMembership` gardent leurs 401 / 403). Jamais le texte brut du modèle, une trace ou un message du
// fournisseur n'atteignent le navigateur : ils sont journalisés ici (code et consommation seulement, jamais un texte).
//
// Sécurité :
//   - org_admin de l'organisation du corps, module Communication ouvert ;
//   - le nom de l'entreprise, son site et le catalogue d'adresses sont RELUS en base (réglages de l'organisation
//     validée) : jamais pris de la requête ;
//   - rien d'un destinataire (client, prospect, segment) n'est lu ni envoyé au modèle : seul part ce que renvoie
//     `construireConsigne` (intention, texte et objet actuels, variables, nom et site de l'entreprise, adresses) ;
//   - la réponse du modèle repasse par `lireReponse` (variables non proposées retirées, liens hors liste ramenés à
//     du texte, texte normalisé) ; une réponse refusée par ce contrôle ⇒ `reponse_illisible` ;
//   - ordre des gardes : membre → module → demande valide et bornée → secret présent → plafond → appel. Le plafond
//     n'est consommé que lorsque tout ce qui précède est passé : un refus ne coûte rien à l'utilisateur ;
//   - la seule écriture est le plafond du jour (RPC `increment_mailing_redaction_quota`, service_role).
//
// Env : ANTHROPIC_API_KEY, ANTHROPIC_MAILING_MODEL (défaut claude-sonnet-5-5), MAILING_REDACTION_DAILY_LIMIT
// (défaut 50 par utilisateur et par jour), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (via _shared/auth).
// Règles pures : _shared/mailRedaction.js (copie de src/lib/mailRedaction.js — ne pas l'éditer).
// ============================================================================

import Anthropic from "npm:@anthropic-ai/sdk@1.3.0";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import {
  SCHEMA_REDACTION, adressesAutorisees, adressesDuTexte, construireConsigne, lireReponse, validerDemande,
} from "../_shared/mailRedaction.js";
import { variablesDe } from "../_shared/mailCorps.js";
import { moduleActif } from "../_shared/modules.js";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ANTHROPIC_MAILING_MODEL") || "claude-sonnet-5-5";
const LIMITE_PAR_DEFAUT = 50;
const LIMITE_JOUR = (() => {
  const n = Number.parseInt(Deno.env.get("MAILING_REDACTION_DAILY_LIMIT") || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : LIMITE_PAR_DEFAUT;
})();

const DUREE_IA_MS = 60_000;
const MAX_TOKENS = 8_000;
// Bornes d'entrée, vérifiées avant tout appel payant.
const INTENTION_MAX = 2_000;
const OBJET_MAX = 300;
const CORPS_MAX = 12_000; // un texte retravaillé doit revenir EN ENTIER dans MAX_TOKENS
const VARIABLES_MAX = 40;
const NATURES = ["manuelle", "automatique", "sequence", "auto_registre", "boutique"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VARIABLE = /^\{\{[A-Z0-9_]+\}\}$/;

/** Texte d'une entrée de la requête ('' si ce n'est pas du texte). */
const texte = (v: unknown): string => (typeof v === "string" ? v : "");

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400, req);
  }

  // 1. Organisation exigée (sans elle l'aide partagée choisirait la première organisation de l'appelant), puis membre
  //    org_admin de CETTE organisation (401 / 403 de l'aide partagée).
  if (!UUID.test(texte(body.org_id))) return jsonResponse({ data: null, error: "service_indisponible" }, 200, req);
  const auth = await requireOrgMembership(req, { orgId: texte(body.org_id), requiredRole: "org_admin" });
  if (!auth.ok) return auth.response;
  const { orgId, userId, supabase } = auth;

  const refus = (code: string) => jsonResponse({ data: null, error: code }, 200, req);

  try {
    // 2. Module Communication ; les réglages sont ceux de l'organisation validée (lus ici, jamais reçus).
    const { data: org, error: errOrg } = await supabase
      .schema("core").from("organizations").select("settings").eq("id", orgId).single();
    if (errOrg || !org) {
      console.error(`[mailing-rediger] réglages illisibles : ${sanitizeError(errOrg, "organisation introuvable")}`);
      return refus("service_indisponible");
    }
    const reglages = (org.settings as Record<string, unknown> | null) ?? {};
    if (!moduleActif(reglages, "communication")) return refus("module_communication_inactif");

    // 3. Demande valide, puis bornée.
    const consigne = texte(body.consigne);
    const intention = texte(body.intention);
    const objet = texte(body.objet);
    const corps = texte(body.corps);
    // Tailles d'abord : `validerDemande` lit tout le texte, rien n'est dépensé sur une demande démesurée.
    if (intention.length > INTENTION_MAX || objet.length > OBJET_MAX || corps.length > CORPS_MAX) return refus("demande_trop_longue");
    const invalide = validerDemande({ consigne, intention, corps });
    if (invalide) return refus(invalide);
    const nature = NATURES.includes(texte(body.nature)) ? texte(body.nature) : "manuelle";

    // Variables : celles que l'écran propose (bien formées, 40 au plus) ET celles déjà présentes dans le texte à
    // retravailler ; adresses : le catalogue de l'entreprise ET celles déjà présentes dans le texte (sinon retoucher
    // un texte détruirait son lien de désinscription).
    const proposees = (Array.isArray(body.variables) ? body.variables : [])
      .filter((v): v is string => typeof v === "string" && VARIABLE.test(v)).slice(0, VARIABLES_MAX);
    const variables = [...new Set([...proposees, ...variablesDe(corps)])];
    const adresses = [...new Set([...adressesAutorisees(reglages), ...adressesDuTexte(corps)])];
    const entreprise = {
      nom: texte(reglages.brand_name),
      site: texte(reglages.website_url),
    };
    const { system, user } = construireConsigne({ consigne, intention, objet, corps, nature, variables, entreprise, adresses });

    // 4. Secret présent.
    if (!ANTHROPIC_API_KEY) {
      console.error("[mailing-rediger] ANTHROPIC_API_KEY absent");
      return refus("service_indisponible");
    }

    // 5. Plafond du jour : consommé seulement ici, une fois tout le reste accepté.
    const { error: errPlafond } = await supabase.rpc("increment_mailing_redaction_quota", {
      p_user_id: userId, p_org_id: orgId, p_daily_limit: LIMITE_JOUR,
    });
    if (errPlafond) {
      if (errPlafond.code === "P0001") return refus("plafond_atteint");
      console.error(`[mailing-rediger] plafond illisible : ${sanitizeError(errPlafond, "erreur du plafond")}`);
      return refus("service_indisponible");
    }

    // 6. Appel. Format de sortie strict (schéma sans type union). Seule la consigne construite part au modèle.
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), DUREE_IA_MS);
    // deno-lint-ignore no-explicit-any
    let final: any;
    try {
      // deno-lint-ignore no-explicit-any
      const params: any = {
        model: MODEL, max_tokens: MAX_TOKENS,
        // rédiger un court e-mail : effort bas ; format strict (forme éprouvée en production : supplier-offer-import)
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA_REDACTION } },
        system,
        messages: [{ role: "user", content: user }],
      };
      final = await client.messages.stream(params, { signal: ctrl.signal }).finalMessage();
    } catch (e) {
      console.error(`[mailing-rediger] appel au modèle en échec${ctrl.signal.aborted ? " (délai dépassé)" : ""} : ${sanitizeError(e, "erreur du modèle")}`);
      return refus("service_indisponible");
    } finally {
      clearTimeout(minuterie);
    }
    // Consommation journalisée (jamais un texte).
    const u = final?.usage || {};
    console.log("[mailing-rediger] conso", JSON.stringify({
      org: orgId, consigne, modele: final?.model ?? MODEL, stop: final?.stop_reason,
      input_tokens: u.input_tokens || 0, output_tokens: u.output_tokens || 0,
    }));

    // 7. Réponse contrôlée : rien n'atteint l'écran sans passer par `lireReponse`.
    if (final?.stop_reason !== "end_turn") return refus("reponse_illisible"); // refus, coupure à max_tokens…
    // deno-lint-ignore no-explicit-any
    const brut = (final?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const reponse = lireReponse(brut, { consigne, variables, adresses });
    if (!reponse) return refus("reponse_illisible");
    return jsonResponse({ data: reponse, error: null }, 200, req);
  } catch (err) {
    console.error(`[mailing-rediger] erreur : ${sanitizeError(err, "mailing-rediger failed")}`);
    return refus("service_indisponible");
  }
});
