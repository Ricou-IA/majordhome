/**
 * useParcoursImport.js - Import des clients
 * ============================================================================
 * Parcours de l'import en quatre étapes (fichier → correspondance → aperçu →
 * résultat), tenu par un seul réducteur. Rien n'est calculé ici : chaque règle
 * vient d'un module pur de src/lib/importClients/.
 *
 * Le classement des lignes (prête, doublon, écartée) est DÉRIVÉ du fichier, de
 * la correspondance et des clients existants (useMemo), jamais recopié dans
 * l'état. Seule exception assumée : `envoi`, la photo de ce qui est parti à
 * l'écriture, pour que le résultat ne bouge pas quand la liste des clients
 * existants se relit (les fiches tout juste créées y deviendraient des doublons).
 * ============================================================================
 */

import { useReducer, useMemo } from 'react';
import { useExistingClientsForImport } from '@hooks/useClientImports';
import { LIGNES_MAX, trouverEntete, tableau } from '@/lib/importClients/lireFichier';
import {
  estFichierType, proposerCorrespondance, validerCorrespondance, appliquerCorrespondance,
} from '@/lib/importClients/correspondance';
import { classerLignes, bilan as bilanImport } from '@/lib/importClients/controles';

const choixVides = () => ({ importer: new Set(), ecarter: new Set() });

const ETAT_INITIAL = {
  etape: 'fichier',
  lecture: 'repos', // 'repos' | 'en_cours'
  refus: null, // message affiché à l'étape Fichier
  fichier: null, // { nom, matrice, indexEntete, entetes, lignes }
  sourceLabel: '',
  correspondance: [],
  choix: choixVides(),
  envoi: null, // { classees, choix } au lancement de l'écriture
  avis: null, // message affiché à l'aperçu après un import arrêté
};

/** Fichier découpé à partir de la ligne d'en-tête choisie. */
function decouper(nom, matrice, indexEntete) {
  const { entetes, lignes } = tableau(matrice, indexEntete);
  return { nom, matrice, indexEntete, entetes, lignes };
}

function basculer(ensemble, numero) {
  const suivant = new Set(ensemble);
  if (suivant.has(numero)) suivant.delete(numero); else suivant.add(numero);
  return suivant;
}

function reducteur(etat, action) {
  switch (action.type) {
    case 'lecture':
      return { ...etat, lecture: 'en_cours', refus: null };
    case 'refus':
      return { ...etat, lecture: 'repos', refus: action.message };
    case 'fichier_lu': {
      const fichier = decouper(action.nom, action.matrice, trouverEntete(action.matrice));
      if (fichier.lignes.length > LIGNES_MAX) {
        return { ...etat, lecture: 'repos', refus: 'Plus de 10 000 lignes : découpez le fichier.' };
      }
      if (fichier.lignes.length === 0) {
        return { ...etat, lecture: 'repos', refus: 'Ce fichier ne contient aucune ligne de client.' };
      }
      const correspondance = proposerCorrespondance(fichier.entetes);
      // Un fichier type n'a rien à faire pointer : on va droit à l'aperçu, sauf si une colonne reste à choisir
      // (colonne en double) ou si la correspondance a une erreur — l'écran Correspondance le dit alors.
      const { erreurs, aChoisir } = validerCorrespondance(correspondance);
      const direct = estFichierType(fichier.entetes) && erreurs.length === 0 && aChoisir === 0;
      return {
        ...etat,
        lecture: 'repos',
        refus: null,
        fichier,
        correspondance,
        choix: choixVides(),
        envoi: null,
        avis: null,
        etape: direct ? 'apercu' : 'correspondance',
      };
    }
    case 'entete': {
      if (!etat.fichier) return etat;
      const fichier = decouper(etat.fichier.nom, etat.fichier.matrice, action.index);
      return { ...etat, fichier, correspondance: proposerCorrespondance(fichier.entetes), choix: choixVides() };
    }
    case 'cible':
      return {
        ...etat,
        correspondance: etat.correspondance.map((c) => (c.index === action.index ? { ...c, cible: action.cible, origine: 'main' } : c)),
      };
    case 'source':
      return { ...etat, sourceLabel: action.valeur };
    case 'vers_apercu':
      return { ...etat, etape: 'apercu' };
    case 'vers_correspondance':
      return { ...etat, etape: 'correspondance', choix: choixVides(), avis: null };
    case 'vers_fichier':
      return { ...ETAT_INITIAL, sourceLabel: etat.sourceLabel };
    case 'importer':
      return { ...etat, choix: { ...etat.choix, importer: basculer(etat.choix.importer, action.numero) } };
    case 'ecarter':
      return { ...etat, choix: { ...etat.choix, ecarter: basculer(etat.choix.ecarter, action.numero) } };
    case 'envoi':
      return { ...etat, etape: 'resultat', envoi: { classees: action.classees, choix: etat.choix }, avis: null };
    case 'retour_apercu':
      return { ...etat, etape: 'apercu', envoi: null };
    // Import interrompu puis arrêté : retour à l'aperçu (les fiches déjà créées y deviennent des doublons) avec un avis.
    case 'arret':
      return { ...etat, etape: 'apercu', envoi: null, choix: choixVides(), avis: action.message };
    default:
      return etat;
  }
}

/**
 * @param {string} orgId
 */
export function useParcoursImport(orgId) {
  const [etat, dispatch] = useReducer(reducteur, ETAT_INITIAL);
  const { fichier, correspondance, choix } = etat;

  // Les clients existants ne sont demandés qu'une fois un fichier chargé, et plus pendant l'écriture.
  const existants = useExistingClientsForImport(orgId, { enabled: !!fichier && etat.etape !== 'resultat' });

  const validation = useMemo(() => validerCorrespondance(correspondance), [correspondance]);

  // Classement calculé à l'étape Aperçu seulement : à l'étape Correspondance chaque choix de liste
  // relancerait le contrôle de toutes les lignes pour rien. À l'étape Résultat, c'est la photo `envoi` qui sert.
  const surApercu = etat.etape === 'apercu';
  const candidates = useMemo(
    () => (fichier && surApercu ? fichier.lignes.map((l) => appliquerCorrespondance(l, correspondance)) : null),
    [fichier, correspondance, surApercu],
  );

  // Liste des clients existants inconnue ⇒ pas de classement (jamais « aucun doublon » supposé).
  const classees = useMemo(
    () => (candidates && existants.clients ? classerLignes(candidates, existants.clients) : null),
    [candidates, existants.clients],
  );

  const bilan = useMemo(() => (classees ? bilanImport(classees, choix) : null), [classees, choix]);

  const actions = useMemo(() => ({
    debutLecture: () => dispatch({ type: 'lecture' }),
    refuser: (message) => dispatch({ type: 'refus', message }),
    fichierLu: (nom, matrice) => dispatch({ type: 'fichier_lu', nom, matrice }),
    changerEntete: (index) => dispatch({ type: 'entete', index }),
    changerCible: (index, cible) => dispatch({ type: 'cible', index, cible }),
    changerSource: (valeur) => dispatch({ type: 'source', valeur }),
    versApercu: () => dispatch({ type: 'vers_apercu' }),
    versCorrespondance: () => dispatch({ type: 'vers_correspondance' }),
    versFichier: () => dispatch({ type: 'vers_fichier' }),
    basculerImporter: (numero) => dispatch({ type: 'importer', numero }),
    basculerEcarter: (numero) => dispatch({ type: 'ecarter', numero }),
    envoyer: (lignesClassees) => dispatch({ type: 'envoi', classees: lignesClassees }),
    retourApercu: () => dispatch({ type: 'retour_apercu' }),
    arreter: (message) => dispatch({ type: 'arret', message }),
  }), []);

  return { etat, actions, existants, validation, classees, bilan, relireExistants: existants.refetch };
}
