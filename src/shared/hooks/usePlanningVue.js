/**
 * usePlanningVue.js - Majord'home Artisan
 * ============================================================================
 * Ce que le calendrier du Planning affiche : la vue, son titre, le numéro de
 * semaine, la plage chargée et la période annoncée. Tout vient du calendrier
 * lui-même (`datesSet`) ; lecture pure dans src/lib/planningGestes.js (testée).
 * ============================================================================
 */

import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { plageDeVue, valeurUrlDeVue } from '@/lib/planningGestes';

/**
 * @param {object} p
 * @param {{ current: { getApi: () => object }|null }} p.calendarRef  réf. du composant FullCalendar
 * @param {string} p.vueInitiale  type de vue au montage
 * @returns {{ vue: string, titre: string, semaine: number|null,
 *   plage: { startDate: string|null, endDate: string|null }, periode: { debut: string, finExclue: string }|null,
 *   surDates: (info: object) => void, changerDeVue: (vue: string) => void, allerAuJour: (date: string) => void }}
 *   `plage` reste vide tant que le calendrier ne l'a pas annoncée (dès son montage) : rien ne
 *   se charge avant — un défaut « pour précharger » lançait trois mois de RDV sous une clé de
 *   cache que la semaine affichée ne réutilisait jamais. `periode` ≠ `plage` en vue Mois (la
 *   grille déborde sur les mois voisins) : c'est elle qui borne le cumul du CA.
 */
export function usePlanningVue({ calendarRef, vueInitiale }) {
  const [, setSearchParams] = useSearchParams();
  const [etat, setEtat] = useState({
    vue: vueInitiale, titre: '', semaine: null, plage: { startDate: null, endDate: null }, periode: null,
  });

  // La vue ou les dates changent.
  const surDates = useCallback((info) => {
    const suivant = plageDeVue(info);
    // Vue et début de période dans l'URL (brief UX P1-09), sans empiler l'historique à chaque flèche.
    const vueUrl = valeurUrlDeVue(suivant.vue);
    setSearchParams((prev) => {
      if (prev.get('vue') === vueUrl && prev.get('date') === suivant.periode.debut) return prev;
      const p = new URLSearchParams(prev);
      if (vueUrl) p.set('vue', vueUrl); else p.delete('vue');
      p.set('date', suivant.periode.debut);
      return p;
    }, { replace: true });
    // Mêmes bornes ⇒ mêmes objets : la plage et la période alimentent des requêtes et des calculs.
    setEtat((e) => ({
      ...suivant,
      plage: e.plage.startDate === suivant.plage.startDate && e.plage.endDate === suivant.plage.endDate ? e.plage : suivant.plage,
      periode: e.periode?.debut === suivant.periode.debut && e.periode?.finExclue === suivant.periode.finExclue
        ? e.periode : suivant.periode,
    }));
  }, [setSearchParams]);

  const changerDeVue = useCallback((vue) => {
    calendarRef.current?.getApi().changeView(vue);
    setEtat((e) => ({ ...e, vue }));
  }, [calendarRef]);

  const allerAuJour = useCallback((date) => {
    calendarRef.current?.getApi().gotoDate(date);
  }, [calendarRef]);

  return { ...etat, surDates, changerDeVue, allerAuJour };
}
