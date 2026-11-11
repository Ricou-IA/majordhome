// supabase/functions/_shared/telechargement.ts
// ============================================================================
// Téléchargement borné d'une URL PUBLIQUE trouvée par une recherche web (photo, fiche technique, notice) et nettoyage
// des champs envoyés par l'écran. Partagé par catalog-item-enrich (article) et equipment-model-enrich (appareil
// installé). Déplacé tel quel depuis catalog-item-enrich le 2026-11-12.
// Garde-fous : URL publique (forme), DNS résolu vers des adresses publiques seulement, redirections revérifiées,
// taille plafonnée, échéance globale respectée.
// ============================================================================

import { urlPublique, adresseIpPrivee, estPdf } from "./catalogue/enrichissement.js";

export const PHOTO_MAX = 5 * 1024 * 1024; // limite du bucket product-images
export const PDF_MAX = 20 * 1024 * 1024;
export const TYPES_IMAGE: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const CLE = /^[a-z0-9_]{1,60}$/;
const TYPES_CHAMP = new Set(["number", "text", "boolean", "enum"]);

export interface Champ { key: string; label: string; unit: string | null; type: string; options?: string[] }

/** Champs envoyés par l'écran, nettoyés (le prompt ne reçoit rien d'autre). */
export function champsPropres(brut: unknown): Champ[] {
  if (!Array.isArray(brut)) return [];
  const out: Champ[] = [];
  for (const c of brut.slice(0, 40)) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    if (typeof o.key !== "string" || !CLE.test(o.key)) continue;
    const type = typeof o.type === "string" && TYPES_CHAMP.has(o.type) ? o.type : "text";
    const champ: Champ = {
      key: o.key, label: String(o.label || o.key).slice(0, 80), unit: o.unit ? String(o.unit).slice(0, 20) : null, type,
    };
    if (Array.isArray(o.options)) champ.options = o.options.slice(0, 30).map((x) => String(x).slice(0, 40));
    out.push(champ);
  }
  return out;
}

/** Caractéristiques acceptées : clés du format attendu, valeurs scalaires bornées. */
export function specsPropres(brut: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return out;
  for (const [k, v] of Object.entries(brut as Record<string, unknown>).slice(0, 60)) {
    if (!CLE.test(k)) continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
    else if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
  }
  return out;
}

/**
 * Le nom doit résoudre, et UNIQUEMENT vers des adresses publiques (A et AAAA) : un nom quelconque peut pointer vers
 * 127.0.0.1 ou les métadonnées cloud. Refus si la résolution DNS n'est pas disponible (on ne télécharge pas à l'aveugle).
 * Limite assumée : fetch résout à nouveau (rebinding DNS non couvert), réduit par la rareté du cas et le type vérifié.
 */
async function verifierDns(url: string): Promise<void> {
  const hote = new URL(url).hostname;
  // deno-lint-ignore no-explicit-any
  const resoudre = (Deno as any).resolveDns as ((h: string, t: string) => Promise<string[]>) | undefined;
  if (typeof resoudre !== "function") throw new Error("vérification DNS indisponible");
  const adresses: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try { adresses.push(...await resoudre(hote, type)); } catch { /* pas d'enregistrement de ce type */ }
  }
  if (!adresses.length) throw new Error("nom de domaine introuvable");
  if (adresses.some((ip) => adresseIpPrivee(ip))) throw new Error("adresse refusée (réseau privé)");
}

/**
 * GET d'une URL publique : redirections suivies à la main (chaque saut revérifié : forme ET DNS), corps lu jusqu'à
 * `max` octets, jamais au-delà de l'`echeance` globale de la requête. `apercu` : lit le début (signature) puis coupe.
 */
export async function telecharger(url: string, max: number, echeance: number, apercu = false): Promise<{ octets: Uint8Array; type: string; url: string }> {
  let courante = url;
  for (let saut = 0; saut < 5; saut++) {
    if (!urlPublique(courante)) throw new Error("adresse refusée (non publique)");
    const reste = echeance - Date.now();
    if (reste < 1_500) throw new Error("temps écoulé, vérification non faite");
    await verifierDns(courante);
    const ctrl = new AbortController();
    const minuterie = setTimeout(() => ctrl.abort(), Math.min(20_000, echeance - Date.now()));
    try {
      const rep = await fetch(courante, {
        redirect: "manual", signal: ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Majordhome/1.0; +https://majordhome.vercel.app)", Accept: "*/*" },
      });
      if (rep.status >= 300 && rep.status < 400) {
        const loc = rep.headers.get("location");
        await rep.body?.cancel();
        if (!loc) throw new Error(`redirection ${rep.status} sans destination`);
        courante = new URL(loc, courante).toString();
        continue;
      }
      if (!rep.ok) { await rep.body?.cancel(); throw new Error(`le site a répondu ${rep.status}`); }
      const annonce = Number(rep.headers.get("content-length") || 0);
      if (annonce > max) { await rep.body?.cancel(); throw new Error(`fichier trop lourd (${Math.round(annonce / 1048576)} Mo)`); }
      const lecteur = rep.body?.getReader();
      const morceaux: Uint8Array[] = [];
      let total = 0;
      if (lecteur) {
        while (true) {
          const { done, value } = await lecteur.read();
          if (done) break;
          total += value.length;
          if (total > max) { await lecteur.cancel(); throw new Error(`fichier trop lourd (plus de ${Math.round(max / 1048576)} Mo)`); }
          morceaux.push(value);
          if (apercu && total >= 1024) { await lecteur.cancel(); break; }
        }
      }
      const octets = new Uint8Array(total);
      let pos = 0;
      for (const m of morceaux) { octets.set(m.subarray(0, Math.min(m.length, total - pos)), pos); pos += m.length; }
      return { octets, type: (rep.headers.get("content-type") || "").split(";")[0].trim().toLowerCase(), url: courante };
    } finally {
      clearTimeout(minuterie);
    }
  }
  throw new Error("trop de redirections");
}

/** null si l'URL renvoie bien une image ; sinon la raison du refus. */
export async function verifierPhoto(url: string | null, echeance: number): Promise<string | null> {
  if (!url) return "aucune photo trouvée";
  try {
    const r = await telecharger(url, PHOTO_MAX, echeance, true);
    return TYPES_IMAGE[r.type] ? null : `le lien ne renvoie pas une image (${r.type || "type inconnu"})`;
  } catch (e) { return (e as Error).message; }
}

/** null si l'URL renvoie bien un PDF ; sinon la raison du refus. */
export async function verifierFiche(url: string | null, echeance: number, absent = "aucune fiche technique trouvée"): Promise<string | null> {
  if (!url) return absent;
  try {
    const r = await telecharger(url, PDF_MAX, echeance, true);
    return estPdf(r.octets) ? null : "le lien ne renvoie pas un PDF";
  } catch (e) { return (e as Error).message; }
}
