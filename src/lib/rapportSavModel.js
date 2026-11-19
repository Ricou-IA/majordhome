// src/lib/rapportSavModel.js — rapport d'intervention SAV : contenu saisi et mise en lettre.
// Module PUR (aucun import React/Supabase/alias) — testé `node --test scripts/rapport-sav-model.test.mjs`.
// Spec : docs/superpowers/specs/2026-11-19-rapport-intervention-sav-design.md
//
// Le rapport est une lettre de la même forme que l'attestation d'entretien
// (`buildAttestationEntretien().lettre`) : même gabarit PDF (`AttestationEntretienPDF`), qui ne
// calcule rien. Sans signature du client (Eric 2026-11-19) : c'est l'entreprise qui signe.
//
// ⚠️ PDF Helvetica/WinAnsi : tout texte passe par `pdfSafe` (le texte est saisi à la main, il peut
// porter n'importe quel caractère).

import { formatDateLettre, marqueModele, listeFr } from './attestationEntretienModel.js';

const CP1252_EN_PLUS = new Set([8216, 8217, 8220, 8221, 8211, 8212, 8230, 8364, 338, 339]);

/**
 * Texte que Helvetica sait rendre : espaces normalisées (U+00A0, U+202F, retours à la ligne),
 * caractères hors cp1252 retirés (émoticônes, flèches…).
 * @param {unknown} s
 * @returns {string}
 */
export function pdfSafe(s) {
  return [...String(s ?? '').replace(/\s/g, ' ').replace(/[−]/g, '-').replace(/[→←]/g, '-')]
    .filter((c) => {
      const n = c.codePointAt(0);
      return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || CP1252_EN_PLUS.has(n);
    })
    .join('');
}

const texte = (s) => String(s ?? '').trim();
const lignes = (s) => String(s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
const minuscule = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const jour = (s) => (/^(\d{4}-\d{2}-\d{2})/.exec(String(s || '')) || [])[1] || null;

/** Clé d'une pièce identifiée (même unicité que `sav_part_selections`). */
export function clePiece(selection) {
  return [selection?.equipment_id || '', selection?.piece_reference || '', selection?.repere || ''].join('|');
}

/**
 * Passage retenu pour le rapport : le dernier RDV non annulé de la carte, jamais dans le futur ;
 * à défaut la date de la carte ; à défaut aujourd'hui.
 * @param {object} p
 * @param {Array<{ scheduled_date?: string, status?: string, technician_ids?: string[] }>} [p.rdvs]
 * @param {string|null} [p.scheduledDate]  `interventions.scheduled_date`
 * @param {string} p.aujourdhui  `YYYY-MM-DD` (date locale)
 * @returns {{ date: string, technicianIds: string[] }}
 */
export function passageDuRapport({ rdvs = [], scheduledDate = null, aujourdhui }) {
  const passes = rdvs
    .filter((r) => !['cancelled', 'no_show'].includes(r?.status) && jour(r?.scheduled_date) && jour(r.scheduled_date) <= aujourdhui)
    .sort((a, b) => jour(b.scheduled_date).localeCompare(jour(a.scheduled_date)));
  if (passes.length > 0) {
    const date = jour(passes[0].scheduled_date);
    const ids = passes.filter((r) => jour(r.scheduled_date) === date).flatMap((r) => r.technician_ids || []);
    return { date, technicianIds: [...new Set(ids)] };
  }
  const carte = jour(scheduledDate);
  return { date: carte && carte <= aujourdhui ? carte : aujourdhui, technicianIds: [] };
}

const nomMembre = (m) => texte(m?.display_name) || [m?.first_name, m?.last_name].map(texte).filter(Boolean).join(' ');

/**
 * Contenu proposé à l'ouverture de la fenêtre. Un rapport déjà édité se rouvre tel qu'il a été
 * écrit (`trace.contenu`) ; les pièces suivent la liste ACTUELLE de la carte, chacune gardant sa
 * coche d'avant (une pièce identifiée depuis est cochée).
 *
 * Les notes internes de la carte (`report_notes`) ne sont JAMAIS reprises : c'est un document
 * remis au client.
 *
 * @param {object} p
 * @param {{ sav_description?: string|null, work_performed?: string|null, scheduled_date?: string|null }} p.carte
 * @param {Array<object>} [p.rdvs]
 * @param {Array<{ id: string, display_name?: string, first_name?: string, last_name?: string }>} [p.membres]
 * @param {Array<{ equipment_id?: string, piece_reference?: string, piece_name?: string, repere?: string, quantity?: number }>} [p.selections]
 * @param {{ id?: string|null, libelle?: string|null, marque?: string|null, modele?: string|null, numeroSerie?: string|null }|null} [p.appareil]
 * @param {string} p.aujourdhui
 * @param {{ contenu?: object }|null} [p.trace]  `rapportDeCarte(carte)`
 * @returns {{ date: string, intervenants: string, appareil: object|null, probleme: string, travaux: string, observations: string, pieces: Array<{ cle: string, designation: string, reference: string, quantite: number, retenue: boolean }> }}
 */
export function contenuInitial({ carte, rdvs = [], membres = [], selections = [], appareil = null, aujourdhui, trace = null }) {
  const avant = trace?.contenu || null;
  const coches = new Map((avant?.pieces || []).map((p) => [p.cle, p.retenue !== false]));
  const pieces = selections
    .filter((s) => Number(s?.quantity) > 0)
    .map((s) => {
      const cle = clePiece(s);
      return {
        cle,
        designation: texte(s.piece_name) || texte(s.piece_reference) || 'Pièce',
        reference: texte(s.piece_reference),
        quantite: Number(s.quantity),
        retenue: coches.has(cle) ? coches.get(cle) : true,
      };
    });

  if (avant) {
    return {
      date: jour(avant.date) || aujourdhui,
      intervenants: texte(avant.intervenants),
      appareil: avant.appareil || null,
      probleme: String(avant.probleme ?? ''),
      travaux: String(avant.travaux ?? ''),
      observations: String(avant.observations ?? ''),
      pieces,
    };
  }

  const passage = passageDuRapport({ rdvs, scheduledDate: carte?.scheduled_date, aujourdhui });
  const parId = new Map(membres.map((m) => [m.id, m]));
  return {
    date: passage.date,
    intervenants: listeFr(passage.technicianIds.map((id) => nomMembre(parId.get(id))).filter(Boolean)),
    appareil: appareil || null,
    probleme: String(carte?.sav_description ?? ''),
    travaux: String(carte?.work_performed ?? ''),
    observations: '',
    pieces,
  };
}

/**
 * Ce qui empêche d'éditer le rapport (premier message affiché).
 * @param {object} contenu
 * @param {{ aujourdhui: string }} p
 * @returns {string[]}
 */
export function validerContenu(contenu, { aujourdhui }) {
  const erreurs = [];
  const date = jour(contenu?.date);
  if (!date || !formatDateLettre(date)) erreurs.push('Indiquez la date de l’intervention.');
  else if (date > aujourdhui) erreurs.push('La date de l’intervention ne peut pas être dans le futur.');
  if (!texte(contenu?.travaux)) erreurs.push('Décrivez les travaux réalisés.');
  return erreurs;
}

/**
 * Forme gardée sur la carte et comparée pour savoir si la saisie diffère du rapport archivé.
 * @param {object} contenu
 * @returns {object}
 */
export function contenuNormalise(contenu) {
  const a = contenu?.appareil;
  return {
    date: jour(contenu?.date) || '',
    intervenants: texte(contenu?.intervenants),
    appareil: a
      ? { id: a.id || null, libelle: texte(a.libelle), marque: texte(a.marque), modele: texte(a.modele), numeroSerie: texte(a.numeroSerie) }
      : null,
    probleme: lignes(contenu?.probleme).join('\n'),
    travaux: lignes(contenu?.travaux).join('\n'),
    observations: lignes(contenu?.observations).join('\n'),
    pieces: (contenu?.pieces || []).map((p) => ({
      cle: p.cle, designation: texte(p.designation), reference: texte(p.reference), quantite: Number(p.quantite) || 0, retenue: p.retenue !== false,
    })),
  };
}

/** La saisie est-elle celle du rapport archivé ? @param {object} a @param {object} b */
export function memeContenu(a, b) {
  return JSON.stringify(contenuNormalise(a)) === JSON.stringify(contenuNormalise(b));
}

/**
 * Trace gardée dans `interventions.metadata.rapport_sav` à chaque édition. Une nouvelle édition
 * efface la mention d'envoi : le fichier archivé n'est plus celui qui est parti (la preuve de
 * l'envoi précédent reste dans `mailing_logs`).
 * @param {{ path: string, contenu: object, userId?: string|null, maintenant: string }} p
 */
export function traceRapport({ path, contenu, userId = null, maintenant }) {
  return { path, edite_le: maintenant, edite_par: userId, contenu: contenuNormalise(contenu) };
}

/** @param {object} trace @param {{ to: string, maintenant: string }} p */
export function traceEnvoi(trace, { to, maintenant }) {
  return { ...trace, envoye_le: maintenant, envoye_a: to };
}

const lignePiece = (p) => `${p.quantite} x ${p.designation}${p.reference && p.reference !== p.designation ? ` (réf. ${p.reference})` : ''}`;

/** Un bloc « Libellé : première ligne », les lignes suivantes en paragraphes à part. */
function bloc(libelle, contenu) {
  const ls = lignes(contenu);
  if (ls.length === 0) return [];
  return [[{ text: `${libelle} : `, bold: true }, { text: ls[0] }], ...ls.slice(1).map((l) => [{ text: l }])];
}

/**
 * Lettre du rapport d'intervention, prête à être mise en page par `AttestationEntretienPDF`.
 *
 * @param {object} p
 * @param {object} p.contenu  cf. `contenuInitial`
 * @param {{ name: string, address?: string, postal_code?: string, city?: string }} p.client
 * @param {object} p.company  buildCompanyInfo(settings)
 * @param {string} p.dateEdition  `YYYY-MM-DD`
 * @returns {{ lettre: object }}
 */
export function buildRapportSav({ contenu, client, company, dateEdition }) {
  const c = contenuNormalise(contenu);
  const datePassage = formatDateLettre(c.date);
  const dateLettre = formatDateLettre(dateEdition) || datePassage;
  const cpVille = [client.postal_code, (client.city || '').toUpperCase()].filter(Boolean).join(' ');
  const adresseClient = [client.address, cpVille].filter(Boolean).join(', ');

  const a = c.appareil;
  const appareilTexte = a
    ? `son ${minuscule(a.libelle || 'appareil')}${marqueModele({ equipement_marque: a.marque, equipement_modele: a.modele })}${a.numeroSerie ? `, n° de série ${a.numeroSerie}` : ''}`
    : null;
  const posees = c.pieces.filter((p) => p.retenue && p.quantite > 0);

  const ouverture = [
    { text: `Nous sommes intervenus${datePassage ? ` le ${datePassage.long}` : ''} au domicile de ${client.name}${adresseClient ? `, ${adresseClient},` : ''} ` },
    ...(appareilTexte ? [{ text: 'sur ' }, { text: appareilTexte, bold: true }, { text: '.' }] : [{ text: 'pour un dépannage.' }]),
    ...(c.intervenants ? [{ text: ` L’intervention a été réalisée par ${c.intervenants}.` }] : []),
  ];

  const paragraphes = [
    ouverture,
    ...bloc('Problème signalé', c.probleme),
    ...bloc('Travaux réalisés', c.travaux),
    ...(posees.length > 0 ? [[{ text: 'Pièces remplacées : ', bold: true }, { text: posees.map(lignePiece).join(' ; ') }]] : []),
    ...bloc('Observations', c.observations),
    [{ text: 'Nous restons à votre disposition pour tout renseignement complémentaire.' }],
  ];

  const ville = company.city || '';
  return {
    lettre: {
      titreDocument: pdfSafe(`Rapport d'intervention - ${client.name || ''}`),
      lieuDate: pdfSafe(dateLettre ? `${ville ? `${ville}, le ` : 'Le '}${dateLettre.long}` : ville),
      destinataire: [client.name, client.address, cpVille].filter(Boolean).map(pdfSafe),
      objet: 'RAPPORT D’INTERVENTION',
      references: pdfSafe(datePassage ? `Intervention du ${datePassage.long}` : ''),
      salutation: 'Madame, Monsieur,',
      paragraphes: paragraphes.map((p) => p.filter((s) => s.text).map((s) => ({ ...s, text: pdfSafe(s.text) }))),
      faitA: pdfSafe(dateLettre ? `Fait${ville ? ` à ${ville},` : ''} le ${dateLettre.court}` : ''),
      signataire: {
        entreprise: pdfSafe((company.legalName || company.name || '').toUpperCase()),
        nom: pdfSafe(company.signatoryName || ''),
        fonction: pdfSafe(company.signatoryRole || ''),
      },
    },
  };
}
