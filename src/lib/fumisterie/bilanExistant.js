// src/lib/fumisterie/bilanExistant.js
// Bilan du conduit existant (tubage G4…, raccordement seul G5) et justification du dimensionnement —
// module PUR. Façon Conduits'Réno : constats saisis (facultatifs), non-conformités repérées avec leur
// article, points à vérifier pour tout ce qui n'a pas été relevé. Une donnée absente n'est JAMAIS supposée
// conforme. Calculé à l'injection et figé dans le résultat du métré (la fiche chantier le relit).
// Sources : NF DTU 24.1 § 15.1, 15.2.1 (Tableau 13), 15.2.2, 15.3.3 ; Cahier CSTB 3708 § 3.5.1.3.
import { lireComplement, COMPLEMENTS } from './complements.js';
import { natureInstallation } from './controles.js';

const EXISTANT = ['G4', 'G4R', 'G4P', 'G4K', 'G4F', 'G5'];
const fmt = (v, d = 1) => (Number.isInteger(v) ? String(v) : Number(v).toFixed(d).replace('.', ','));
const libelle = (cle, v) => COMPLEMENTS.find((c) => c.cle === cle)?.libelles?.[v] ?? String(v);

/** Tableau 13 du NF DTU 24.1 : épaisseur minimale des parois (cm) pour qu'un conduit ancien soit assimilé T400 G. */
export const EPAISSEUR_MIN_CM = Object.freeze({ briques: 10.5, boisseaux_terre_cuite: 5, beton: 5, pierre_dure: 10, pierre_tendre: 15 });
/** Cahier CSTB 3708 § 3.5.1.3 : section intérieure minimale (cm) du conduit existant selon le Ø des fumées, air dans l'espace annulaire. */
export const SECTION_MIN_ETANCHE_CM = Object.freeze({ 80: 14, 100: 16, 130: 19, 150: 21 });
const DISTANCE_SATISFAISANTE_CM = 16;
const DISTANCE_MINIMALE_CM = 4;

/**
 * @param {Record<string, unknown>} releve
 * @param {string} gabaritCode
 * @param {{ appareil_etanche_requis?: boolean, combustibles?: string[] } | null} [configuration]
 * @returns {{ constats: string[], nonConformites: { code: string, texte: string, source: string }[], aVerifier: string[] } | null}
 */
export function bilanConduitExistant(releve, gabaritCode, configuration) {
  if (!EXISTANT.includes(gabaritCode)) return null;
  const v = (cle) => lireComplement(releve, cle);
  const nature = v('existantNature'); const a = v('existantSectionA'); const b = v('existantSectionB');
  const ep = v('existantEpaisseur'); const dist = v('existantDistanceCombustible');
  const vac = v('existantVacuite'); const etat = v('existantEtat'); const deb = v('existantDebouche');
  const constats = []; const nonConformites = []; const aVerifier = [];
  const nc = (code, texte, source) => nonConformites.push({ code, texte, source });

  if (nature) constats.push(`Nature : ${libelle('existantNature', nature).toLowerCase()}`); else aVerifier.push('Nature du conduit existant');
  if (a != null) constats.push(`Section intérieure : ${b != null ? `${fmt(a)} × ${fmt(b)} cm` : `Ø ${fmt(a)} cm`}`); else aVerifier.push('Section intérieure du conduit existant');
  if (gabaritCode !== 'G5' && Number(releve?.hConduit) > 0) constats.push(`Hauteur : ${Number(releve.hConduit).toFixed(2).replace('.', ',')} m`);
  if (vac) constats.push(`Vacuité : ${vac === 'oui' ? 'ogive passée sur toute la hauteur' : 'l\'ogive ne passe pas'}`); else aVerifier.push('Vacuité : passage de l\'ogive sur toute la hauteur');
  if (etat) constats.push(`État : ${libelle('existantEtat', etat).toLowerCase()}`); else aVerifier.push('État du conduit (stabilité, intégrité)');
  if (deb) constats.push(`Débouché : ${libelle('existantDebouche', deb).toLowerCase()}`); else aVerifier.push('Débouché (hauteur au-dessus des constructions à moins de 8 m)');
  if (ep != null) constats.push(`Épaisseur des parois : ${fmt(ep)} cm`); else if (nature !== 'metal') aVerifier.push('Épaisseur des parois (Tableau 13)');
  if (dist != null) constats.push(`Distance paroi intérieure → combustible : ${fmt(dist)} cm`); else aVerifier.push('Distance aux matériaux combustibles');

  if (vac === 'non') nc('existant_vacuite', 'L\'ogive ne passe pas : le conduit ne peut pas être tubé en l\'état.', 'NF DTU 24.1 § 15.3.3');
  if (etat === 'a_reprendre') nc('existant_etat', 'Conduit à reprendre avant tout tubage : le tubage ne rétablit ni la stabilité ni l\'intégrité.', 'NF DTU 24.1 § 15.1');
  if (etat === 'fissure') aVerifier.push('Étanchéité du conduit fissuré (essai fumigène)');
  if (deb === 'non_conforme') nc('existant_debouche', 'Débouché non conforme : rehausse à prévoir.', 'NF DTU 24.1 § 15.7, arrêté du 22/10/1969 art. 18');
  const min = EPAISSEUR_MIN_CM[nature];
  if (min != null && ep != null && ep < min) nc('existant_epaisseur', `Parois de ${fmt(ep)} cm : ${fmt(min)} cm au moins pour ce matériau.`, 'NF DTU 24.1 § 15.2.1, Tableau 13');
  if (dist != null && dist < DISTANCE_MINIMALE_CM) nc('existant_distance', `${fmt(dist)} cm du combustible : tubage refusé pour un combustible solide (${DISTANCE_MINIMALE_CM} cm au moins).`, 'NF DTU 24.1 § 15.2.2');
  else if (dist != null && dist < DISTANCE_SATISFAISANTE_CM) nc('existant_distance', `${fmt(dist)} cm du combustible (${DISTANCE_SATISFAISANTE_CM} cm depuis la paroi intérieure pour un conduit thermiquement satisfaisant) : désignation du tubage à calculer, client informé.`, 'NF DTU 24.1 § 15.2.1, 15.2.2');
  if (natureInstallation(configuration) === 'etanche_granules' && a != null) {
    const requis = SECTION_MIN_ETANCHE_CM[Number(releve?.diametre)];
    const plusPetit = b != null ? Math.min(a, b) : a;
    if (requis != null && plusPetit < requis) nc('existant_section', `Section de ${fmt(plusPetit)} cm : ${requis} cm au moins pour des fumées en Ø${releve.diametre} avec l'air dans l'espace annulaire.`, 'Cahier CSTB 3708 § 3.5.1.3');
  }
  return { constats, nonConformites, aVerifier };
}

const JUSTIFICATIONS = { notice: 'Notice de l\'appareil', couplage: 'Essai de couplage', abaque: 'Abaque', logiciel: 'Logiciel', non_justifie: 'Non justifié' };

/**
 * Justification du dimensionnement, en clair (absente = notice de l'appareil).
 * @param {Record<string, unknown>} releve
 * @returns {{ mode: string, texte: string }}
 */
export function justificationDimensionnement(releve) {
  const mode = lireComplement(releve, 'justification') || 'notice';
  const ref = lireComplement(releve, 'justificationReference');
  return { mode, texte: ref && mode !== 'non_justifie' ? `${JUSTIFICATIONS[mode]} : ${ref}` : JUSTIFICATIONS[mode] };
}
