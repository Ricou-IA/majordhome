/**
 * pvPageApi.js — appels de la page publique /pv/:token à l'edge `chantier-pv`, et
 * correspondance entre ce que la page reçoit et les données du PDF de levée.
 * La page ne parle qu'à l'edge, avec le jeton du lien.
 */

import { donneesPdfLevee } from '@/lib/pvReception';
import { fetchAsDataUrl } from '@/lib/imageDataUrl';

const EDGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chantier-pv`;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** @returns {Promise<{ ok: boolean, status: number, json: any }>} */
export async function appelerEdge({ method = 'GET', token, body }) {
  const url = method === 'GET' ? `${EDGE_URL}?token=${encodeURIComponent(token)}` : EDGE_URL;
  try {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(ANON_KEY ? { apikey: ANON_KEY } : {}) },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { json = null; }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

/**
 * Données du PDF de levée des réserves depuis ce que la page a reçu : les champs enregistrés
 * sont renommés comme les lit `donneesPdfLevee` (ligne `chantier_pv`). Rien n'est recalculé.
 * @param {Object} pv            réponse de l'edge
 * @param {string} nomEntreprise
 * @returns {Object}
 */
export function donneesLeveePourPage(pv, nomEntreprise) {
  const s = pv.signature || {};
  const levee = pv.levee || {};
  const reserves = pv.reserves || {};
  return donneesPdfLevee({
    chantierId: pv.chantier_id,
    client: pv.client,
    objet: pv.objet,
    entreprise: nomEntreprise,
    pv: {
      signed_at: s.signed_at,
      reserves_nature: s.reserves_nature,
      reserves_travaux: s.reserves_travaux,
      devis: s.devis,
      reserves_reponse: reserves.reponse,
      reserves_echeance: reserves.echeance,
      levee_signed_at: levee.signed_at,
      levee_signataire_nom: levee.signataire_nom,
      levee_signature_png: levee.signature_png,
    },
  });
}

/**
 * Logo et signature de l'entreprise pour les PDF de la page, depuis ce que l'edge transmet
 * (`logo_url` des réglages, `signature_url` = lien court vers la signature du signataire).
 * Ce qui ne répond pas est absent du PDF : la page n'a rien d'autre à proposer au client.
 * @param {Object|null|undefined} entreprise
 * @returns {Promise<{ logoSrc: string|null, signatureSrc: string|null }>}
 */
export async function visuelsPourPage(entreprise) {
  const [logoSrc, signatureSrc] = await Promise.all([
    fetchAsDataUrl(entreprise?.logo_url),
    fetchAsDataUrl(entreprise?.signature_url),
  ]);
  return { logoSrc, signatureSrc };
}

/** État de la page d'après ce que l'edge rend (hors chargement et erreur). */
export function etatDepuisPv(pv) {
  if (!pv.deja_signe) return pv.pret ? 'formulaire' : 'pas_pret';
  if (pv.levee?.signed_at) return 'levee_signee';
  if (pv.levee?.demandee) return 'levee';
  return 'signe';
}
