/**
 * useColonnesRepliees.js - Majord'home
 * ============================================================================
 * État « replié / déplié » des colonnes repliables d'un Kanban, gardé par
 * utilisateur dans le navigateur (`cleColonnesRepliees(user.id)`). Les règles
 * sont dans src/lib/kanbanColonnes.js ; ce hook ne fait que lire et écrire.
 *
 * Sans colonne repliable (tous les Kanbans sauf celui des leads) : aucune
 * colonne n'est repliée et rien n'est lu ni écrit.
 * Stockage indisponible (navigation privée, données bloquées) : le choix tient
 * le temps de la page.
 * ============================================================================
 */

import { useCallback, useContext, useMemo, useState } from 'react';
import AuthContext from '@/contexts/AuthContext';
import {
  colonneRepliee, basculerColonne, lirePreferencesColonnes, cleColonnesRepliees,
} from '@/lib/kanbanColonnes';

const AUCUNE = Object.freeze({});

function lire(cle) {
  if (!cle) return {};
  try {
    return lirePreferencesColonnes(window.localStorage.getItem(cle));
  } catch {
    return {};
  }
}

/**
 * @param {string[]|undefined} colonnesRepliables - clés des colonnes repliées par défaut
 * @returns {{ estRepliable: (cle: string) => boolean, estRepliee: (cle: string) => boolean, basculer: (cle: string) => void }}
 */
export function useColonnesRepliees(colonnesRepliables) {
  // Contexte lu sans `useAuth` : un Kanban monté hors du fournisseur ne plante pas,
  // il garde seulement le choix le temps de la page.
  const userId = useContext(AuthContext)?.user?.id ?? null;
  // Clé stable même si l'appelant passe un nouveau tableau à chaque rendu.
  const signature = Array.isArray(colonnesRepliables) ? colonnesRepliables.join('|') : '';
  const repliables = useMemo(() => (signature ? signature.split('|') : []), [signature]);
  const cle = userId && repliables.length > 0 ? cleColonnesRepliees(userId) : null;

  const [etat, setEtat] = useState(() => ({ cle, preferences: lire(cle) }));
  // Changement d'utilisateur : relire ses préférences (état ajusté pendant le rendu).
  if (etat.cle !== cle) setEtat({ cle, preferences: lire(cle) });
  const preferences = etat.cle === cle ? etat.preferences : AUCUNE;

  const estRepliable = useCallback((col) => repliables.includes(col), [repliables]);
  const estRepliee = useCallback(
    (col) => colonneRepliee(col, preferences, repliables),
    [preferences, repliables],
  );
  const basculer = useCallback((col) => {
    const preferencesSuivantes = basculerColonne(col, preferences, repliables);
    if (cle) {
      try {
        window.localStorage.setItem(cle, JSON.stringify(preferencesSuivantes));
      } catch {
        // Stockage indisponible : le choix tient le temps de la page.
      }
    }
    setEtat({ cle, preferences: preferencesSuivantes });
  }, [cle, preferences, repliables]);

  return { estRepliable, estRepliee, basculer };
}
