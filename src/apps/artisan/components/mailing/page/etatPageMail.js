/**
 * etatPageMail.js — état de la page du mail (réducteur de `PageMail`)
 * ============================================================================
 * Le formulaire, sa photo enregistrée, la version du texte relue par l'éditeur,
 * la rédaction assistée en cours et son unique retour en arrière.
 *
 * `version` n'augmente que lorsque la PAGE remplace le texte (ouverture,
 * réponse de l'assistant, « Annuler », gestes de l'ancien format) : à chaque
 * frappe l'éditeur garde la main, sinon le curseur sauterait.
 * Les règles (ce qui s'enregistre, ce qui est modifié…) sont dans `src/lib/mailPage.js`.
 * ============================================================================
 */
import { formulaireDepuisCampagne } from '@/lib/mailPage';

/**
 * @typedef {{
 *   chargeDe: string | null,          // id du mail ouvert, 'nouveau', ou null tant que rien n'est chargé
 *   base: Record<string, any> | null, // ligne enregistrée (nature, variables) ; null pour un mail neuf
 *   initial: Record<string, any> | null, // formulaire tel qu'enregistré ; null pour un mail neuf
 *   form: Record<string, any>,
 *   version: number,
 *   annulation: { subject: string, html_body: string } | null,
 *   objetsProposes: string[],
 *   redaction: string | null,         // consigne en cours
 * }} EtatPageMail
 */

/** @returns {EtatPageMail} */
export const etatInitial = () => ({
  chargeDe: null,
  base: null,
  initial: null,
  form: formulaireDepuisCampagne(null),
  version: 0,
  annulation: null,
  objetsProposes: [],
  redaction: null,
});

/**
 * @param {EtatPageMail} etat
 * @param {{ type: string, [k: string]: any }} action
 * @returns {EtatPageMail}
 */
export function reducteurPageMail(etat, action) {
  switch (action.type) {
    case 'charger': {
      const c = action.campagne ?? null;
      return {
        ...etatInitial(),
        chargeDe: action.chargeDe,
        base: c,
        initial: c ? formulaireDepuisCampagne(c) : null,
        form: formulaireDepuisCampagne(c),
        version: etat.version + 1,
      };
    }
    case 'champ':
      // Retoucher l'objet à la main referme le retour en arrière de l'assistant (rien de tapé n'est perdu).
      return {
        ...etat,
        form: { ...etat.form, [action.champ]: action.valeur },
        annulation: action.champ === 'subject' ? null : etat.annulation,
      };
    case 'intention':
      return { ...etat, form: { ...etat.form, blocks: { ...etat.form.blocks, brief: action.valeur } } };
    case 'corps':
      if (action.html === etat.form.html_body) return etat;
      return { ...etat, form: { ...etat.form, html_body: action.html }, annulation: null };
    case 'remplacerTexte':
      return {
        ...etat,
        form: { ...etat.form, html_body: action.html_body, blocks: action.blocks ?? etat.form.blocks },
        version: etat.version + 1,
        annulation: null,
      };
    case 'redactionDebut':
      return { ...etat, redaction: action.consigne };
    case 'redactionEchec':
      return { ...etat, redaction: null };
    case 'objetsProposes':
      return { ...etat, redaction: null, objetsProposes: action.objets };
    case 'redactionFin':
      return {
        ...etat,
        redaction: null,
        annulation: { subject: etat.form.subject, html_body: etat.form.html_body },
        form: { ...etat.form, subject: action.objet || etat.form.subject, html_body: action.corps },
        objetsProposes: action.objets ?? [],
        version: etat.version + 1,
      };
    case 'annulerRedaction':
      if (!etat.annulation) return etat;
      return {
        ...etat,
        form: { ...etat.form, subject: etat.annulation.subject, html_body: etat.annulation.html_body },
        annulation: null,
        objetsProposes: [],
        version: etat.version + 1,
      };
    case 'garderRedaction':
      return { ...etat, annulation: null };
    case 'choisirObjet':
      return { ...etat, form: { ...etat.form, subject: action.objet } };
    case 'enregistre':
      // La photo enregistrée suit la ligne rendue par la base ; le formulaire n'est pas touché (une frappe
      // faite pendant l'enregistrement reste « non enregistrée »).
      return {
        ...etat,
        chargeDe: action.campagne.id,
        base: action.campagne,
        initial: formulaireDepuisCampagne(action.campagne),
      };
    default:
      return etat;
  }
}
