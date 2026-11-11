// dpe-lien — le lien entre la fiche client et MonsieurDPE (corpus des DPE + rapport complet).
// Spec : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md
//
// verify_jwt:true + requireOrgMembership + module `dpe` actif + user_can(clients, edit). Trois actions FERMÉES,
// aucun relais générique : la route SQL libre du corpus (POST /requete) n'est jamais appelée, et aucune URL
// sortante n'est composée depuis le corps de la requête (l'adresse et le numéro sont relus en base).
//
//   - chercher : { org_id, client_id } → les DPE rattachés au bâtiment de l'adresse du client (GET /dossier-batiment).
//                Rien n'est enregistré : un humain confirme le DPE, jamais la machine.
//   - verifier : { org_id, numero }    → ce numéro est-il dans le corpus ? (GET /dossier/{numero})
//   - ouvrir   : { org_id, client_id } → le lien du rapport complet MonsieurDPE pour le dpe_number du client.
//                Émis une fois par (org, numéro) par la porte partenaire du site, puis relu en base.
//
// Réponses : HTTP 200 { data, error } où `error` est un CODE (regles.js::CODES), traduit côté écran. Les refus
// d'authentification gardent leurs 401/403.
//
// Secrets : MDH_DPE_CORPUS_URL, MDH_DPE_CORPUS_SECRET, MDH_DPE_SITE_URL, MDH_DPE_PARTENAIRE_SECRET.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import { numeroValide, adresseDeRecherche, codeDepuisCorpus, resumeDossier } from "./regles.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const CORPUS_URL = (Deno.env.get("MDH_DPE_CORPUS_URL") || "").replace(/\/+$/, "");
const CORPUS_SECRET = Deno.env.get("MDH_DPE_CORPUS_SECRET") || "";
const SITE_URL = (Deno.env.get("MDH_DPE_SITE_URL") || "").replace(/\/+$/, "");
const PARTENAIRE_SECRET = Deno.env.get("MDH_DPE_PARTENAIRE_SECRET") || "";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELAI_MS = 10_000;

type Corps = { data: unknown; error: string | null };

/** GET sur le corpus. Ne lève jamais : une panne se lit `corpus_indisponible`. */
async function corpus(chemin: string): Promise<{ code: string | null; data: Record<string, unknown> | null }> {
  if (!CORPUS_URL || !CORPUS_SECRET) {
    console.error("[dpe-lien] MDH_DPE_CORPUS_URL ou MDH_DPE_CORPUS_SECRET absent");
    return { code: "corpus_indisponible", data: null };
  }
  try {
    const r = await fetch(`${CORPUS_URL}${chemin}`, {
      headers: { "x-corpus-secret": CORPUS_SECRET },
      signal: AbortSignal.timeout(DELAI_MS),
    });
    const corps = (await r.json().catch(() => null)) as Corps | null;
    const code = codeDepuisCorpus(r.status, corps?.error ?? null);
    if (code) {
      if (code === "corpus_indisponible") console.error(`[dpe-lien] corpus HTTP ${r.status} sur ${chemin.split("?")[0]}`);
      return { code, data: null };
    }
    return { code: null, data: (corps?.data ?? null) as Record<string, unknown> | null };
  } catch (e) {
    console.error(`[dpe-lien] corpus injoignable : ${sanitizeError(e, "erreur réseau")}`);
    return { code: "corpus_indisponible", data: null };
  }
}

Deno.serve(async (req) => {
  const cors = buildCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, req);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const orgId = typeof body.org_id === "string" ? body.org_id : "";
  const action = typeof body.action === "string" ? body.action : "";
  if (!UUID.test(orgId)) return jsonResponse({ error: "org_id requis" }, 400, req);

  const auth = await requireOrgMembership(req, { orgId });
  if (!auth.ok) return auth.response;

  const ok = (data: unknown) => jsonResponse({ data, error: null }, 200, req);
  const refus = (code: string) => jsonResponse({ data: null, error: code }, 200, req);

  try {
    // Module de l'offre : ouvert par organisation (Baikal). Garde positive : tout sauf `true` ferme.
    const { data: org, error: errOrg } = await auth.supabase.schema("core").from("organizations")
      .select("name, settings").eq("id", orgId).maybeSingle();
    if (errOrg) return jsonResponse({ error: sanitizeError(errOrg, "lecture de l'organisation impossible") }, 500, req);
    const modules = ((org?.settings as Record<string, unknown> | null)?.modules ?? {}) as Record<string, unknown>;
    if (modules.dpe !== true) return refus("module_ferme");

    // Client au jeton de l'utilisateur : la RLS protège toutes les lectures de la fiche.
    const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: autorise, error: errDroit } = await user.rpc("user_can", { p_org_id: orgId, p_resource: "clients", p_action: "edit" });
    if (errDroit || autorise !== true) return refus("droit_requis");

    /** Le client, relu en base et dans l'organisation de l'appelant (clients.org_id = org CORE). */
    const lireClient = async () => {
      const clientId = typeof body.client_id === "string" ? body.client_id : "";
      if (!UUID.test(clientId)) return null;
      const { data, error } = await user.from("majordhome_clients")
        .select("id, address, postal_code, city, dpe_number")
        .eq("id", clientId).eq("org_id", orgId).maybeSingle();
      if (error) throw error;
      return data as { id: string; address: string | null; postal_code: string | null; city: string | null; dpe_number: string | null } | null;
    };

    if (action === "chercher") {
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const adresse = adresseDeRecherche(client);
      if (!adresse) return refus("adresse_incomplete");
      const r = await corpus(`/dossier-batiment?adresse=${encodeURIComponent(adresse)}`);
      if (r.code) return refus(r.code);
      const d = r.data || {};
      return ok({
        adresse: d.adresse ?? null,
        batiment_trouve: d.batiment != null,
        candidats: Array.isArray(d.dpe) ? d.dpe : [],
      });
    }

    if (action === "verifier") {
      const numero = typeof body.numero === "string" ? body.numero.trim() : "";
      if (!numeroValide(numero)) return refus("numero_mal_forme");
      const r = await corpus(`/dossier/${encodeURIComponent(numero)}`);
      if (r.code === "numero_absent") return ok({ present: false, resume: null });
      if (r.code) return refus(r.code);
      return ok({ present: true, resume: resumeDossier((r.data?.dossier ?? null) as Record<string, unknown> | null) });
    }

    if (action === "ouvrir") {
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const numero = (client.dpe_number || "").trim();
      if (!numero) return refus("client_sans_numero");
      if (!numeroValide(numero)) return refus("numero_mal_forme");

      // Déjà émis pour cette organisation : on relit, MonsieurDPE n'est pas rappelé.
      const { data: existant, error: errLecture } = await auth.supabase.from("majordhome_dpe_report_accesses")
        .select("report_url").eq("org_id", orgId).eq("dpe_number", numero).maybeSingle();
      if (errLecture) return refus("enregistrement_impossible");
      if (existant?.report_url) return ok({ url: existant.report_url, numero, deja_emis: true });

      if (!SITE_URL || !PARTENAIRE_SECRET) {
        console.error("[dpe-lien] MDH_DPE_SITE_URL ou MDH_DPE_PARTENAIRE_SECRET absent");
        return refus("partenaire_indisponible");
      }
      let emis: { jeton?: string; url?: string } | null = null;
      try {
        const r = await fetch(`${SITE_URL}/api/partenaire/acces`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-dpe-partenaire-secret": PARTENAIRE_SECRET },
          body: JSON.stringify({ numero, org_id: orgId, org_libelle: (org?.name as string | undefined) || "Organisation Majord'home" }),
          signal: AbortSignal.timeout(DELAI_MS),
        });
        const corps = (await r.json().catch(() => null)) as { data: { jeton?: string; url?: string } | null; error: string | null } | null;
        if (corps?.error === "numero_absent") return refus("numero_absent");
        if (corps?.error === "numero_mal_forme") return refus("numero_mal_forme");
        if (!r.ok || !corps?.data) {
          console.error(`[dpe-lien] porte partenaire HTTP ${r.status} (${corps?.error ?? "sans code"})`);
          return refus("partenaire_indisponible");
        }
        emis = corps.data;
      } catch (e) {
        console.error(`[dpe-lien] porte partenaire injoignable : ${sanitizeError(e, "erreur réseau")}`);
        return refus("partenaire_indisponible");
      }
      if (!emis?.jeton || !emis?.url) return refus("partenaire_indisponible");

      const { error: errEcriture } = await auth.supabase.rpc("dpe_report_access_record", {
        p_org_id: orgId,
        p_client_id: client.id,
        p_dpe_number: numero,
        p_token: emis.jeton,
        p_report_url: emis.url,
        p_issued_by: auth.userId,
      });
      if (errEcriture) {
        console.error(`[dpe-lien] enregistrement refusé : ${sanitizeError(errEcriture, "erreur base")}`);
        return refus("enregistrement_impossible");
      }
      return ok({ url: emis.url, numero, deja_emis: false });
    }

    return refus("action_inconnue");
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "erreur interne") }, 500, req);
  }
});
