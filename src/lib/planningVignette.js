/**
 * planningVignette.js - Majord'home Artisan
 * ============================================================================
 * Gabarit d'affichage d'un RDV dans le calendrier, choisi selon la PLACE dont le
 * bloc dispose (sa durée) : un SAV de 30 min n'a qu'une ligne, une installation
 * d'une journée a tout le cadre. Module PUR (aucun import React / Supabase),
 * testé par scripts/planning-vignette.test.mjs — le composant
 * PlanningEventContent ne fait que dessiner ce modèle.
 *
 * Ce que chaque gabarit montre, dans l'ordre de lecture :
 *   - ligne  (1 ligne)   : heure de début · type court · icônes · NOM · zone
 *   - deux   (2 lignes)  : créneau · type court · icônes / NOM · zone
 *   - trois  (3-4 lignes): créneau · type court · icônes / NOM (1-2 lignes) / zone
 *   - plein  (5 lignes+) : créneau / type complet · icônes / NOM (1-3 lignes) / zone
 * ============================================================================
 */

// Hauteurs de la grille horaire, en pixels. À tenir alignées avec le CSS :
// `.fc .fc-timegrid-slot` (1,5 em = 24 px, 2,5 rem = 40 px sur téléphone),
// `.fc .fc-timegrid-event` (marges du bloc) et `leading-[13px]` du composant.
export const HAUTEUR_CRENEAU = 24;
export const HAUTEUR_CRENEAU_TELEPHONE = 40;
const DUREE_CRENEAU_MINUTES = 30;
const HAUTEUR_LIGNE = 13;
// Écart entre deux blocs + marges intérieures + bordure pointillée d'un RDV adaptable.
const MARGES_BLOC = 8;
const DUREE_PAR_DEFAUT = 60;
// Liseré noir d'une visite dont le devis est fait : il prend 8 px de hauteur dans le
// bloc (`.fc .fc-timegrid-event.mdh-quoted`), donc une ligne de moins en une heure.
export const MARGE_LISERE = 8;

/**
 * Nombre de lignes de texte qui tiennent dans le bloc d'un RDV de la grille horaire.
 * @param {number} dureeMinutes
 * @param {number} [hauteurCreneau]  hauteur d'un créneau de 30 min, en pixels
 * @param {number} [margeSupplementaire]  hauteur prise par un cadre intérieur (liseré), en pixels
 * @returns {number} au moins 1
 */
export function lignesDisponibles(dureeMinutes, hauteurCreneau = HAUTEUR_CRENEAU, margeSupplementaire = 0) {
  const duree = dureeMinutes > 0 ? dureeMinutes : DUREE_PAR_DEFAUT;
  const hauteur = (duree / DUREE_CRENEAU_MINUTES) * hauteurCreneau - MARGES_BLOC - margeSupplementaire;
  return Math.max(1, Math.floor(hauteur / HAUTEUR_LIGNE));
}

/**
 * Heure courte : « 8h », « 8h40 ».
 * @param {Date|null|undefined} date
 * @returns {string} vide si la date est absente ou invalide
 */
export function heureCourte(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const m = date.getMinutes();
  return `${date.getHours()}h${m ? String(m).padStart(2, '0') : ''}`;
}

/**
 * Créneau court : « 8h–17h », « 8h40–9h40 » ; le début seul si la fin manque.
 * @param {Date|null|undefined} debut
 * @param {Date|null|undefined} fin
 * @returns {string}
 */
export function creneauCourt(debut, fin) {
  const d = heureCourte(debut);
  const f = heureCourte(fin);
  return d && f ? `${d}–${f}` : d;
}

/**
 * Gabarit selon la vue et la place disponible.
 * @param {{ vue?: string, dureeMinutes?: number, hauteurCreneau?: number, margeSupplementaire?: number }} p
 * @returns {{ gabarit: 'ligne'|'deux'|'trois'|'plein', lignesNom: number }}
 */
export function gabaritVignette({ vue = 'timeGridWeek', dureeMinutes, hauteurCreneau, margeSupplementaire = 0 } = {}) {
  // Vues liste (téléphone, tablette) : une ligne de tableau par RDV, l'heure a sa colonne.
  if (vue.startsWith('list')) return { gabarit: 'deux', lignesNom: 1 };
  // Vue Mois : une ligne par RDV.
  if (vue.startsWith('dayGrid')) return { gabarit: 'ligne', lignesNom: 1 };
  const lignes = lignesDisponibles(dureeMinutes, hauteurCreneau, margeSupplementaire);
  if (lignes <= 1) return { gabarit: 'ligne', lignesNom: 1 };
  if (lignes === 2) return { gabarit: 'deux', lignesNom: 1 };
  if (lignes <= 4) return { gabarit: 'trois', lignesNom: lignes - 2 };
  return { gabarit: 'plein', lignesNom: Math.min(3, lignes - 3) };
}

/**
 * Tout ce que la vignette affiche, déjà mis en forme.
 * @param {object} p
 * @param {{ client_name?: string|null, client_first_name?: string|null, subject?: string|null,
 *   grand_secteur?: string|null, city?: string|null, typeConfig?: { label?: string, shortLabel?: string } }} p.rdv
 * @param {Date|null} [p.debut]
 * @param {Date|null} [p.fin]
 * @param {string} [p.vue]              type de vue FullCalendar
 * @param {number} [p.hauteurCreneau]
 * @param {number} [p.margeSupplementaire]  cf. lignesDisponibles (MARGE_LISERE pour un devis fait)
 * @returns {{ gabarit: string, lignesNom: number, heure: string, type: string, nom: string, zone: string, infobulle: string }}
 */
export function modeleVignette({ rdv, debut = null, fin = null, vue = 'timeGridWeek', hauteurCreneau, margeSupplementaire = 0 } = {}) {
  const dureeMinutes = debut && fin ? Math.round((fin.getTime() - debut.getTime()) / 60000) : null;
  const { gabarit, lignesNom } = gabaritVignette({ vue, dureeMinutes, hauteurCreneau, margeSupplementaire });

  const typeComplet = rdv?.typeConfig?.label || '';
  const typeCourt = rdv?.typeConfig?.shortLabel || typeComplet;
  const client = [rdv?.client_name, rdv?.client_first_name].filter(Boolean).join(' ').trim();
  // RDV sans client (réunion, congés) : son objet, s'il dit autre chose que le type.
  const objet = String(rdv?.subject || '').trim();
  const nom = client || (objet && objet !== typeComplet ? objet : '');
  const zone = String(rdv?.grand_secteur || rdv?.city || '').trim();
  const creneau = creneauCourt(debut, fin);

  return {
    gabarit,
    lignesNom,
    // Une ligne : le début suffit, la hauteur du bloc dit la fin. Liste : l'heure a sa colonne.
    heure: vue.startsWith('list') ? '' : (gabarit === 'ligne' ? heureCourte(debut) : creneau),
    type: gabarit === 'plein' ? typeComplet : typeCourt,
    nom,
    zone,
    infobulle: [creneau, typeComplet, nom, zone].filter(Boolean).join(' · '),
  };
}
