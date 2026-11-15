/**
 * planningCharge.js - Majord'home Artisan
 * ============================================================================
 * Lignes de charge du Planning : une ligne par technicien et par jour, sous
 * l'en-tête du jour (état de la journée, zone de travail, part du CA programmé).
 * Module PUR (aucun import React / Supabase), testé par
 * scripts/planning-charge.test.mjs — Planning.jsx et JourneeEtatChips ne font
 * qu'afficher ce qu'il rend.
 *
 * Ce sont les chiffres de la PRODUCTION (Eric, 2026-11-15) :
 *   - seules les interventions comptent (installation, entretien, SAV) : un RDV
 *     « Autre » ou commercial n'ouvre pas de ligne ;
 *   - une personne en congés n'a pas de ligne (jour férié : personne) ;
 *   - un technicien qui travaille ce jour-là et n'a aucune intervention a une
 *     ligne « Vide » — c'est l'indicateur d'un planning à remplir ;
 *   - une personne qui n'est pas technicien n'a de ligne que si elle est posée
 *     sur une intervention (sa part du chantier doit se lire quelque part).
 * ============================================================================
 */

import { appointmentKind, villesDeJournee } from './planningEvents.js';
import { memberWorkingHoursForDate } from './scheduleConflicts.js';
import { deduireSecteur } from './tournee/etat.js';

const STATUTS_EXCLUS = ['cancelled', 'no_show'];

/**
 * Ce qui compte dans la charge d'une personne un jour donné : ses interventions
 * (installation, entretien, SAV) non annulées. En congés = aucune intervention
 * et au moins un congé posé.
 * @param {Array<{ appointment_type?: string, status?: string }>|null} [rdvs]
 * @returns {{ interventions: Array<object>, enConges: boolean }}
 */
export function chargeDuJour(rdvs) {
  const actifs = (rdvs || []).filter((r) => !STATUTS_EXCLUS.includes(r?.status));
  const interventions = actifs.filter((r) => appointmentKind(r?.appointment_type) === 'intervention');
  return {
    interventions,
    enConges: interventions.length === 0 && actifs.some((r) => r?.appointment_type === 'leave'),
  };
}

/**
 * Jours ISO d'une plage `[debut, finExclue[`.
 * @param {string|null|undefined} debut      `YYYY-MM-DD`
 * @param {string|null|undefined} finExclue  `YYYY-MM-DD`
 * @returns {string[]}
 */
export function joursDeLaPlage(debut, finExclue) {
  if (!debut || !finExclue) return [];
  const jours = [];
  const d = new Date(`${debut}T12:00:00`);
  if (Number.isNaN(d.getTime())) return [];
  // Garde : une plage de calendrier ne dépasse jamais six semaines.
  for (let i = 0; i < 62; i += 1) {
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (iso >= finExclue) break;
    jours.push(iso);
    d.setDate(d.getDate() + 1);
  }
  return jours;
}

/**
 * Lignes de charge de la plage affichée.
 *
 * @param {object} p
 * @param {Map<string, object>} [p.etatsMoteur]  états du moteur de tournées (useEtatsJournees), clé `${date}|${technicienId}` —
 *   il ne juge que les jours à venir des techniciens qu'il planifie
 * @param {boolean} [p.moteurEnChargement]  vrai tant que ces états ne sont pas connus
 * @param {Array<{ id: string, role?: string, include_in_routing?: boolean, display_name?: string, calendar_color?: string, default_availability?: object }>} [p.membres]
 * @param {Array<{ id: string, scheduled_date?: string, technician_ids?: string[], appointment_type?: string, status?: string }>} [p.rdvs]
 *   RDV de la plage
 * @param {boolean} [p.rdvsPartiels]  vrai quand ces RDV sont restreints par un filtre de type ou de statut :
 *   on ne peut alors pas dire qu'une journée est vide — ni ligne « Vide » déduite, ni « 0 € »
 * @param {boolean} [p.rdvsEnChargement]  vrai tant que les RDV de la plage OU leurs techniciens ne sont pas chargés :
 *   chaque technicien au travail garde une ligne « en attente » (son nom seul), pour que l'en-tête ne change pas de
 *   hauteur quand la réponse arrive — et jamais un « Vide · 0 € » affiché le temps d'une requête
 * @param {string|null} [p.debut]      plage affichée, `YYYY-MM-DD`
 * @param {string|null} [p.finExclue]
 * @param {Set<string>|null} [p.filtreIds]  personnes affichées (filtre équipe) ; null = toute l'équipe
 * @param {string} [p.aujourdhui]  `YYYY-MM-DD`
 * @returns {Map<string, object>} clé `${date}|${technicienId}`
 */
export function lignesDeCharge({
  etatsMoteur = new Map(), moteurEnChargement = false, membres = [], rdvs = [], rdvsPartiels = false,
  rdvsEnChargement = false,
  debut = null, finExclue = null, filtreIds = null, aujourdhui = new Date().toLocaleDateString('fr-CA'),
} = {}) {
  const lignes = new Map();
  const affiche = (id) => !filtreIds || filtreIds.has(id);
  const membreParId = new Map((membres || []).map((m) => [m.id, m]));

  // RDV de chaque personne × jour.
  const rdvsParCle = new Map();
  for (const r of rdvs || []) {
    if (!r?.scheduled_date) continue;
    for (const techId of r.technician_ids || []) {
      const cle = `${r.scheduled_date}|${techId}`;
      if (!rdvsParCle.has(cle)) rdvsParCle.set(cle, []);
      rdvsParCle.get(cle).push(r);
    }
  }

  // Personnes × jours à examiner : les techniciens chaque jour de la plage, toute
  // personne posée sur un RDV, et les journées que le moteur a jugées.
  const cles = new Set([...rdvsParCle.keys(), ...etatsMoteur.keys()]);
  const techniciens = (membres || []).filter((m) => m.role === 'technician');
  for (const date of joursDeLaPlage(debut, finExclue)) {
    for (const m of techniciens) cles.add(`${date}|${m.id}`);
  }

  for (const cle of cles) {
    const [date, technicienId] = cle.split('|');
    if (!affiche(technicienId)) continue;
    const { interventions, enConges } = chargeDuJour(rdvsParCle.get(cle));
    const moteur = etatsMoteur.get(cle);
    // En congés : pas de ligne, quelle que soit la personne. (`moteur.enConges` :
    // le moteur le sait avant que les RDV de la plage soient chargés.)
    const aucune = interventions.length === 0;
    if (enConges || (moteur?.enConges && aucune)) continue;
    const sansIntervention = aucune && !rdvsPartiels && !rdvsEnChargement;

    if (moteur) {
      lignes.set(cle, {
        ...moteur,
        enConges: false,
        sansIntervention,
        // Journée sans grand secteur (jour d'installation) : la ville de travail.
        lieu: moteur.etiquette ? null : villesDeJournee(interventions),
      });
      continue;
    }

    const membre = membreParId.get(technicienId);
    if (!membre) continue;
    const horsTournees = membre.role === 'technician' && membre.include_in_routing !== true;
    const moteurAttendu = !horsTournees && membre.role === 'technician' && date >= aujourdhui;
    const base = {
      date,
      technicienId: membre.id,
      technicienNom: String(membre.display_name || '').trim(),
      couleur: membre.calendar_color,
      enConges: false,
      sansIntervention,
    };

    // Ligne « en attente » : la place du technicien est tenue (son nom, sans état ni
    // chiffre) tant qu'une réponse manque — verdict du moteur, RDV ou leurs techniciens.
    const auTravail = membre.role === 'technician' && !!memberWorkingHoursForDate(membre, date);
    const tenirLaPlace = () => {
      if (auTravail) lignes.set(cle, { ...base, sansIntervention: false, etat: 'attente', nbRdvs: 0, etiquette: null, lieu: null });
    };

    if (!aucune) {
      // Jour à venir d'une personne que le moteur planifie : on attend son verdict.
      if (moteurAttendu && moteurEnChargement) { tenirLaPlace(); continue; }
      lignes.set(cle, {
        ...base,
        etat: horsTournees ? 'manuelle' : 'sans_etat',
        nbRdvs: interventions.length,
        // Zone de travail : grand secteur des entretiens du jour, sinon la ville.
        etiquette: deduireSecteur(interventions),
        lieu: villesDeJournee(interventions),
      });
      continue;
    }

    // Aucune intervention : ligne « Vide » pour un technicien qui travaille ce
    // jour-là. Le moteur dit lui-même « Vide » pour les jours à venir des
    // techniciens qu'il planifie ; ici, les jours passés et les techniciens hors tournées.
    if (rdvsEnChargement || (moteurAttendu && moteurEnChargement)) { tenirLaPlace(); continue; }
    if (rdvsPartiels || moteurAttendu || !auTravail) continue;
    lignes.set(cle, { ...base, etat: 'vide', horsMoteur: true, nbRdvs: 0, etiquette: null, lieu: null });
  }
  return lignes;
}

/**
 * Panneau qu'ouvre le clic sur une ligne de charge : la feuille de route seule pour
 * une journée d'interventions que le moteur ne juge pas (technicien hors tournées,
 * jour passé), le panneau de remplissage sinon.
 * @param {{ etat?: string }|null|undefined} ligne
 * @returns {'feuille'|'journee'}
 */
export function panneauDeLigne(ligne) {
  return ligne?.etat === 'manuelle' || ligne?.etat === 'sans_etat' ? 'feuille' : 'journee';
}

/**
 * Sort d'une journée demandée au panneau de remplissage (clic sur une ligne, ou
 * lien direct `/planning?journee=&tech=`) quand elle n'est pas dans l'horizon du moteur.
 *   - `attendre` : les tournées chargent encore, ou la plage affichée ne couvre pas la date ;
 *   - `erreur`   : le chargement des tournées a échoué ;
 *   - `absente`  : le moteur ne planifie pas cette journée (jour passé, non travaillé, hors tournées).
 * @param {object} p
 * @param {{ date: string }|null} p.demandee
 * @param {object|null} p.trouvee        la journée dans l'horizon, si elle y est
 * @param {Error|null} [p.erreur]
 * @param {boolean} [p.enChargement]
 * @param {boolean} [p.horizonConnu]
 * @param {string|null} [p.finPlage]     borne exclusive de la plage affichée
 * @returns {'aucune'|'ouverte'|'attendre'|'erreur'|'absente'}
 */
export function sortJourneeDemandee({ demandee, trouvee, erreur = null, enChargement = false, horizonConnu = false, finPlage = null }) {
  if (!demandee) return 'aucune';
  if (trouvee) return 'ouverte';
  if (erreur) return 'erreur';
  if (enChargement || !horizonConnu || !finPlage || demandee.date >= finPlage) return 'attendre';
  return 'absente';
}
