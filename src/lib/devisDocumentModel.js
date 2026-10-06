// src/lib/devisDocumentModel.js
// Modèle PUR du document « devis » : UNE source de vérité pour le PDF (DevisPDF.jsx, react-pdf) et
// l'aperçu HTML de Settings → Devis. Tout est formaté ici, PDF-safe (espaces ordinaires, virgule
// décimale, pas de glyphe hors cp1252) ; les composants n'affichent que des chaînes. Chaque zone porte
// son `id` (table ZONES) : c'est la correspondance zone cliquée ↔ réglage du panneau.
// Testé par scripts/devis-document-model.test.mjs (audit:quality). Spec :
// docs/superpowers/specs/2026-10-06-parametrage-devis-modele-document-design.md
import { formatFullAddress } from './orgBranding.js';
import { fmtEur } from './invoiceDocumentModel.js';
import { DEFAULTS_DEVIS, buildDevisConfig, famillesActives } from './devisConfig.js';

/**
 * Zones du document et le réglage qui les gouverne (accordéon + champ). `reglage: null` = zone portée
 * par le devis lui-même (objet, client, totaux), montrée mais non éditable ici.
 */
export const ZONES = Object.freeze([
  Object.freeze({ id: 'entete', libelle: 'Titre du document', accordeon: 'contenu', champ: 'document.titre' }),
  Object.freeze({ id: 'logo', libelle: 'Logo', accordeon: 'affichage', champ: 'affichage.logo' }),
  Object.freeze({ id: 'emetteur', libelle: 'Émetteur', accordeon: 'emetteur', champ: null }),
  Object.freeze({ id: 'client', libelle: 'Client', accordeon: null, champ: null }),
  Object.freeze({ id: 'objet', libelle: 'Objet du devis', accordeon: null, champ: null }),
  Object.freeze({ id: 'intro', libelle: 'Introduction', accordeon: 'contenu', champ: 'document.intro' }),
  Object.freeze({ id: 'acompte', libelle: 'Acompte et échéancier', accordeon: 'contenu', champ: 'document.acompte' }),
  Object.freeze({ id: 'tableau', libelle: 'Chapitres et lignes', accordeon: 'affichage', champ: 'affichage.detail_lignes' }),
  Object.freeze({ id: 'totaux', libelle: 'Totaux', accordeon: null, champ: null }),
  Object.freeze({ id: 'validite', libelle: 'Validité', accordeon: 'contenu', champ: 'document.validite_jours' }),
  Object.freeze({ id: 'conditions', libelle: 'Conditions de vente', accordeon: 'contenu', champ: 'document.conditions' }),
  Object.freeze({ id: 'mention_speciale', libelle: 'Mention spéciale', accordeon: 'contenu', champ: 'document.mention_speciale' }),
  Object.freeze({ id: 'paiement', libelle: 'Paiement', accordeon: 'paiement', champ: 'paiement.afficher' }),
  Object.freeze({ id: 'signature', libelle: 'Signature', accordeon: 'contenu', champ: 'document.signature' }),
  Object.freeze({ id: 'pied_de_page', libelle: 'Pied de page', accordeon: 'contenu', champ: 'document.pied_de_page' }),
]);

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « 6 octobre 2026 » ; chaîne vide si la date est absente ou invalide. */
export function fmtDateLongue(d) {
  if (!d) return '';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getDate()} ${MOIS[date.getMonth()]} ${date.getFullYear()}`;
}

/** Quantité : entier tel quel, sinon 2 décimales avec virgule. */
export function fmtQte(q) {
  const n = Number(q);
  if (!Number.isFinite(n)) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',');
}

/** Taux de TVA : « 20 % », « 5,5 % ». */
export function fmtTaux(t) {
  const n = Number(t);
  if (!Number.isFinite(n)) return '';
  return `${String(Math.round(n * 100) / 100).replace('.', ',')} %`;
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function piedParDefaut(comp, adresse) {
  const base = [comp.name, adresse, comp.siret ? `SIRET ${comp.siret}` : null, comp.tvaIntra ? `TVA ${comp.tvaIntra}` : null].filter(Boolean).join(' — ');
  const legal = [comp.legalForm, comp.capital ? `capital ${comp.capital} €` : null, comp.rcs].filter(Boolean).join(' — ');
  return [base, legal].filter(Boolean).join(' — ');
}
const ligneTotalHt = (l) => (Number.isFinite(Number(l.total_ht)) ? Number(l.total_ht) : round2((Number(l.quantity) || 0) * (Number(l.unit_price_ht) || 0)));
const lignesTexte = (s) => String(s || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

/** Groupe les lignes du devis en chapitres (une section sans titre en tête si des lignes précèdent le premier titre). */
export function chapitres(lines) {
  const out = [];
  let courant = null;
  for (const l of lines || []) {
    if (l.line_type === 'section_title') { courant = { titre: l.designation || '', lignes: [] }; out.push(courant); continue; }
    if (!courant) { courant = { titre: '', lignes: [] }; out.push(courant); }
    courant.lignes.push(l);
  }
  return out.map((c) => ({ ...c, sous_total_ht: round2(c.lignes.reduce((s, l) => s + ligneTotalHt(l), 0)) }));
}

/**
 * Construit toutes les zones du document.
 * @param {object} p
 * @param {object} p.quote  { quote_number, created_at|date, validity_date, subject, client_display_name, client_address,
 *   client_postal_code, client_city, client_phone, client_email, global_discount_percent, conditions }
 * @param {Array<object>} p.lines  lignes du devis (section_title / product / labor / freeform)
 * @param {object} p.totals  computeQuoteTotals(lines, remise) : { subtotal_ht, discount_amount, total_ht, tva_breakdown[], total_ttc }
 * @param {object} p.company  buildCompanyInfo(settings)
 * @param {object} [p.config]  buildDevisConfig(settings) (défauts si absent)
 * @param {{ iban?: string, bic?: string }} [p.invoicing]  invoicingSettings(settings)
 */
export function buildDevisDocumentModel({ quote, lines, totals, company, config, invoicing }) {
  const cfg = config || buildDevisConfig(null);
  const q = quote || {};
  const comp = company || {};
  const remise = Number(q.global_discount_percent) || 0;
  const adresse = formatFullAddress(comp);
  const emetteurLignes = [adresse, [comp.phone ? `Tél. ${comp.phone}` : null, comp.email].filter(Boolean).join('  ·  '), comp.siret ? `SIRET : ${comp.siret}` : null, comp.tvaIntra ? `TVA : ${comp.tvaIntra}` : null].filter(Boolean);
  const clientLignes = [q.client_display_name || '', q.client_address || '', [q.client_postal_code, q.client_city].filter(Boolean).join(' '), q.client_phone ? `Tél. ${q.client_phone}` : '', q.client_email || ''].filter(Boolean);

  const colonnes = { reference: cfg.affichage.references, prix_unitaire: cfg.affichage.prix_unitaires, tva: cfg.affichage.tva_par_ligne, detail: cfg.affichage.detail_lignes };
  const chaps = chapitres(lines).map((c) => ({
    titre: c.titre,
    sous_total: fmtEur(c.sous_total_ht),
    lignes: cfg.affichage.detail_lignes ? c.lignes.map((l) => ({
      designation: l.designation || '', description: l.description || '', reference: cfg.affichage.references ? (l.reference || '') : '',
      quantite: fmtQte(l.quantity), unite: l.unit || '', prix_unitaire: cfg.affichage.prix_unitaires ? fmtEur(l.unit_price_ht) : '',
      tva: cfg.affichage.tva_par_ligne ? fmtTaux(l.tva_rate) : '', total: fmtEur(ligneTotalHt(l)),
    })) : [],
  }));

  const t = totals || {};
  const totaux = [{ libelle: 'Sous-total HT', valeur: fmtEur(t.subtotal_ht), gras: false }];
  if (remise > 0) totaux.push({ libelle: `Remise (${String(remise).replace('.', ',')} %)`, valeur: `-${fmtEur(t.discount_amount)}`, gras: false });
  totaux.push({ libelle: 'Total HT', valeur: fmtEur(t.total_ht), gras: true });
  for (const v of t.tva_breakdown || []) totaux.push({ libelle: `TVA ${fmtTaux(v.rate)}`, valeur: fmtEur(v.tva_amount), gras: false });
  totaux.push({ libelle: 'Total TTC', valeur: fmtEur(t.total_ttc), gras: true });

  const validiteDate = fmtDateLongue(q.validity_date);
  const conditions = (typeof q.conditions === 'string' && q.conditions.trim()) ? q.conditions : cfg.document.conditions;
  const iban = String(invoicing?.iban || '').trim();
  const bic = String(invoicing?.bic || '').trim();
  const paiementVisible = cfg.paiement.afficher && !!iban;

  return {
    zones: ZONES,
    entete: { id: 'entete', titre: cfg.document.titre, numero: q.quote_number ? `N° ${q.quote_number}` : '', date: fmtDateLongue(q.created_at || q.date) ? `Date : ${fmtDateLongue(q.created_at || q.date)}` : '' },
    logo: { id: 'logo', url: cfg.affichage.logo && comp.logoUrl ? comp.logoUrl : null, visible: cfg.affichage.logo },
    emetteur: { id: 'emetteur', nom: comp.name || '', lignes: emetteurLignes, couleur: comp.accentColor || '#64748b' },
    client: { id: 'client', lignes: clientLignes },
    objet: { id: 'objet', texte: q.subject || '' },
    intro: { id: 'intro', lignes: lignesTexte(cfg.document.intro) },
    acompte: { id: 'acompte', lignes: lignesTexte(cfg.document.acompte) },
    tableau: { id: 'tableau', colonnes, chapitres: chaps },
    totaux: { id: 'totaux', lignes: totaux },
    validite: { id: 'validite', texte: validiteDate ? `Ce devis est valable jusqu'au ${validiteDate}.` : `Ce devis est valable ${cfg.document.validite_jours} jours.` },
    conditions: { id: 'conditions', titre: 'Conditions de vente', lignes: lignesTexte(conditions) },
    mention_speciale: { id: 'mention_speciale', lignes: lignesTexte(cfg.document.mention_speciale) },
    paiement: { id: 'paiement', visible: paiementVisible, etablissement: cfg.paiement.etablissement, iban, bic, texte: cfg.paiement.texte, sans_iban: cfg.paiement.afficher && !iban },
    signature: { id: 'signature', libelle: cfg.document.signature, sous_libelle: 'Date et signature du client' },
    // Pied par défaut = ligne historique du PDF (nom, adresse, SIRET, TVA) ; la ligne légale complète
    // (forme, capital, RCS) vient en plus si l'entreprise l'a renseignée.
    pied_de_page: { id: 'pied_de_page', texte: cfg.document.pied_de_page.trim() || piedParDefaut(comp, adresse) },
  };
}

/**
 * Devis fictif pour l'aperçu de Settings → Devis : chapitres de la première famille active, deux lignes
 * d'exemple dans le premier chapitre, une main-d'œuvre dans le dernier. Les totaux restent à calculer
 * par `computeQuoteTotals` (service) côté appelant.
 */
export function exempleDevis(config, { aujourdhui = new Date() } = {}) {
  const cfg = config || DEFAULTS_DEVIS;
  const famille = famillesActives(cfg)[0] || cfg.familles?.[0];
  const sections = famille?.sections?.length ? famille.sections : ['PRESTATIONS'];
  const validite = new Date(aujourdhui.getTime() + (cfg.document.validite_jours || 30) * 86400000);
  const lines = [];
  sections.forEach((titre, i) => {
    lines.push({ line_type: 'section_title', designation: titre, quantity: 0, unit_price_ht: 0, tva_rate: 0 });
    if (i === 0) {
      lines.push({ line_type: 'product', designation: 'Équipement principal (exemple)', description: 'Modèle, puissance, finition', reference: 'REF-001', quantity: 1, unit: 'pièce', unit_price_ht: 2500, tva_rate: 5.5, total_ht: 2500 });
      lines.push({ line_type: 'product', designation: 'Accessoire (exemple)', description: '', reference: 'REF-002', quantity: 2, unit: 'pièce', unit_price_ht: 120, tva_rate: 5.5, total_ht: 240 });
    }
    if (i === sections.length - 1 && sections.length > 1) {
      lines.push({ line_type: 'labor', designation: 'Pose et mise en service', description: '', reference: '', quantity: 1, unit: 'forfait', unit_price_ht: 650, tva_rate: 10, total_ht: 650 });
    }
  });
  return {
    quote: {
      quote_number: 'DEV-2026-0001', created_at: aujourdhui.toISOString(), validity_date: validite.toISOString(),
      subject: `${famille?.label || 'Installation'} — exemple`, client_display_name: 'Jean Dupont', client_address: '12 rue des Lilas',
      client_postal_code: '81600', client_city: 'Gaillac', client_phone: '06 12 34 56 78', client_email: 'jean.dupont@exemple.fr',
      global_discount_percent: 0, conditions: '',
    },
    lines,
  };
}
