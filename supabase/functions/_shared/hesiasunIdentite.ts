// supabase/functions/_shared/hesiasunIdentite.ts
// ============================================================================
// Envoi de l'identité d'une entreprise à HésiaSun — cœur partagé par l'edge `hesiasun-identite`
// (écran, jeton de l'utilisateur) et `hesiasun-identite-cron` (rejeu horaire). Un seul endroit appelle
// l'API de HésiaSun. Les règles (corps de l'envoi, lecture des réponses, état) sont dans le module pur
// _shared/organisation/liaisonHesiasun.js, copie de src/lib/organisation/liaisonHesiasun.js.
//
// L'adresse de HésiaSun vient du secret MDH_HESIASUN_URL, jamais d'une requête. La clé d'API de
// l'entreprise est lue au coffre (org_secret_read, service_role) et n'est ni journalisée ni renvoyée.
// L'identité envoyée est relue EN BASE (core.organizations.settings), jamais prise d'une requête.
// ============================================================================
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  CLE_COFFRE,
  COMPARTIMENT_LOGO,
  LOGO_MAX_OCTETS,
  codeReponseLogo,
  corpsEnvoi,
  gesteLogo,
  etatApresEnvoi,
  etatRompu,
  lireEtatLiaison,
  lireReponseHesiasun,
} from "./organisation/liaisonHesiasun.js";

const DELAI_MS = 15_000;

// deno-lint-ignore no-explicit-any
export type Etat = any;
export type Resultat =
  | { ok: true; etat: Etat; data?: unknown }
  | { ok: false; code: string; champs?: Record<string, string>; etat?: Etat };

const refus = (code: string, plus: Partial<Resultat> = {}): Resultat => ({ ok: false, code, ...plus } as Resultat);

/** Adresse de l'API HésiaSun (« https://…/api/v1 »), ou null si la plateforme n'est pas configurée. */
export function baseHesiasun(): string | null {
  const brut = (Deno.env.get("MDH_HESIASUN_URL") || "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/[a-z0-9.-]+(\/[a-z0-9/_-]*)?$/i.test(brut)) return null;
  return brut.endsWith("/api/v1") ? brut : `${brut}/api/v1`;
}

/** Un appel à l'API HésiaSun. Jamais d'exception : statut 0 quand rien ne répond. */
export async function appelerHesiasun(
  methode: "GET" | "PUT" | "DELETE",
  chemin: string,
  cle: string,
  corps?: unknown,
): Promise<{ statut: number; json: unknown }> {
  const base = baseHesiasun();
  if (!base) return { statut: 0, json: null };
  try {
    const res = await fetch(`${base}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${cle}`, ...(corps ? { "Content-Type": "application/json" } : {}) },
      body: corps ? JSON.stringify(corps) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(DELAI_MS),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    return { statut: res.status, json };
  } catch {
    return { statut: 0, json: null };
  }
}

/** Envoi d'une image (corps = les octets). Jamais d'exception : statut 0 quand rien ne répond. */
async function appelerHesiasunImage(chemin: string, cle: string, octets: Uint8Array, type: string): Promise<{ statut: number; json: unknown }> {
  const base = baseHesiasun();
  if (!base) return { statut: 0, json: null };
  try {
    const res = await fetch(`${base}${chemin}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${cle}`, "Content-Type": type },
      body: octets,
      redirect: "manual",
      signal: AbortSignal.timeout(DELAI_MS),
    });
    let json: unknown = null;
    try { json = await res.json(); } catch { json = null; }
    return { statut: res.status, json };
  } catch {
    return { statut: 0, json: null };
  }
}

/**
 * Aligne le logo de HésiaSun sur celui de Majord'home, après un envoi d'identité réussi. Le fichier est relu
 * dans NOTRE compartiment (chemin validé par gesteLogo → logoHeberge), jamais à une adresse reçue.
 * Rend les deux champs d'état à noter ; un échec de logo ne défait pas l'envoi de l'identité.
 */
async function alignerLogo(
  admin: SupabaseClient,
  orgId: string,
  reglages: Record<string, unknown>,
  etat: Etat,
  cle: string,
): Promise<{ logo_envoye: string | null; logo_erreur: string | null }> {
  const inchange = { logo_envoye: etat.logo_envoye ?? null, logo_erreur: null };
  const geste = gesteLogo(reglages, etat, { baseStockage: Deno.env.get("SUPABASE_URL") || "", orgId });
  const liaison = `liaison_id=${encodeURIComponent(etat.liaison_id)}`;

  if (geste.geste === "rien") return inchange;
  if (geste.geste === "externe") return { ...inchange, logo_erreur: "logo_externe" };
  if (geste.geste === "retirer") {
    const lu = await appelerHesiasun("DELETE", `/organization/logo?${liaison}`, cle);
    const code = codeReponseLogo(lu.statut, lu.json);
    return code ? { ...inchange, logo_erreur: code } : { logo_envoye: null, logo_erreur: null };
  }

  const { data: fichier, error } = await admin.storage.from(COMPARTIMENT_LOGO).download(geste.chemin as string);
  if (error || !fichier) return { ...inchange, logo_erreur: "logo_illisible" };
  if (fichier.size > LOGO_MAX_OCTETS) return { ...inchange, logo_erreur: "logo_trop_lourd" };
  const octets = new Uint8Array(await fichier.arrayBuffer());
  const lu = await appelerHesiasunImage(`/organization/logo?${liaison}`, cle, octets, fichier.type || "application/octet-stream");
  const code = codeReponseLogo(lu.statut, lu.json);
  return code ? { ...inchange, logo_erreur: code } : { logo_envoye: geste.url as string, logo_erreur: null };
}

/** Réglages de l'organisation, relus en base. */
export async function lireReglages(admin: SupabaseClient, orgId: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await admin.schema("core").from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error || !data) return null;
  return (data.settings ?? {}) as Record<string, unknown>;
}

/** Clé d'API HésiaSun de l'organisation (coffre), ou null. */
export async function lireCle(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data, error } = await admin.rpc("org_secret_read", { p_org_id: orgId, p_key: CLE_COFFRE });
  if (error || !data) return null;
  return String(data);
}

/** Écrit `settings.hesiasun` (null = retire). Rend false si l'écriture est refusée. */
export async function noter(admin: SupabaseClient, orgId: string, etat: Etat | null): Promise<boolean> {
  const { error } = await admin.rpc("org_hesiasun_noter", { p_org_id: orgId, p_etat: etat });
  if (error) console.error(`[hesiasun-identite] org_hesiasun_noter ${orgId}: ${error.message}`);
  return !error;
}

/**
 * Envoie l'identité enregistrée de l'organisation à HésiaSun et note le résultat.
 * Premier envoi d'une liaison (`ouverte` faux) : il l'ouvre. `liaison_rompue` : la liaison est défaite ici aussi.
 */
export async function pousserIdentite(admin: SupabaseClient, orgId: string): Promise<Resultat> {
  if (!baseHesiasun()) return refus("non_configure");
  const reglages = await lireReglages(admin, orgId);
  const etat = reglages ? lireEtatLiaison(reglages) : null;
  if (!reglages || !etat) return refus("non_reliee");
  const cle = await lireCle(admin, orgId);
  if (!cle) return refus("non_reliee");

  const maintenant = new Date().toISOString();
  const envoi = corpsEnvoi(reglages, { liaisonId: etat.liaison_id, ouverture: !etat.ouverte });
  let resultat: { ok: true; data: unknown } | { ok: false; code: string; champs?: Record<string, string> };
  if (envoi.ok) {
    const lu = await appelerHesiasun("PUT", "/organization", cle, envoi.corps);
    resultat = lireReponseHesiasun(lu.statut, lu.json);
  } else {
    resultat = { ok: false, code: envoi.code, champs: envoi.champs };
  }

  if (!resultat.ok && resultat.code === "liaison_rompue") {
    const ecrit = await noter(admin, orgId, etatRompu(maintenant));
    return ecrit ? refus("liaison_rompue") : refus("ecriture_refusee");
  }
  let suite = etatApresEnvoi(etat, resultat, maintenant);
  // Identité acceptée : le logo suit (un échec de logo se note, il ne défait pas l'envoi).
  if (resultat.ok) suite = { ...suite, ...(await alignerLogo(admin, orgId, reglages, suite, cle)) };
  if (!(await noter(admin, orgId, suite))) return refus("ecriture_refusee");
  if (resultat.ok) return { ok: true, etat: suite, data: resultat.data };
  return refus(resultat.code, { champs: resultat.champs, etat: suite });
}
