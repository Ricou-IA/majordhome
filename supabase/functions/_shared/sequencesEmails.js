// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/sequencesEmails.js — ne pas éditer.
// src/lib/sequencesEmails.js
// ============================================================================
// E-mails qui partent TOUT SEULS vers les prospects, selon l'avancement de leur
// projet (Eric 2026-11-21 : « il faut que ce soit configurable ») : accueil,
// relance après un premier contact, relance d'un devis, remerciement d'un projet
// non retenu. SEULE définition : clés, textes par défaut, destinataires, cadence.
//
// Pas de nouveau moteur. Une séquence allumée = une ligne `mail_campaigns`
// (`is_automated`, clé du modèle) reliée à un segment `mail_segments` ; le cron
// `mailing-scheduler` l'envoie par `mailing-send`. Ce module dit seulement QUOI
// créer et comment relire le délai ; l'écran (Réglages → E-mails & SMS) écrit.
//
// Un e-mail de séquence est écrit à UNE personne qui a fait une demande : il part
// de l'adresse commune tant que l'entreprise n'a pas son domaine (`estSequence`,
// lu par `mailing-send`) — pas une campagne vers toute la base.
//
// Module PUR (aucun import), copié pour Deno par `npm run sync:tournee-engine`,
// testé `scripts/sequences-emails.test.mjs`.
// ============================================================================

/** Lien de désinscription : `mailing-send` remplace ce `mailto:` par le lien du destinataire. */
const PIED = '<p style="font-size:12px;color:#64748b;">Vous recevez cet e-mail suite à votre demande. '
  + '<a href="mailto:{{ORG_EMAIL}}?subject=Désabonnement" style="color:#64748b;">Ne plus recevoir nos e-mails</a>.</p>';

const corps = (...paragraphes) => [...paragraphes.map((p) => `<p>${p}</p>`), PIED].join('');

/** Écart entre le premier et le dernier jour d'envoi : un prospect entre dans la fenêtre une seule fois. */
export const DUREE_FENETRE_JOURS = 7;
export const DELAI_MIN_JOURS = 1;
export const DELAI_MAX_JOURS = 90;

/**
 * @typedef {{ key: string, label: string, subject: string, html_body: string, is_transactional: boolean }} GabaritSequence
 * @typedef {{
 *   gabarit: Readonly<GabaritSequence>,
 *   titre: string,
 *   description: string,
 *   statut: string,
 *   repere: 'statut' | 'devis' | null,
 *   delaiDefaut: number | null,
 *   cadence: Readonly<{ auto_cadence_days: number | null, auto_cadence_minutes: number | null, auto_time_of_day: string }>,
 *   exemple: Readonly<Record<string, string>>,
 * }} SequenceEmail
 */

/**
 * @param {string} key
 * @param {string} label nom de la campagne (c'est lui que porte le journal des envois : ne pas le changer)
 * @param {string} subject
 * @param {string} html_body
 * @returns {Readonly<GabaritSequence>}
 */
const gabarit = (key, label, subject, html_body) => Object.freeze({ key, label, subject, html_body, is_transactional: true });

const CHAQUE_JOUR = Object.freeze({ auto_cadence_days: 1, auto_cadence_minutes: null, auto_time_of_day: '09:00' });
const AU_FIL_DE_L_EAU = Object.freeze({ auto_cadence_days: null, auto_cadence_minutes: 10, auto_time_of_day: '09:00' });
const EXEMPLE = Object.freeze({ '{{SALUTATION}}': 'Bonjour Jean Dupont,' });

/** @type {ReadonlyArray<Readonly<SequenceEmail>>} */
export const SEQUENCES_EMAILS = Object.freeze([
  Object.freeze({
    gabarit: gabarit('sequence_accueil_lead', 'Accueil d’un nouveau prospect',
      'Nous avons bien reçu votre demande — {{BRAND_NAME}}',
      corps('{{SALUTATION}}',
        'Merci pour votre demande : elle est bien prise en compte. Nous revenons vers vous très rapidement pour parler de votre projet.',
        'D’ici là, vous pouvez répondre à cet e-mail : votre message nous arrive directement.',
        'À très bientôt,<br>{{BRAND_NAME}}')),
    titre: 'Accueillir un nouveau prospect',
    description: 'Dès qu’une demande arrive, le prospect reçoit la confirmation qu’elle est prise en compte.',
    statut: 'Nouveau',
    repere: null,
    delaiDefaut: null,
    cadence: AU_FIL_DE_L_EAU,
    exemple: EXEMPLE,
  }),
  Object.freeze({
    gabarit: gabarit('sequence_relance_contact', 'Relance après un premier contact',
      'Votre projet — {{BRAND_NAME}} reste à votre disposition',
      corps('{{SALUTATION}}',
        'Nous avons échangé récemment au sujet de votre projet. Où en êtes-vous de votre réflexion ?',
        'Si vous avez une question, ou si vous souhaitez que nous passions chez vous pour préciser les choses, répondez simplement à cet e-mail.',
        'Bien cordialement,<br>{{BRAND_NAME}}')),
    titre: 'Relancer après un premier contact',
    description: 'Le prospect a été contacté et son projet n’a pas avancé depuis.',
    statut: 'Contacté',
    repere: 'statut',
    delaiDefaut: 7,
    cadence: CHAQUE_JOUR,
    exemple: EXEMPLE,
  }),
  Object.freeze({
    gabarit: gabarit('sequence_relance_devis', 'Relance d’un devis envoyé',
      'Votre devis {{BRAND_NAME}} — des questions ?',
      corps('{{SALUTATION}}',
        'Nous vous avons adressé un devis il y a quelques jours. Avez-vous pu en prendre connaissance ?',
        'Nous restons à votre disposition pour l’expliquer ou l’ajuster : répondez simplement à cet e-mail.',
        'Bien cordialement,<br>{{BRAND_NAME}}')),
    titre: 'Relancer un devis envoyé',
    description: 'Le devis est parti et le prospect n’a pas encore répondu.',
    statut: 'Devis envoyé',
    repere: 'devis',
    delaiDefaut: 7,
    cadence: CHAQUE_JOUR,
    exemple: EXEMPLE,
  }),
  Object.freeze({
    gabarit: gabarit('sequence_remerciement_perdu', 'Remerciement d’un projet non retenu',
      'Merci de nous avoir consultés — {{BRAND_NAME}}',
      corps('{{SALUTATION}}',
        'Votre projet ne se fera pas avec nous cette fois-ci, et nous vous remercions de nous avoir consultés.',
        'Nous restons à votre disposition si votre situation évolue, ou pour tout autre besoin.',
        'Bien cordialement,<br>{{BRAND_NAME}}')),
    titre: 'Remercier après un projet non retenu',
    description: 'Le projet est classé « Perdu » : un mot de remerciement, la porte reste ouverte.',
    statut: 'Perdu',
    repere: 'statut',
    delaiDefaut: 7,
    cadence: CHAQUE_JOUR,
    exemple: EXEMPLE,
  }),
]);

/**
 * @param {string | null | undefined} cle clé de campagne (`mail_campaigns.key`)
 * @returns {Readonly<SequenceEmail> | null}
 */
export function sequenceEmail(cle) {
  return SEQUENCES_EMAILS.find((s) => s.gabarit.key === cle) ?? null;
}

/** La campagne est-elle une séquence (e-mail écrit à une personne, pas un envoi en nombre) ? */
export function estSequence(cle) {
  return sequenceEmail(cle) !== null;
}

/** Nom du segment créé pour une séquence. */
export function nomDuSegment(sequence) {
  return `Séquence — ${sequence.gabarit.label}`;
}

/**
 * Délai saisi → entier dans les bornes, ou `null` si la saisie n'en est pas un.
 * @param {unknown} valeur
 * @returns {number | null}
 */
export function lireSaisieDelai(valeur) {
  const n = typeof valeur === 'number' ? valeur : Number(String(valeur ?? '').trim());
  if (!Number.isInteger(n) || n < DELAI_MIN_JOURS || n > DELAI_MAX_JOURS) return null;
  return n;
}

const CLES_DELAI = Object.freeze({
  statut: Object.freeze({ min: 'days_in_status_min', max: 'days_in_status_max' }),
  devis: Object.freeze({ min: 'days_since_quote_min', max: 'days_since_quote_max' }),
});

/**
 * Délai (en jours) d'un segment existant, pour l'afficher ; `null` si la séquence n'a pas de délai
 * ou si le segment n'en porte pas.
 * @param {Readonly<SequenceEmail>} sequence
 * @param {Record<string, any> | null | undefined} filtres `mail_segments.filters`
 * @returns {number | null}
 */
export function delaiDuSegment(sequence, filtres) {
  if (!sequence.repere) return null;
  const n = Number(filtres?.base?.[CLES_DELAI[sequence.repere].min]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Filtres du segment d'une séquence qu'on allume.
 * @param {Readonly<SequenceEmail>} sequence
 * @param {object} p
 * @param {string} p.statutId identifiant du statut `sequence.statut`
 * @param {number | null} [p.delai] jours après l'entrée dans le statut (ou après le devis)
 * @param {string} p.depuis date ISO de l'allumage — l'accueil ne part jamais vers un prospect arrivé avant
 * @returns {Record<string, any>}
 */
export function filtresDuSegment(sequence, { statutId, delai = null, depuis }) {
  if (!statutId) throw new Error('statut_inconnu');
  const base = { kind: 'lead_status', status_ids: [statutId] };
  const attributes = {};
  if (sequence.repere) {
    const jours = lireSaisieDelai(delai ?? sequence.delaiDefaut);
    if (jours === null) throw new Error('delai_invalide');
    const cles = CLES_DELAI[sequence.repere];
    base[cles.min] = jours;
    base[cles.max] = jours + DUREE_FENETRE_JOURS;
  } else {
    if (!depuis) throw new Error('date_d_allumage_requise');
    attributes.created_between = { from: depuis };
  }
  return { audience: 'leads', base, attributes, mailing_history: { exclude_current_campaign: true } };
}

/**
 * Mêmes filtres, délai changé : la durée de la fenêtre existante est conservée (un segment réglé à la
 * main sur 10 à 21 jours garde ses 11 jours d'écart). Les autres filtres ne sont pas touchés.
 * @param {Readonly<SequenceEmail>} sequence
 * @param {Record<string, any>} filtres
 * @param {number} delai
 * @returns {Record<string, any>}
 */
export function filtresAvecDelai(sequence, filtres, delai) {
  if (!sequence.repere) throw new Error('sequence_sans_delai');
  const jours = lireSaisieDelai(delai);
  if (jours === null) throw new Error('delai_invalide');
  const cles = CLES_DELAI[sequence.repere];
  const base = { ...(filtres?.base ?? {}) };
  const min = Number(base[cles.min]);
  const max = Number(base[cles.max]);
  const ecart = Number.isInteger(min) && Number.isInteger(max) && max > min ? max - min : DUREE_FENETRE_JOURS;
  base[cles.min] = jours;
  base[cles.max] = jours + ecart;
  return { ...filtres, base };
}

/**
 * État d'une séquence pour une entreprise, d'après sa campagne et son segment.
 * @param {Readonly<SequenceEmail>} sequence
 * @param {{ is_automated?: boolean, auto_segment_id?: string | null } | null | undefined} campagne
 * @param {{ filters?: Record<string, any>, is_archived?: boolean } | null | undefined} segment
 * @returns {{ allumee: boolean, delai: number | null }}
 */
export function etatSequence(sequence, campagne, segment) {
  const allumee = Boolean(campagne?.is_automated && campagne?.auto_segment_id && segment && !segment.is_archived);
  return { allumee, delai: delaiDuSegment(sequence, segment?.filters) ?? sequence.delaiDefaut };
}

/** Phrase qui dit quand part l'e-mail. */
export function phraseDelai(sequence, delai) {
  if (!sequence.repere) return 'Dans les minutes qui suivent la demande.';
  const jours = `${delai} jour${delai > 1 ? 's' : ''}`;
  return sequence.repere === 'devis'
    ? `${jours} après l’envoi du devis, une seule fois.`
    : `${jours} après le passage en « ${sequence.statut} », une seule fois.`;
}
