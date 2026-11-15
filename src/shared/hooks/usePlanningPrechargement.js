/**
 * usePlanningPrechargement.js - Majord'home Artisan
 * ============================================================================
 * Charge d'avance les semaines (ou jours) voisins de la plage affichée, pour
 * que « précédent » et « suivant » s'affichent sans attente : sans cela, une
 * semaine jamais vue reste vide une demi-seconde puis se remplit en trois
 * vagues (RDV, puis techniciens et chantiers, puis chiffre) — mesuré le
 * 2026-11-15 : 750 ms, contre 70 ms pour une semaine déjà en cache.
 *
 * Mêmes requêtes que l'affichage (planningQueries) : ce qui est préchargé est
 * exactement ce que le calendrier relira. Rien n'est affiché d'ici, et un
 * préchargement qui échoue ne dit rien : la requête de l'affichage repartira
 * et portera l'erreur.
 * ============================================================================
 */

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { planningQueries, dependancesDesRdv } from '@hooks/planningQueries';
import { plagesVoisines } from '@/lib/planningGestes';

// Une plage préchargée depuis moins d'une minute n'est pas redemandée (aller-retour entre deux semaines).
const FRAICHEUR_MS = 60_000;
// On laisse la plage affichée finir de se dessiner avant de demander ses voisines.
const DELAI_MS = 400;

async function prechargerPlage(queryClient, { orgId, startDate, endDate, filtres, voitCharge }) {
  const frais = (requete) => queryClient.prefetchQuery({ ...requete, staleTime: FRAICHEUR_MS });
  const liste = planningQueries.list(orgId, startDate, endDate, filtres);
  const independantes = [
    frais(planningQueries.journeesSecteur(orgId, startDate, endDate)),
    voitCharge ? frais(planningQueries.caAffaires(orgId, startDate, endDate)) : null,
  ];
  await frais(liste);
  // Les RDV sont en cache : leurs requêtes dépendantes partent ensemble.
  const { appointmentIds, chantierIds, vtLeadIds } = dependancesDesRdv(queryClient.getQueryData(liste.queryKey)?.data);
  await Promise.all([
    ...independantes,
    appointmentIds.length ? frais(planningQueries.technicians(orgId, appointmentIds)) : null,
    chantierIds.length ? frais(planningQueries.chantierOrders(orgId, chantierIds)) : null,
    vtLeadIds.length ? frais(planningQueries.quotedLeads(orgId, vtLeadIds)) : null,
  ]);
}

/**
 * @param {object} p
 * @param {string} p.orgId  org CORE
 * @param {string} p.vue  type de vue FullCalendar
 * @param {string|null} p.startDate  plage affichée
 * @param {string|null} p.endDate
 * @param {string|null} [p.appointmentType]  filtres qui restreignent les RDV chargés
 * @param {string|null} [p.status]
 * @param {boolean} p.voitCharge  le CA n'est préchargé que pour qui le voit
 * @param {boolean} p.pret  la plage affichée a fini de charger
 */
export function usePlanningPrechargement({ orgId, vue, startDate, endDate, appointmentType = null, status = null, voitCharge, pret }) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!pret || !orgId) return undefined;
    const voisines = plagesVoisines({ vue, startDate, endDate });
    if (voisines.length === 0) return undefined;
    const minuterie = setTimeout(() => {
      for (const plage of voisines) {
        // prefetchQuery ne rejette jamais ; le garde-fou couvre le reste (cache illisible).
        prechargerPlage(queryClient, { orgId, ...plage, filtres: { appointmentType, status }, voitCharge }).catch(() => {});
      }
    }, DELAI_MS);
    return () => clearTimeout(minuterie);
  }, [queryClient, orgId, vue, startDate, endDate, appointmentType, status, voitCharge, pret]);
}
