/**
 * useParcoursImportArticles.js - Import d'articles
 * ============================================================================
 * Parcours de l'import en cinq étapes (fichier → colonnes → aperçu → envoi →
 * résultat), tenu par un seul réducteur. Rien n'est calculé ici qui ne vienne
 * d'un module pur de src/lib/importArticles/ : ce hook enchaîne les règles.
 *
 * Le classement des lignes est DÉRIVÉ du fichier, de la correspondance, des
 * valeurs interprétées, des fournisseurs et des articles existants (useMemo),
 * jamais recopié dans l'état. Seule exception : `envoi`, la photo de ce qui est
 * parti à l'écriture (le résultat ne bouge pas quand la base se relit).
 *
 * Import FERMÉ (`envoiPrevu` = null) tant que les articles existants, ou les
 * fournisseurs de l'entreprise quand le fichier en porte, sont inconnus.
 * ============================================================================
 */

import { useReducer, useMemo } from 'react';
import { useCatalogImportSuppliers, useExistantArticles } from '@hooks/useCatalogImports';
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from '@services/suppliers.service';
import { NATURES_ARTICLE, UNITES_ARTICLE } from '@/lib/catalogue/natures.js';
import { LIGNES_MAX, LIMITES_TEXTE, trouverEntete, tableau } from '@/lib/importClients/lireFichier';
import { CIBLE_IGNORER } from '@/lib/importClients/champs';
import { champArticle } from '@/lib/importArticles/champs';
import {
  proposerCorrespondanceArticles, validerCorrespondanceArticles, appliquerCorrespondanceArticles,
} from '@/lib/importArticles/correspondance';
import { proposerValeurs, valeursDistinctes } from '@/lib/importArticles/valeurs';
import { rapprocherFournisseurs } from '@/lib/importArticles/fournisseurs';
import {
  controlerArticle, classerArticles, aImporter, choixPourTousLesDoublons, bilan as bilanArticles, lignesPourEcriture,
} from '@/lib/importArticles/controles';
import { verifierLigneArticle } from '@/lib/importArticles/lots';

/** Champs dont les valeurs du fichier se rapprochent de celles de Majord'home, à l'aperçu. */
export const CHAMPS_A_INTERPRETER = ['nature', 'categorie', 'unite'];

const LIBELLE_UNITE = Object.fromEntries(PRODUCT_UNITS.map((u) => [u.value, u.label]));
/** Valeurs de Majord'home proposées pour chaque champ interprété (sans les entrées « par défaut » de l'écran). */
export const OPTIONS_VALEURS = {
  nature: NATURES_ARTICLE.map((n) => ({ value: n.value, label: n.label })),
  categorie: PRODUCT_CATEGORIES.map((c) => ({ value: c.value, label: c.label })),
  unite: UNITES_ARTICLE.map((u) => ({ value: u, label: LIBELLE_UNITE[u] || u })),
};

// Identifiant provisoire d'un fournisseur « à créer » pour contrôler les lignes avant l'ouverture de l'import :
// le vrai identifiant n'existe qu'après `catalog_items_import_start`. Jamais envoyé à la base.
const FOURNISSEUR_PROVISOIRE = '00000000-0000-4000-8000-000000000000';

// Clé de ligne refusée (verifierLigneArticle) → champ du catalogue dont on affiche le libellé.
const CHAMP_DE_CLE = {
  name: 'designation', code: 'code', brand: 'marque', model_key: 'modele', modele_brut: 'modele', code_ean: 'ean',
  category: 'categorie', gamme: 'gamme', product_kind: 'nature', unit: 'unite', default_tva_rate: 'tva',
  selling_price_ht: 'prix_vente', description: 'description', ancien_numero: 'ancien_numero',
};
function raisonRefus(cle) {
  if (cle === 'fournisseur') return 'Ligne fournisseur refusée au contrôle avant envoi';
  if (cle === 'import_line') return 'Numéro de ligne refusé au contrôle avant envoi';
  const libelle = champArticle(CHAMP_DE_CLE[cle])?.libelle || cle;
  return `Valeur « ${libelle} » refusée au contrôle avant envoi`;
}

/**
 * Lignes à écrire, chacune passée par `verifierLigneArticle` : une ligne refusée devient une ligne écartée (avec sa
 * raison), jamais envoyée. Rend aussi le classement corrigé, pour que bilan et lignes écartées en tiennent compte.
 */
function preparerEcriture(classees, choix, resolus) {
  const lignes = [];
  const refus = new Map();
  for (const l of lignesPourEcriture(classees, choix, resolus)) {
    const cle = verifierLigneArticle(l);
    if (cle) refus.set(l.import_line, cle); else lignes.push(l);
  }
  const classeesFinales = refus.size === 0 ? classees : classees.map((c) => (refus.has(c.numero)
    ? { ...c, fiche: null, raison: raisonRefus(refus.get(c.numero)), doublon: null, recochable: false }
    : c));
  return { classeesFinales, lignes };
}

const VALEURS_VIDES = () => ({ nature: {}, categorie: {}, unite: {} });

const ETAT_INITIAL = {
  etape: 'fichier', // 'fichier' | 'colonnes' | 'apercu' | 'envoi'
  lecture: 'repos', // 'repos' | 'en_cours'
  refus: null, // message affiché à l'étape Fichier
  fichier: null, // { nom, matrice, reparees, indexEntete, entetes, lignes }
  correspondance: [],
  valeursChoisies: VALEURS_VIDES(), // choix de l'utilisateur, par-dessus les propositions
  nonCrees: [], // clés des fournisseurs « à créer » décochés
  choix: {}, // numéro de ligne → repris (true) / écarté (false), pour les doublons
  envoi: null, // { classees, choix } au lancement de l'écriture
  avis: null, // message affiché à l'aperçu après un import arrêté
};

function decouper(nom, matrice, indexEntete, reparees) {
  const { entetes, lignes } = tableau(matrice, indexEntete);
  return { nom, matrice, reparees, indexEntete, entetes, lignes };
}

/** Un fichier type sans rien à choisir va droit à l'aperçu. */
function droitALApercu(correspondance) {
  const { erreurs, aChoisir } = validerCorrespondanceArticles(correspondance);
  const utiles = correspondance.filter((c) => c.cible !== CIBLE_IGNORER);
  return erreurs.length === 0 && aChoisir === 0 && utiles.length > 0 && utiles.every((c) => c.origine === 'fichier_type');
}

const remiseAZero = { valeursChoisies: VALEURS_VIDES(), nonCrees: [], choix: {}, envoi: null, avis: null };

function reducteur(etat, action) {
  switch (action.type) {
    case 'lecture':
      return { ...etat, lecture: 'en_cours', refus: null };
    case 'refus':
      return { ...etat, lecture: 'repos', refus: action.message };
    case 'fichier_lu': {
      const fichier = decouper(action.nom, action.matrice, trouverEntete(action.matrice), action.reparees || 0);
      if (fichier.lignes.length > LIGNES_MAX) {
        return { ...etat, lecture: 'repos', refus: `Plus de ${LIMITES_TEXTE.lignes} : découpez le fichier.` };
      }
      if (fichier.lignes.length === 0) {
        return { ...etat, lecture: 'repos', refus: 'Ce fichier ne contient aucune ligne d\'article.' };
      }
      const correspondance = proposerCorrespondanceArticles(fichier.entetes);
      return {
        ...etat, ...remiseAZero, lecture: 'repos', refus: null, fichier, correspondance,
        etape: droitALApercu(correspondance) ? 'apercu' : 'colonnes',
      };
    }
    case 'entete': {
      if (!etat.fichier) return etat;
      const fichier = decouper(etat.fichier.nom, etat.fichier.matrice, action.index, etat.fichier.reparees);
      return { ...etat, ...remiseAZero, fichier, correspondance: proposerCorrespondanceArticles(fichier.entetes) };
    }
    case 'cible':
      return {
        ...etat,
        correspondance: etat.correspondance.map((c) => (c.index === action.index ? { ...c, cible: action.cible, origine: 'main' } : c)),
      };
    case 'vers_apercu':
      return { ...etat, etape: 'apercu' };
    case 'vers_colonnes':
      // Les valeurs interprétées et les fournisseurs décochés restent (tables par valeur brute du fichier).
      return { ...etat, etape: 'colonnes', choix: {}, avis: null };
    case 'vers_fichier':
      return { ...ETAT_INITIAL };
    case 'valeur':
      return {
        ...etat,
        valeursChoisies: { ...etat.valeursChoisies, [action.champ]: { ...etat.valeursChoisies[action.champ], [action.brute]: action.cible } },
      };
    case 'creer': {
      const decoches = new Set(etat.nonCrees);
      if (action.creer) decoches.delete(action.cle); else decoches.add(action.cle);
      return { ...etat, nonCrees: [...decoches] };
    }
    case 'choix':
      return { ...etat, choix: { ...etat.choix, [action.numero]: action.reprendre } };
    case 'tous_les_doublons':
      return { ...etat, choix: choixPourTousLesDoublons(action.classees, etat.choix, action.reprendre) };
    case 'envoi':
      return { ...etat, etape: 'envoi', envoi: { classees: action.classees, choix: etat.choix }, avis: null };
    case 'retour_apercu':
      return { ...etat, etape: 'apercu', envoi: null };
    // Import interrompu puis arrêté : retour à l'aperçu (les articles déjà créés y deviennent des doublons).
    case 'arret':
      return { ...etat, etape: 'apercu', envoi: null, choix: {}, avis: action.message };
    default:
      return etat;
  }
}

/** Nombre de lignes par clé de valeur corrigée, sur les lignes importées. */
function resumeCorrections(classees, choix) {
  const compte = new Map();
  for (const c of classees) {
    if (!aImporter(c, choix)) continue;
    for (const cle of c.corrections) compte.set(cle, (compte.get(cle) || 0) + 1);
  }
  return [...compte].map(([cle, nombre]) => ({ cle, nombre }));
}

/** Articles importés sans ligne fournisseur, par raison. */
function resumeSansLigne(classees, choix, lignes) {
  const avecLigne = new Set(lignes.filter((l) => l.fournisseur).map((l) => l.import_line));
  const r = { sans_prix: 0, sans_reference: 0, sans_fournisseur: 0, existante: 0, non_creee: 0 };
  for (const c of classees) {
    if (!aImporter(c, choix) || avecLigne.has(c.numero)) continue;
    if (c.ligneFournisseur === 'oui') r[c.ligneExistante ? 'existante' : 'non_creee'] += 1;
    else if (c.ligneFournisseur in r) r[c.ligneFournisseur] += 1;
  }
  return r;
}

/**
 * @param {string} orgId
 */
export function useParcoursImportArticles(orgId) {
  const [etat, dispatch] = useReducer(reducteur, ETAT_INITIAL);
  const { fichier, correspondance, choix, valeursChoisies, nonCrees } = etat;
  const surApercu = etat.etape === 'apercu';

  const validation = useMemo(() => validerCorrespondanceArticles(correspondance), [correspondance]);
  const { avecFournisseur } = validation;
  // Une partie seulement des champs de la ligne fournisseur est choisie : la ligne ne se créera pas (conseil, pas blocage).
  const fournisseurIncomplet = useMemo(
    () => !avecFournisseur && correspondance.some((c) => champArticle(c.cible)?.fournisseur && c.cible !== 'date_prix' && c.cible !== 'prix_public'),
    [avecFournisseur, correspondance],
  );

  // Lignes interprétées : à l'aperçu seulement (à l'étape Colonnes, chaque choix relancerait tout le fichier).
  const candidats = useMemo(
    () => (fichier && surApercu ? fichier.lignes.map((l) => appliquerCorrespondanceArticles(l, correspondance)) : null),
    [fichier, correspondance, surApercu],
  );

  // Valeurs du fichier à interpréter (nature, catégorie, unité) : proposition, puis choix de l'utilisateur.
  const valeurs = useMemo(() => {
    const champsChoisis = new Set(correspondance.map((c) => c.cible));
    const resultat = {};
    for (const champ of CHAMPS_A_INTERPRETER) {
      const distinctes = candidats && champsChoisis.has(champ) ? valeursDistinctes(candidats, champ) : [];
      const proposees = proposerValeurs(champ, distinctes, OPTIONS_VALEURS[champ]);
      const choisies = valeursChoisies[champ] || {};
      const table = {};
      for (const brute of distinctes) table[brute] = brute in choisies ? choisies[brute] : proposees[brute];
      resultat[champ] = { distinctes, table };
    }
    return resultat;
  }, [candidats, correspondance, valeursChoisies]);
  const valeursInterpretees = useMemo(
    () => ({ nature: valeurs.nature.table, categorie: valeurs.categorie.table, unite: valeurs.unite.table }),
    [valeurs],
  );

  // Fournisseurs nommés par les lignes qui auront une ligne fournisseur, rapprochés de ceux de l'entreprise.
  const fournisseursOrg = useCatalogImportSuppliers(orgId);
  const nomsFournisseurs = useMemo(() => {
    if (!candidats || !avecFournisseur) return [];
    const noms = [];
    for (const c of candidats) {
      const r = controlerArticle(c.valeurs, { valeursInterpretees: { nature: valeursInterpretees.nature }, avecFournisseur: true });
      if (r.ligneFournisseur === 'oui') noms.push(r.fiche.fournisseur.nom);
    }
    return noms;
  }, [candidats, avecFournisseur, valeursInterpretees.nature]);
  // undefined = inconnu (fournisseurs de l'entreprise en chargement ou en échec) : import fermé.
  const rapprochement = useMemo(() => {
    if (nomsFournisseurs.length === 0) return [];
    if (!fournisseursOrg.suppliers) return undefined;
    return rapprocherFournisseurs(nomsFournisseurs, fournisseursOrg.suppliers);
  }, [nomsFournisseurs, fournisseursOrg.suppliers]);

  const idsExistants = useMemo(
    () => (rapprochement || []).filter((r) => r.supplierId).map((r) => r.supplierId),
    [rapprochement],
  );
  const resolusExistants = useMemo(
    () => Object.fromEntries((rapprochement || []).filter((r) => r.supplierId).map((r) => [r.cle, r.supplierId])),
    [rapprochement],
  );

  // Articles et lignes fournisseur existants : demandés à l'aperçu seulement, une fois les fournisseurs connus.
  const existants = useExistantArticles(orgId, idsExistants, { enabled: !!candidats && rapprochement !== undefined });

  const classees = useMemo(() => {
    if (!candidats || rapprochement === undefined || !existants.existant) return null;
    return classerArticles(candidats, existants.existant, { valeursInterpretees, avecFournisseur, fournisseursResolus: resolusExistants });
  }, [candidats, rapprochement, existants.existant, valeursInterpretees, avecFournisseur, resolusExistants]);

  // Fournisseurs « à créer » cochés : un identifiant provisoire pour contrôler leurs lignes avant l'ouverture.
  const fournisseursAEnvoyer = useMemo(
    () => (rapprochement || []).filter((r) => !r.aCreer || !nonCrees.includes(r.cle)),
    [rapprochement, nonCrees],
  );
  const apercu = useMemo(() => {
    if (!classees) return null;
    const resolusPrevus = { ...resolusExistants };
    for (const r of fournisseursAEnvoyer) if (r.aCreer) resolusPrevus[r.cle] = FOURNISSEUR_PROVISOIRE;
    const { classeesFinales, lignes } = preparerEcriture(classees, choix, resolusPrevus);
    // Lignes fournisseur comptées sur ce qui partira vraiment (un fournisseur décoché envoie ses lignes sans lui).
    const avecLigne = lignes.filter((l) => l.fournisseur);
    return {
      classees: classeesFinales,
      lignes,
      bilan: { ...bilanArticles(classeesFinales, choix), lignesFournisseur: avecLigne.length },
      corrections: resumeCorrections(classeesFinales, choix),
      sansDate: avecLigne.filter((l) => !l.fournisseur.purchase_price_at).length,
      sansLigne: resumeSansLigne(classeesFinales, choix, lignes),
    };
  }, [classees, choix, resolusExistants, fournisseursAEnvoyer]);

  const nomParId = useMemo(
    () => new Map((fournisseursOrg.suppliers || []).map((s) => [s.id, s.name])),
    [fournisseursOrg.suppliers],
  );
  const fournisseurs = useMemo(() => (rapprochement === undefined ? undefined : rapprochement.map((r) => ({
    ...r, nomExistant: r.supplierId ? nomParId.get(r.supplierId) || r.nom : null, creer: r.aCreer && !nonCrees.includes(r.cle),
  }))), [rapprochement, nomParId, nonCrees]);

  // Ce que la page passe à l'exécution : null tant que l'import est fermé.
  const envoiPrevu = useMemo(() => {
    if (!apercu || !fichier || validation.erreurs.length > 0 || apercu.bilan.importees === 0) return null;
    const b = apercu.bilan;
    const prevues = apercu.lignes;
    const aEnvoyer = fournisseursAEnvoyer;
    return {
      classees: apercu.classees,
      ouverture: {
        fileName: fichier.nom,
        mapping: { colonnes: correspondance, valeurs: valeursInterpretees },
        counts: { lues: b.lues, importees: b.importees, doublons: b.doublons, ecartees: b.ecartees, lignes_fournisseur: b.lignesFournisseur },
        fournisseurs: aEnvoyer.map((r) => ({ nom: r.nom, supplier_id: r.supplierId })),
      },
      lignes: prevues,
      // Après l'ouverture : vrais identifiants des fournisseurs, puis mêmes lignes qu'à l'aperçu, sinon rien ne part.
      preparer: (rendus) => {
        if (!Array.isArray(rendus) || rendus.length !== aEnvoyer.length || rendus.some((f) => typeof f?.supplier_id !== 'string')) {
          throw new Error("La base n'a pas rendu tous les fournisseurs : aucun article n'a été envoyé. Revenez à l'aperçu.");
        }
        const resolus = { ...resolusExistants };
        aEnvoyer.forEach((r, i) => { resolus[r.cle] = rendus[i].supplier_id; });
        const { lignes } = preparerEcriture(classees, choix, resolus);
        const avec = (liste) => liste.filter((l) => l.fournisseur).length;
        if (lignes.length !== prevues.length || avec(lignes) !== avec(prevues)) {
          throw new Error("Les lignes ont changé à l'ouverture de l'import : aucun article n'a été envoyé. Revenez à l'aperçu.");
        }
        return lignes;
      },
    };
  }, [apercu, fichier, validation.erreurs.length, fournisseursAEnvoyer, correspondance, valeursInterpretees, resolusExistants, classees, choix]);

  const actions = useMemo(() => ({
    debutLecture: () => dispatch({ type: 'lecture' }),
    refuser: (message) => dispatch({ type: 'refus', message }),
    fichierLu: (nom, matrice, reparees) => dispatch({ type: 'fichier_lu', nom, matrice, reparees }),
    changerEntete: (index) => dispatch({ type: 'entete', index }),
    changerCible: (index, cible) => dispatch({ type: 'cible', index, cible }),
    versApercu: () => dispatch({ type: 'vers_apercu' }),
    versColonnes: () => dispatch({ type: 'vers_colonnes' }),
    versFichier: () => dispatch({ type: 'vers_fichier' }),
    changerValeur: (champ, brute, cible) => dispatch({ type: 'valeur', champ, brute, cible }),
    changerCreation: (cle, creer) => dispatch({ type: 'creer', cle, creer }),
    basculerDoublon: (classee, choixCourants) => dispatch({ type: 'choix', numero: classee.numero, reprendre: !aImporter(classee, choixCourants) }),
    tousLesDoublons: (lignesClassees, reprendre) => dispatch({ type: 'tous_les_doublons', classees: lignesClassees, reprendre }),
    envoyer: (lignesClassees) => dispatch({ type: 'envoi', classees: lignesClassees }),
    retourApercu: () => dispatch({ type: 'retour_apercu' }),
    arreter: (message) => dispatch({ type: 'arret', message }),
  }), []);

  return {
    etat, actions, validation, fournisseurIncomplet, valeurs, fournisseurs, fournisseursOrg, existants, apercu, envoiPrevu,
  };
}
