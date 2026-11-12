// dpe-lien — le Logement MonsieurDPE de la fiche client (corpus des DPE, carte du logement, rapport complet).
// Specs : docs/superpowers/specs/2026-11-11-lien-monsieurdpe-fiche-client-design.md (infrastructure)
//         docs/superpowers/specs/2026-11-12-logement-monsieurdpe-fiche-client-design.md (refonte)
//
// verify_jwt:true + requireOrgMembership + module `dpe` actif + user_can(clients, edit). Actions FERMÉES, aucun
// relais générique : la route SQL libre du corpus (POST /requete) n'est jamais appelée ; l'adresse, le numéro et
// l'e-mail du client sont relus EN BASE, jamais pris du corps de la requête.
//
//   - rattacher  { client_id }                     géocode l'adresse (IGN), DPE du bâtiment, règle automatique
//                                                  (regles.js::decisionRattachement), enregistre la tentative.
//   - choisir    { client_id, numero, voisinage? } un humain choisit un DPE (candidat ou voisinage).
//   - detacher   { client_id }                     « Ce n'est pas le bon » : numéro écarté, fiche vidée.
//   - actualiser { client_id }                     relit la carte du numéro de la fiche (saisi si le numéro a changé).
//   - verifier   { numero }                        ce numéro est-il dans le corpus ? (sans écriture)
//   - ouvrir     { client_id, forcer? }            lien du rapport complet (émis une fois par org × numéro).
//   - envoyer    { client_id }                     e-mail au client, PDF du rapport complet en pièce jointe.
//
// Toutes les écritures passent par la RPC client_dpe_record (service_role), qui tient clients.dpe_number cohérent
// et refuse qu'un rattachement automatique remplace un numéro posé par un humain.
//
// Réponses : HTTP 200 { data, error } où `error` est un CODE (regles.js::CODES), traduit côté écran. Les refus
// d'authentification gardent leurs 401/403.
//
// Secrets : MDH_DPE_CORPUS_URL, MDH_DPE_CORPUS_SECRET, MDH_DPE_SITE_URL, MDH_DPE_PARTENAIRE_SECRET, RESEND_API_KEY.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireOrgMembership, jsonResponse, buildCorsHeaders, sanitizeError } from "../_shared/auth.ts";
import {
  orgBranding, brandingReplacements, wrapWithSkeleton, applyPlaceholders, escapeHtml,
  sendResendEmail, insertMailingLog, arrayBufferToBase64,
} from "../_shared/mail.ts";
import { mapCorpusDossier, colonnesFiltrables, VERSION_CARTE } from "../_shared/dpeCorpus.js";
import { adresseNormalisee } from "../_shared/dpeLien.js";
import { DPE_RAPPORT_EMAIL_TEMPLATE_KEY } from "../_shared/dpeRapportEmailTemplate.js";
import {
  numeroValide, adresseDeRecherche, codeDepuisCorpus, resumeDossier, rapportCompletPossible, projeterCandidat,
  decisionRattachement, controleNumero, cleBatiment, cleBanAdeme,
} from "./regles.js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const CORPUS_URL = (Deno.env.get("MDH_DPE_CORPUS_URL") || "").replace(/\/+$/, "");
const CORPUS_SECRET = Deno.env.get("MDH_DPE_CORPUS_SECRET") || "";
const SITE_URL = (Deno.env.get("MDH_DPE_SITE_URL") || "").replace(/\/+$/, "");
const PARTENAIRE_SECRET = Deno.env.get("MDH_DPE_PARTENAIRE_SECRET") || "";
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") || "";

const GEOCODAGE_URL = "https://data.geopf.fr/geocodage/search";
/** Fichier public ADEME des DPE de logements existants (même jeu que la recherche « DPE publics » de la fiche). */
const ADEME_DPE_URL = "https://data.ademe.fr/data-fair/api/v1/datasets/meg-83tjwtg8dyz4vv7h1dqe/lines";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DELAI_MS = 10_000;
/** Le PDF du rapport complet se fabrique à la demande chez MonsieurDPE (maxDuration 60 s côté site). */
const DELAI_PDF_MS = 90_000;
/** Plafond de la pièce jointe (Resend : 40 Mo APRÈS base64, soit ~30 Mo bruts). */
const PDF_MAX_OCTETS = 25 * 1024 * 1024;

type Corps = { data: unknown; error: string | null };
type Client = {
  id: string; address: string | null; postal_code: string | null; city: string | null;
  dpe_number: string | null; email: string | null; display_name: string | null;
};

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

/** Géocodage IGN de l'adresse du client. `undefined` = panne ; `null` = adresse non trouvée. */
async function geocoder(adresse: string): Promise<{ score: number; type: string; cle_ban: string } | null | undefined> {
  try {
    const r = await fetch(`${GEOCODAGE_URL}?q=${encodeURIComponent(adresse)}&limit=1`, { signal: AbortSignal.timeout(DELAI_MS) });
    if (!r.ok) {
      console.error(`[dpe-lien] géocodage HTTP ${r.status}`);
      return undefined;
    }
    const p = (await r.json())?.features?.[0]?.properties;
    if (!p || typeof p.id !== "string") return null;
    return { score: Number(p.score), type: String(p.type || ""), cle_ban: p.id };
  } catch (e) {
    console.error(`[dpe-lien] géocodage injoignable : ${sanitizeError(e, "erreur réseau")}`);
    return undefined;
  }
}

/**
 * Clé BAN propre à un DPE (ADEME `identifiant_ban`), condition du rattachement automatique. Ne lève jamais :
 * une panne ADEME ou un DPE absent du fichier rend `null`, donc un candidat à confirmer, jamais un rattachement.
 */
async function cleBanDuDpe(numero: string): Promise<string | null> {
  try {
    const qs = encodeURIComponent(`numero_dpe:"${numero}"`);
    const r = await fetch(`${ADEME_DPE_URL}?qs=${qs}&select=identifiant_ban&size=1`, { signal: AbortSignal.timeout(DELAI_MS) });
    if (!r.ok) {
      console.error(`[dpe-lien] ADEME HTTP ${r.status}`);
      return null;
    }
    return cleBanAdeme(await r.json().catch(() => null));
  } catch (e) {
    console.error(`[dpe-lien] ADEME injoignable : ${sanitizeError(e, "erreur réseau")}`);
    return null;
  }
}

/** Le patch de carte pour client_dpe_record, depuis la réponse de GET /dossier/{numero}. */
function patchCarte(data: Record<string, unknown> | null): Record<string, unknown> {
  const record = mapCorpusDossier(data);
  if (!record) return {};
  return { ...colonnesFiltrables(record), carte: record, version_carte: VERSION_CARTE };
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
    const settings = ((org?.settings as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const modules = (settings.modules ?? {}) as Record<string, unknown>;
    if (modules.dpe !== true) return refus("module_ferme");

    // Client au jeton de l'utilisateur : la RLS protège toutes les lectures de la fiche.
    const user = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: autorise, error: errDroit } = await user.rpc("user_can", { p_org_id: orgId, p_resource: "clients", p_action: "edit" });
    if (errDroit || autorise !== true) return refus("droit_requis");

    /** Le client, relu en base et dans l'organisation de l'appelant (clients.org_id = org CORE). */
    const lireClient = async (): Promise<Client | null> => {
      const clientId = typeof body.client_id === "string" ? body.client_id : "";
      if (!UUID.test(clientId)) return null;
      const { data, error } = await user.from("majordhome_clients")
        .select("id, address, postal_code, city, dpe_number, email, display_name")
        .eq("id", clientId).eq("org_id", orgId).maybeSingle();
      if (error) throw error;
      return data as Client | null;
    };
    const lireLigne = async (clientId: string) => {
      const { data, error } = await auth.supabase.from("majordhome_client_dpe")
        .select("dpe_number, origine, ecartes, rapport_complet, etiquette_dpe")
        .eq("client_id", clientId).eq("org_id", orgId).maybeSingle();
      if (error) throw error;
      return data as { dpe_number: string | null; origine: string | null; ecartes: string[] | null; rapport_complet: boolean | null; etiquette_dpe: string | null } | null;
    };
    /** Écriture unique : la RPC tient clients.dpe_number cohérent. Rend la ligne, ou un code d'erreur. */
    const enregistrer = async (clientId: string, act: string, patch: Record<string, unknown>) => {
      const { data, error } = await auth.supabase.rpc("client_dpe_record", {
        p_org_id: orgId, p_client_id: clientId, p_action: act, p_patch: patch, p_user: auth.userId,
      });
      if (error) {
        const m = String(error.message || "");
        if (m.includes("client_dpe_saisi_protege")) return { code: "numero_protege" as const, ligne: null };
        if (m.includes("client_dpe_numero_ecarte")) return { code: "numero_ecarte" as const, ligne: null };
        console.error(`[dpe-lien] client_dpe_record (${act}) refusée : ${sanitizeError(error, "erreur base")}`);
        return { code: "enregistrement_impossible" as const, ligne: null };
      }
      return { code: null, ligne: data };
    };
    const reponseEcriture = (r: { code: string | null; ligne: unknown }) => (r.code ? refus(r.code) : ok(r.ligne));

    /** Émet (ou relit) le lien du rapport complet pour ce numéro. */
    const lienRapport = async (client: Client, numero: string, forcer: boolean) => {
      if (!forcer) {
        const { data: existant, error: errLecture } = await auth.supabase.from("majordhome_dpe_report_accesses")
          .select("report_url, token").eq("org_id", orgId).eq("dpe_number", numero).maybeSingle();
        if (errLecture) return { code: "enregistrement_impossible", url: null, jeton: null, dejaEmis: false };
        if (existant?.report_url) return { code: null, url: existant.report_url as string, jeton: existant.token as string, dejaEmis: true };
      }
      if (!SITE_URL || !PARTENAIRE_SECRET) {
        console.error("[dpe-lien] MDH_DPE_SITE_URL ou MDH_DPE_PARTENAIRE_SECRET absent");
        return { code: "partenaire_indisponible", url: null, jeton: null, dejaEmis: false };
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
        if (corps?.error === "numero_absent" || corps?.error === "numero_mal_forme" || corps?.error === "sans_rapport_complet") {
          return { code: corps.error, url: null, jeton: null, dejaEmis: false };
        }
        if (!r.ok || !corps?.data) {
          console.error(`[dpe-lien] porte partenaire HTTP ${r.status} (${corps?.error ?? "sans code"})`);
          return { code: "partenaire_indisponible", url: null, jeton: null, dejaEmis: false };
        }
        emis = corps.data;
      } catch (e) {
        console.error(`[dpe-lien] porte partenaire injoignable : ${sanitizeError(e, "erreur réseau")}`);
        return { code: "partenaire_indisponible", url: null, jeton: null, dejaEmis: false };
      }
      if (!emis?.jeton || !emis?.url) return { code: "partenaire_indisponible", url: null, jeton: null, dejaEmis: false };
      const { error: errEcriture } = await auth.supabase.rpc("dpe_report_access_record", {
        p_org_id: orgId, p_client_id: client.id, p_dpe_number: numero,
        p_token: emis.jeton, p_report_url: emis.url, p_issued_by: auth.userId,
      });
      if (errEcriture) {
        console.error(`[dpe-lien] dpe_report_access_record refusée : ${sanitizeError(errEcriture, "erreur base")}`);
        return { code: "enregistrement_impossible", url: null, jeton: null, dejaEmis: false };
      }
      return { code: null, url: emis.url, jeton: emis.jeton, dejaEmis: false };
    };

    // ------------------------------------------------------------------ rattacher
    if (action === "rattacher") {
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const adresse = adresseDeRecherche(client);
      const adresseTentee = adresseNormalisee(client);
      if (!adresse || !adresseTentee) return refus("adresse_incomplete");
      const ligne = await lireLigne(client.id);
      const ecartes = ligne?.ecartes || [];

      const geocodage = await geocoder(adresse);
      if (geocodage === undefined) {
        return reponseEcriture(await enregistrer(client.id, "tentative", { etat: "erreur", adresse_tentee: adresseTentee }));
      }
      let candidats: unknown[] = [];
      let dossierUnique: Record<string, unknown> | null = null;
      let cleBanDpe: string | null = null;
      // Pas de clé de bâtiment (lieu-dit, rue sans numéro) : on n'interroge pas le corpus, qui refuserait une clé
      // de rue — la décision rend « adresse non trouvée », jamais une panne.
      const cle = cleBatiment(geocodage);
      if (cle) {
        const b = await corpus(`/dossier-batiment?cle_ban=${encodeURIComponent(cle)}`);
        if (b.code) {
          return reponseEcriture(await enregistrer(client.id, "tentative", { etat: "erreur", adresse_tentee: adresseTentee }));
        }
        candidats = Array.isArray(b.data?.dpe) ? (b.data?.dpe as unknown[]) : [];
        const restants = candidats.map(projeterCandidat).filter((c) => c && numeroValide(c.identifiant_dpe) && !ecartes.includes(c.identifiant_dpe as string));
        if (restants.length === 1) {
          const numero = restants[0]!.identifiant_dpe as string;
          const d = await corpus(`/dossier/${encodeURIComponent(numero)}`);
          dossierUnique = d.code ? null : d.data;
          if (dossierUnique) cleBanDpe = await cleBanDuDpe(numero);
        }
      }
      const decision = decisionRattachement({ geocodage, candidats, dossierUnique, ecartes, cleBanDpe });
      const patch: Record<string, unknown> = { etat: decision.etat, adresse_tentee: adresseTentee, candidats: decision.candidats };
      if (decision.etat === "rattache") Object.assign(patch, { dpe_number: decision.numero }, patchCarte(dossierUnique));
      return reponseEcriture(await enregistrer(client.id, "tentative", patch));
    }

    // ------------------------------------------------------------------ choisir
    if (action === "choisir") {
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const numero = typeof body.numero === "string" ? body.numero.trim().toUpperCase() : "";
      if (!numeroValide(numero)) return refus("numero_mal_forme");
      const d = await corpus(`/dossier/${encodeURIComponent(numero)}`);
      if (d.code) return refus(d.code);
      return reponseEcriture(await enregistrer(client.id, "choisir", {
        dpe_number: numero, voisinage: body.voisinage === true, adresse_tentee: adresseNormalisee(client), ...patchCarte(d.data),
      }));
    }

    // ------------------------------------------------------------------ detacher
    if (action === "detacher") {
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const ecart = controleNumero({ numeroFiche: client.dpe_number, ligne: await lireLigne(client.id) });
      if (ecart) return refus(ecart);
      return reponseEcriture(await enregistrer(client.id, "detacher", {}));
    }

    // ------------------------------------------------------------------ actualiser
    if (action === "actualiser") {
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const ligne = await lireLigne(client.id);
      const numero = (client.dpe_number || "").trim().toUpperCase();
      // Un numéro qui n'est pas celui de la ligne a été tapé dans la fiche : c'est une saisie humaine.
      const origine = numero && numero === (ligne?.dpe_number || "") ? (ligne?.origine || "saisi") : "saisi";
      if (!numero) return reponseEcriture(await enregistrer(client.id, "actualiser", { origine, adresse_tentee: adresseNormalisee(client) }));
      if (!numeroValide(numero)) return refus("numero_mal_forme");
      const d = await corpus(`/dossier/${encodeURIComponent(numero)}`);
      if (d.code === "numero_absent" || d.code === "corpus_indisponible") {
        // Le numéro reste rattaché sans carte, avec la raison : l'écran l'affiche et ne relance pas avant une heure.
        return reponseEcriture(await enregistrer(client.id, "actualiser", {
          dpe_number: numero, origine, adresse_tentee: adresseNormalisee(client), carte_erreur: d.code,
        }));
      }
      if (d.code) return refus(d.code);
      return reponseEcriture(await enregistrer(client.id, "actualiser", {
        dpe_number: numero, origine, adresse_tentee: adresseNormalisee(client), ...patchCarte(d.data),
      }));
    }

    // ------------------------------------------------------------------ verifier (sans écriture)
    if (action === "verifier") {
      const numero = typeof body.numero === "string" ? body.numero.trim() : "";
      if (!numeroValide(numero)) return refus("numero_mal_forme");
      const r = await corpus(`/dossier/${encodeURIComponent(numero)}`);
      if (r.code === "numero_absent") return ok({ present: false, rapport_complet: false, resume: null });
      if (r.code) return refus(r.code);
      return ok({
        present: true,
        rapport_complet: rapportCompletPossible(r.data),
        resume: resumeDossier((r.data?.dossier ?? null) as Record<string, unknown> | null),
      });
    }

    // ------------------------------------------------------------------ ouvrir
    if (action === "ouvrir") {
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const numero = (client.dpe_number || "").trim().toUpperCase();
      if (!numeroValide(numero)) return refus(numero ? "numero_mal_forme" : "client_sans_numero");
      const ecart = controleNumero({ numeroFiche: numero, ligne: await lireLigne(client.id), rapportRequis: true });
      if (ecart) return refus(ecart);
      const lien = await lienRapport(client, numero, body.forcer === true);
      if (lien.code) return refus(lien.code);
      return ok({ url: lien.url, numero, deja_emis: lien.dejaEmis });
    }

    // ------------------------------------------------------------------ envoyer
    if (action === "envoyer") {
      if (modules.communication !== true) return refus("module_communication_inactif");
      if (!RESEND_API_KEY) {
        console.error("[dpe-lien] RESEND_API_KEY absent");
        return refus("resend_failed");
      }
      const branding = orgBranding(settings);
      if (!branding.fromEmail) return refus("no_from_email");
      const client = await lireClient();
      if (!client) return refus("client_introuvable");
      const to = (client.email || "").trim();
      if (!to) return refus("client_sans_email");
      const numero = (client.dpe_number || "").trim().toUpperCase();
      const ligne = await lireLigne(client.id);
      // Le rapport envoyé est celui du numéro annoncé à l'écran, et seulement s'il existe (NULL refusé).
      const ecart = controleNumero({ numeroFiche: numero, ligne, rapportRequis: true });
      if (ecart) return refus(ecart);

      const { data: gabarit, error: errGabarit } = await auth.supabase.from("majordhome_mail_campaigns")
        .select("subject, html_body").eq("org_id", orgId).eq("key", DPE_RAPPORT_EMAIL_TEMPLATE_KEY).eq("is_archived", false)
        .maybeSingle();
      if (errGabarit) return jsonResponse({ error: sanitizeError(errGabarit, "lecture du gabarit") }, 500, req);
      if (!gabarit) return refus("template_missing");

      const lien = await lienRapport(client, numero, false);
      if (lien.code || !lien.url || !lien.jeton) return refus(lien.code || "partenaire_indisponible");

      // Le PDF du rapport complet, fabriqué par MonsieurDPE pour ce jeton (sans entreprises RGE : accès partenaire).
      let pdf: ArrayBuffer;
      try {
        const r = await fetch(
          `${SITE_URL}/api/pdf/rapport-complet?numero=${encodeURIComponent(numero)}&acces=${encodeURIComponent(lien.jeton)}`,
          { signal: AbortSignal.timeout(DELAI_PDF_MS) },
        );
        if (!r.ok) {
          console.error(`[dpe-lien] PDF du rapport HTTP ${r.status}`);
          return refus("pdf_indisponible");
        }
        pdf = await r.arrayBuffer();
      } catch (e) {
        console.error(`[dpe-lien] PDF du rapport injoignable : ${sanitizeError(e, "erreur réseau")}`);
        return refus("pdf_indisponible");
      }
      const entete = new TextDecoder().decode(new Uint8Array(pdf.slice(0, 5)));
      if (entete !== "%PDF-" || pdf.byteLength > PDF_MAX_OCTETS) {
        console.error(`[dpe-lien] PDF du rapport invalide (${entete}, ${pdf.byteLength} octets)`);
        return refus("pdf_indisponible");
      }

      const remplacements: Record<string, string> = {
        ...brandingReplacements(branding),
        "{{CLIENT_NAME}}": client.display_name || "",
        "{{LIEN_RAPPORT}}": lien.url,
        "{{NUMERO_DPE}}": numero,
        "{{ETIQUETTE_DPE}}": ligne?.etiquette_dpe || "",
      };
      const html: Record<string, string> = { ...remplacements };
      for (const cle of ["{{CLIENT_NAME}}", "{{BRAND_NAME}}", "{{ORG_EMAIL}}", "{{ORG_PHONE}}", "{{ORG_ADDRESS}}", "{{ORG_POSTAL_CODE}}", "{{ORG_CITY}}"]) {
        if (cle in html) html[cle] = escapeHtml(html[cle]);
      }
      const subject = applyPlaceholders(gabarit.subject || "", remplacements);
      const corpsHtml = applyPlaceholders(wrapWithSkeleton(branding, gabarit.html_body || ""), html);
      const from = branding.fromName ? `${branding.fromName} <${branding.fromEmail}>` : branding.fromEmail;
      const resultat = await sendResendEmail(RESEND_API_KEY, {
        from, to: [to], replyTo: branding.replyTo, subject, html: corpsHtml,
        attachments: [{ filename: `Analyse-logement-MonsieurDPE-${numero}.pdf`, content: arrayBufferToBase64(pdf) }],
      });
      const avertissement = await insertMailingLog(auth.supabase, {
        client_id: client.id, org_id: orgId, campaign_name: DPE_RAPPORT_EMAIL_TEMPLATE_KEY, subject, email_to: to,
        status: resultat.ok ? "sent" : "failed", provider_id: resultat.id, error_message: resultat.message,
      });
      if (avertissement) console.error(`[dpe-lien] mailing_logs : ${avertissement}`);
      if (!resultat.ok) {
        console.error(`[dpe-lien] Resend a refusé l'envoi : ${resultat.status} ${resultat.message}`);
        return refus("resend_failed");
      }
      return ok({ to, numero, provider_id: resultat.id });
    }

    return refus("action_inconnue");
  } catch (e) {
    return jsonResponse({ error: sanitizeError(e, "erreur interne") }, 500, req);
  }
});
