// src/lib/fumisterie/planModel.js
// Modèle du « Plan du conduit » annexé au devis, et de sa variante « Fiche chantier » — module PUR.
// Il met en forme le métré ENREGISTRÉ (fum_metres : relevé + résultat figé à l'injection) et ne
// recalcule rien : un document remis au client lit les valeurs enregistrées. Jamais de prix : le devis
// reste la seule pièce contractuelle des quantités et des montants. Textes rendus PDF-safe (Helvetica).
import { parametreVisible } from './index.js';
import { pdfSafe } from '../rapportSavModel.js';
import { complementsDuGabarit, lireComplement } from './complements.js';

const num = (v, d = 2) => Number(v).toFixed(d).replace('.', ',');
const quantite = (q) => (Number.isInteger(Number(q)) ? String(Number(q)) : String(Number(q)).replace('.', ','));
const dateFr = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

/**
 * Texte que Helvetica (cp1252) sait rendre : symboles mathématiques écrits en mots, flèches et coches
 * retirées, puis tout caractère hors cp1252 supprimé (pdfSafe).
 * @param {unknown} t
 * @returns {string}
 */
export function texteSurPdf(t) {
  if (t == null) return '';
  const s = String(t).replace(/≤/g, 'au plus').replace(/≥/g, 'au moins').replace(/[✓✔⚠]️?\s?/g, '');
  return pdfSafe(s).replace(/ {2,}/g, ' ').trim();
}

/**
 * Libellé d'une valeur choisie dans un paramètre du gabarit (même règle que le formulaire de relevé).
 * @param {{ cle:string, unite?:string, libelles?:Record<string,string> }} p
 * @param {unknown} c
 * @returns {string}
 */
export function libelleChoix(p, c) {
  if (p.libelles && p.libelles[String(c)] != null) return p.libelles[String(c)];
  if (typeof c === 'number' && p.unite === '°') return c === 0 ? 'Aucun' : `${c}°`;
  if (typeof c === 'number' && p.cle === 'nbEtages') return c === 0 ? 'Aucun' : '1 étage';
  if (typeof c === 'number') return `Ø ${c}`;
  if (c === 'noir') return 'Noir';
  if (c === 'inox') return 'Inox';
  return String(c);
}

/** Valeur saisie d'un paramètre, en clair (« 1,05 m », « Ø 150 », « Noir »). */
function valeurSaisie(p, v) {
  if (v == null || v === '') return '—';
  if (p.choix) return libelleChoix(p, v);
  if (typeof v === 'number') return `${num(v, p.unite === '°' ? 0 : 2)}${p.unite === '°' ? '°' : p.unite ? ` ${p.unite}` : ''}`;
  return String(v);
}

/**
 * Le relevé saisi, en clair : paramètres visibles du gabarit puis compléments facultatifs renseignés (ceux du bilan
 * et de la justification ont leur propre section). Seule définition : la fiche chantier (PDF) et le récapitulatif
 * de l'écran (RecapMetre) disent la même chose.
 * @param {{ troncons?: Array<{ parametres: object[] }> } | null} gabarit
 * @param {Record<string, unknown>} releve
 * @param {string|null|undefined} gabaritCode
 * @returns {Array<{ libelle: string, valeur: string }>}
 */
export function releveSaisi(gabarit, releve, gabaritCode) {
  const r = releve || {};
  const params = (gabarit?.troncons || []).flatMap((t) => t.parametres || []).filter((pp) => parametreVisible(pp, r));
  return [
    ...params.map((pp) => ({ libelle: pp.libelle, valeur: valeurSaisie(pp, r[pp.cle]) })),
    ...complementsDuGabarit(gabaritCode).filter((c) => c.groupe !== 'existant' && c.groupe !== 'dimensionnement' && lireComplement(r, c.cle) != null)
      .map((c) => ({ libelle: c.libelle, valeur: c.type === 'choix' ? String(c.libelles?.[r[c.cle]] ?? r[c.cle]) : valeurSaisie(c, lireComplement(r, c.cle)) })),
  ];
}

/**
 * @param {{
 *   metre: { gabarit_code:string, diametre:number, finition:string, created_at:string, releve:object, resultat:{ lignes:object[], alertes?:object[], geometrie:object } },
 *   configuration: { code?:string, titre?:string } | null,
 *   gabarit: { troncons?: Array<{ parametres: object[] }> } | null,
 *   company: { name?:string, address?:string, postalCode?:string, city?:string, phone?:string, email?:string, rgeCertifications?:string[], logoUrl?:string },
 *   devis: { quote_number?:string, client_display_name?:string, client_address?:string, client_postal_code?:string, client_city?:string } | null,
 *   auteurNom?: string|null, fournisseurNom?: string|null, variante: 'offre'|'chantier',
 *   aVerifier?: string[],
 * }} p
 */
export function buildPlanModel({ metre, configuration, gabarit, company, devis, auteurNom = null, fournisseurNom = null, variante, aVerifier = [] }) {
  const chantier = variante === 'chantier';
  const res = metre?.resultat || {};
  const releve = metre?.releve || {};
  const dateReleve = dateFr(metre?.created_at);
  const co = company || {};
  const d = devis || {};

  const lignes = (res.lignes || []).map((l) => {
    const out = { repere: l.repere ?? null, designation: texteSurPdf(l.libelle), detail: texteSurPdf(l.sous_libelle || ''), quantite: quantite(l.quantite), unite: texteSurPdf(l.unite || 'pièce') };
    if (chantier) out.reference = texteSurPdf(l.reference || '—');
    return out;
  });

  const cartouche = {
    entreprise: {
      nom: texteSurPdf(co.name || ''),
      lignes: [co.address, [co.postalCode, co.city].filter(Boolean).join(' '), co.phone, co.email].filter(Boolean).map(texteSurPdf),
      rge: co.rgeCertifications?.length ? texteSurPdf(`RGE : ${co.rgeCertifications.filter(Boolean).join(', ')}`) : '',
      logoUrl: co.logoUrl || '',
    },
    client: {
      nom: texteSurPdf(d.client_display_name || '—'),
      lignes: [d.client_address, [d.client_postal_code, d.client_city].filter(Boolean).join(' ')].filter(Boolean).map(texteSurPdf),
    },
    devis: { numero: texteSurPdf(d.quote_number || ''), mention: d.quote_number ? texteSurPdf(`Annexe au devis N° ${d.quote_number}`) : 'Annexe au devis' },
    installation: {
      titre: texteSurPdf(configuration?.titre || ''),
      gabarit: texteSurPdf(metre?.gabarit_code || ''),
      diametre: `Ø ${metre?.diametre ?? releve.diametre ?? '—'}`,
      finition: libelleChoix({ cle: 'finition' }, metre?.finition ?? releve.finition ?? '—'),
      fabricant: texteSurPdf(fournisseurNom || '—'),
    },
    releve: { date: dateReleve, auteur: texteSurPdf(auteurNom || '') || '—' },
    mentions: ['Cotes en m', 'Hors échelle'],
  };

  let detailChantier = null;
  if (chantier) {
    detailChantier = {
      releveSaisi: releveSaisi(gabarit, releve, metre?.gabarit_code).map((l) => ({ libelle: texteSurPdf(l.libelle), valeur: texteSurPdf(l.valeur) })),
      // Les alertes « à vérifier » présentes à l'injection : le résultat est figé à ce moment-là.
      // (les non-conformités du conduit existant sont imprimées dans le bilan, pas deux fois)
      alertes: (res.alertes || []).filter((a) => a.niveau === 'warn' && a.code !== 'article_manquant' && a.code !== 'article_ambigu' && !String(a.code).startsWith('existant_')).map((a) => texteSurPdf(a.message)),
      // Points « à vérifier sur place » du résultat figé (moteur dtu-2026.11 et suivants), plus ceux fournis par l'appelant.
      aVerifier: [...(res.alertes || []).filter((a) => a.niveau === 'verifier').map((a) => a.message), ...(aVerifier || [])].map(texteSurPdf),
      // Justification et bilan : figés dans le résultat depuis le moteur fab-2026.11 ; absents d'un métré plus ancien (section omise).
      justification: res.justification ? texteSurPdf(res.justification) : null,
      bilan: res.bilan ? {
        constats: (res.bilan.constats || []).map(texteSurPdf),
        nonConformites: (res.bilan.nonConformites || []).map((n) => ({ texte: texteSurPdf(n.texte), source: texteSurPdf(n.source) })),
        aVerifier: (res.bilan.aVerifier || []).map(texteSurPdf),
      } : null,
    };
  }

  return {
    variante,
    titre: chantier ? 'Fiche chantier — conduit de fumée' : 'Plan du conduit',
    gabaritCode: metre?.gabarit_code || null,
    geometrie: res.geometrie || null,
    releve,
    pieces: { titre: `Pièces selon le métré du ${dateReleve}`, lignes },
    cartouche,
    chantier: detailChantier,
  };
}
