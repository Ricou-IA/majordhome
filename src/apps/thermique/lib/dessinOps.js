// Opérations d'édition du dessin — module PUR. Import autorisé : ./geometryEngine.js UNIQUEMENT.
// Réducteurs `(dessin, params) → { dessin, erreurs }` consommés par le canevas/wizard (UI-facing,
// testables sans React) : chaque op re-valide localement et ne laisse JAMAIS le dessin dans un
// état corrompu — op refusée = MÊME référence `dessin` renvoyée + `erreurs` non vide ; op
// appliquée = NOUVEL objet (jamais de mutation de l'entrée, à AUCUNE profondeur).
// `valideDessin(dessin)` est la validation globale (pré-vol) appelée par le wizard avant le calcul.
//
// Convention 'thermique:' vs refus : la quasi-totalité de ce module s'adresse à l'UI (mode refus +
// erreurs FR, jamais de throw) — c'est la nature même des réducteurs, qui doivent pouvoir répondre
// à une saisie utilisateur invalide sans crasher l'application. Les throws 'thermique:' restent
// réservés aux entrées PROGRAMMATIQUEMENT malformées (ex. `dessin` qui n'est pas un objet, `piece`
// sans champ `id`) — jamais à un refus « normal » d'opération métier.

import { GRILLE_CM, validePolygone, segmentsDe, normalisePolygone, deduireParois, surfaceCm2 } from './geometryEngine.js';

const THETA_MIN = 5;
const THETA_MAX = 30;
const HAUTEUR_NIVEAU_MIN = 180;
const HAUTEUR_NIVEAU_MAX = 500;

/** Résultat de refus : MÊME référence `dessin` + erreurs non vide. */
function refuse(dessin, ...erreurs) {
  return { dessin, erreurs };
}

/** Résultat de succès : nouvel objet `dessin` + erreurs vide. */
function accepte(dessin) {
  return { dessin, erreurs: [] };
}

function estDessin(dessin) {
  return !!dessin && typeof dessin === 'object'
    && Array.isArray(dessin.niveaux) && Array.isArray(dessin.pieces) && Array.isArray(dessin.ouvertures);
}

function exigeDessin(dessin, nomFn) {
  if (!estDessin(dessin)) {
    throw new Error(`thermique: ${nomFn} : dessin { niveaux[], pieces[], ouvertures[] } requis`);
  }
}

function exigeId(valeur, nomFn, nomChamp) {
  if (valeur === null || valeur === undefined || valeur === '') {
    throw new Error(`thermique: ${nomFn} : ${nomChamp} requis`);
  }
}

/**
 * Ajoute une pièce au dessin. Refus : id déjà pris (globalement, quel que soit le niveau),
 * niveauId inexistant, ou polygone invalide (validePolygone non vide).
 * @param {object} dessin dessin courant (jamais muté)
 * @param {object} piece pièce complète à ajouter (id, niveauId, nom, typePiece, chauffee,
 *   thetaInt, polygone) — copiée telle quelle si acceptée
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function ajoutePiece(dessin, piece) {
  exigeDessin(dessin, 'ajoutePiece');
  if (!piece || typeof piece !== 'object') throw new Error('thermique: ajoutePiece : piece requise');
  exigeId(piece.id, 'ajoutePiece', 'piece.id');

  const erreurs = [];
  if (dessin.pieces.some((p) => p.id === piece.id)) {
    erreurs.push(`pièce « ${piece.id} » : id déjà utilisé`);
  }
  if (!dessin.niveaux.some((n) => n.id === piece.niveauId)) {
    erreurs.push(`pièce « ${piece.id} » : niveau « ${piece.niveauId} » inexistant`);
  }
  const problemesPolygone = validePolygone(piece.polygone);
  if (problemesPolygone.length > 0) {
    erreurs.push(`pièce « ${piece.id} » : polygone invalide (${problemesPolygone.join(' ; ')})`);
  }
  if (erreurs.length > 0) return refuse(dessin, ...erreurs);

  return accepte({ ...dessin, pieces: [...dessin.pieces, { ...piece }] });
}

/**
 * Supprime une pièce et TOUTES ses ouvertures. Refus : pieceId inconnu.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} pieceId id de la pièce à retirer
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function supprimePiece(dessin, pieceId) {
  exigeDessin(dessin, 'supprimePiece');
  if (!dessin.pieces.some((p) => p.id === pieceId)) {
    return refuse(dessin, `pièce « ${pieceId} » : introuvable`);
  }
  return accepte({
    ...dessin,
    pieces: dessin.pieces.filter((p) => p.id !== pieceId),
    ouvertures: dessin.ouvertures.filter((o) => o.pieceId !== pieceId),
  });
}

/**
 * Translate une pièce de `{dx, dy}` cm, accroché à la grille — pas de rotation en v1. Les
 * ouvertures suivent AUTOMATIQUEMENT car elles sont exprimées en coordonnées relatives au segment
 * (segmentIndex + position) : translater le polygone ne change ni l'un ni l'autre, aucune donnée
 * d'ouverture n'est donc réécrite ici. Refus : pieceId inconnu, ou dx/dy non multiples de
 * GRILLE_CM (translation qui sortirait le polygone de la grille 10 cm).
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} pieceId id de la pièce à déplacer
 * @param {{dx: number, dy: number}} deplacement décalage entier (cm), multiple de GRILLE_CM
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function deplacePiece(dessin, pieceId, { dx, dy } = {}) {
  exigeDessin(dessin, 'deplacePiece');
  const piece = dessin.pieces.find((p) => p.id === pieceId);
  if (!piece) return refuse(dessin, `pièce « ${pieceId} » : introuvable`);
  if (!Number.isInteger(dx) || !Number.isInteger(dy) || dx % GRILLE_CM !== 0 || dy % GRILLE_CM !== 0) {
    return refuse(dessin, `déplacement de « ${pieceId} » : dx/dy doivent être des multiples entiers de la grille ${GRILLE_CM} cm`);
  }
  const polygoneDeplace = piece.polygone.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
  return accepte({
    ...dessin,
    pieces: dessin.pieces.map((p) => (p.id === pieceId ? { ...p, polygone: polygoneDeplace } : p)),
  });
}

/**
 * Redimensionne une pièce RECTANGULAIRE à `largeur` × `hauteur` (cm), ancrée à son coin haut-gauche
 * (xMin, yMin inchangés). En v1 chaque pièce est un rectangle ; une pièce non rectangulaire (forme
 * en L, etc.) est refusée plutôt que déformée à l'aveugle. Les ouvertures conservent leur
 * segmentIndex/position — une ouverture qui déborderait du mur raccourci est signalée en aval par
 * valideDessin (comportement assumé, pas de réécriture d'ouverture ici). Refus : pieceId inconnu,
 * pièce non rectangulaire, largeur/hauteur non multiples entiers de GRILLE_CM ou ≤ 0.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} pieceId id de la pièce à redimensionner
 * @param {{largeur: number, hauteur: number}} dims dimensions cibles (cm)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function redimensionnePiece(dessin, pieceId, { largeur, hauteur } = {}) {
  exigeDessin(dessin, 'redimensionnePiece');
  const piece = dessin.pieces.find((p) => p.id === pieceId);
  if (!piece) return refuse(dessin, `pièce « ${pieceId} » : introuvable`);
  if (!Number.isInteger(largeur) || !Number.isInteger(hauteur)
    || largeur <= 0 || hauteur <= 0 || largeur % GRILLE_CM !== 0 || hauteur % GRILLE_CM !== 0) {
    return refuse(dessin, `dimensions de « ${pieceId} » : largeur et hauteur doivent être des multiples entiers > 0 de ${GRILLE_CM} cm`);
  }
  const xs = piece.polygone.map((p) => p.x);
  const ys = piece.polygone.map((p) => p.y);
  const xMin = Math.min(...xs);
  const yMin = Math.min(...ys);
  const estRectangle = piece.polygone.length === 4
    && surfaceCm2(piece.polygone) === (Math.max(...xs) - xMin) * (Math.max(...ys) - yMin);
  if (!estRectangle) {
    return refuse(dessin, `pièce « ${pieceId} » : redimensionnement disponible uniquement sur une pièce rectangulaire`);
  }
  const nouveau = [
    { x: xMin, y: yMin },
    { x: xMin, y: yMin + hauteur },
    { x: xMin + largeur, y: yMin + hauteur },
    { x: xMin + largeur, y: yMin },
  ];
  return accepte({
    ...dessin,
    pieces: dessin.pieces.map((p) => (p.id === pieceId ? { ...p, polygone: nouveau } : p)),
  });
}

/**
 * Renomme une pièce (nom trimé, non vide). Refus : pieceId inconnu, ou nom vide après trim.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} pieceId id de la pièce à renommer
 * @param {string} nom nouveau nom (trimé avant application)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function renommePiece(dessin, pieceId, nom) {
  exigeDessin(dessin, 'renommePiece');
  const piece = dessin.pieces.find((p) => p.id === pieceId);
  if (!piece) return refuse(dessin, `pièce « ${pieceId} » : introuvable`);
  const nomTrime = typeof nom === 'string' ? nom.trim() : '';
  if (nomTrime === '') return refuse(dessin, `pièce « ${pieceId} » : nom vide refusé`);
  return accepte({ ...dessin, pieces: dessin.pieces.map((p) => (p.id === pieceId ? { ...p, nom: nomTrime } : p)) });
}

/**
 * Bascule le statut chauffée/non chauffée d'une pièce. Refus : pieceId inconnu.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} pieceId id de la pièce
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function basculeChauffee(dessin, pieceId) {
  exigeDessin(dessin, 'basculeChauffee');
  const piece = dessin.pieces.find((p) => p.id === pieceId);
  if (!piece) return refuse(dessin, `pièce « ${pieceId} » : introuvable`);
  return accepte({ ...dessin, pieces: dessin.pieces.map((p) => (p.id === pieceId ? { ...p, chauffee: !p.chauffee } : p)) });
}

/**
 * Règle la température intérieure de consigne d'une pièce. Refus : pieceId inconnu, ou valeur
 * autre que `null` et hors [5, 30] °C (ou non finie).
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} pieceId id de la pièce
 * @param {number|null} thetaInt température de consigne (°C) ou `null` (pièce non chauffée)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function regleThetaInt(dessin, pieceId, thetaInt) {
  exigeDessin(dessin, 'regleThetaInt');
  const piece = dessin.pieces.find((p) => p.id === pieceId);
  if (!piece) return refuse(dessin, `pièce « ${pieceId} » : introuvable`);
  if (thetaInt !== null) {
    if (typeof thetaInt !== 'number' || !Number.isFinite(thetaInt) || thetaInt < THETA_MIN || thetaInt > THETA_MAX) {
      return refuse(dessin, `pièce « ${pieceId} » : thetaInt doit être null ou un nombre fini dans [${THETA_MIN}, ${THETA_MAX}] °C`);
    }
  }
  return accepte({ ...dessin, pieces: dessin.pieces.map((p) => (p.id === pieceId ? { ...p, thetaInt } : p)) });
}

/**
 * Ajoute une ouverture. Validation STRUCTURELLE uniquement (id unique, pieceId existant,
 * segmentIndex dans les bornes du polygone de la pièce, largeur/hauteur/position numériques
 * valides) — la validation géométrique complète (chevauchement entre ouvertures, dépassement du
 * mur porteur, cohérence avec l'adjacence) reste dans `valideOuvertures`/`deduireParois`
 * (geometryEngine.js), appelée en aval par `valideDessin`.
 * Refus : id déjà pris, pieceId inexistant, segmentIndex hors bornes, largeur/hauteur ≤ 0,
 * position < 0.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {object} ouverture ouverture complète (id, pieceId, segmentIndex, type, largeur, hauteur,
 *   position) — copiée telle quelle si acceptée
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function ajouteOuverture(dessin, ouverture) {
  exigeDessin(dessin, 'ajouteOuverture');
  if (!ouverture || typeof ouverture !== 'object') throw new Error('thermique: ajouteOuverture : ouverture requise');
  exigeId(ouverture.id, 'ajouteOuverture', 'ouverture.id');

  const erreurs = [];
  if (dessin.ouvertures.some((o) => o.id === ouverture.id)) {
    erreurs.push(`ouverture « ${ouverture.id} » : id déjà utilisé`);
  }
  const piece = dessin.pieces.find((p) => p.id === ouverture.pieceId);
  if (!piece) {
    erreurs.push(`ouverture « ${ouverture.id} » : pièce « ${ouverture.pieceId} » inexistante`);
  } else {
    const problemesPolygone = validePolygone(piece.polygone);
    if (problemesPolygone.length === 0) {
      const nbSegments = segmentsDe(normalisePolygone(piece.polygone)).length;
      if (!Number.isInteger(ouverture.segmentIndex) || ouverture.segmentIndex < 0 || ouverture.segmentIndex >= nbSegments) {
        erreurs.push(`ouverture « ${ouverture.id} » : segmentIndex hors bornes (${ouverture.segmentIndex}) pour la pièce « ${piece.id} »`);
      }
    }
    // Polygone de la pièce invalide : la validation du segmentIndex est reportée à valideDessin
    // (via deduireParois) — cette op ne bloque pas la pose d'ouverture sur une pièce déjà en
    // erreur ailleurs, tant que segmentIndex est structurellement plausible (nombre entier ≥ 0).
  }
  if (!Number.isInteger(ouverture.largeur) || ouverture.largeur <= 0) {
    erreurs.push(`ouverture « ${ouverture.id} » : largeur doit être un entier > 0`);
  }
  if (!Number.isInteger(ouverture.hauteur) || ouverture.hauteur <= 0) {
    erreurs.push(`ouverture « ${ouverture.id} » : hauteur doit être un entier > 0`);
  }
  if (!Number.isInteger(ouverture.position) || ouverture.position < 0) {
    erreurs.push(`ouverture « ${ouverture.id} » : position doit être un entier ≥ 0`);
  }
  if (erreurs.length > 0) return refuse(dessin, ...erreurs);

  return accepte({ ...dessin, ouvertures: [...dessin.ouvertures, { ...ouverture }] });
}

/**
 * Supprime une ouverture. Refus : ouvertureId inconnu.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} ouvertureId id de l'ouverture à retirer
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function supprimeOuverture(dessin, ouvertureId) {
  exigeDessin(dessin, 'supprimeOuverture');
  if (!dessin.ouvertures.some((o) => o.id === ouvertureId)) {
    return refuse(dessin, `ouverture « ${ouvertureId} » : introuvable`);
  }
  return accepte({ ...dessin, ouvertures: dessin.ouvertures.filter((o) => o.id !== ouvertureId) });
}

/**
 * Ajoute un niveau, empilé au SOMMET (fin du tableau `niveaux` = le plus haut, cf. modèle de
 * données du plan 3). Refus : id déjà pris, hauteur hors [180, 500] cm.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {{id: *, nom: string, hauteur: number}} niveau nouveau niveau (sans pièces)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function ajouteNiveau(dessin, niveau) {
  exigeDessin(dessin, 'ajouteNiveau');
  if (!niveau || typeof niveau !== 'object') throw new Error('thermique: ajouteNiveau : niveau requis');
  exigeId(niveau.id, 'ajouteNiveau', 'niveau.id');

  const erreurs = [];
  if (dessin.niveaux.some((n) => n.id === niveau.id)) {
    erreurs.push(`niveau « ${niveau.id} » : id déjà utilisé`);
  }
  if (!Number.isInteger(niveau.hauteur) || niveau.hauteur < HAUTEUR_NIVEAU_MIN || niveau.hauteur > HAUTEUR_NIVEAU_MAX) {
    erreurs.push(`niveau « ${niveau.id} » : hauteur doit être un entier dans [${HAUTEUR_NIVEAU_MIN}, ${HAUTEUR_NIVEAU_MAX}] cm`);
  }
  if (erreurs.length > 0) return refuse(dessin, ...erreurs);

  return accepte({ ...dessin, niveaux: [...dessin.niveaux, { id: niveau.id, nom: niveau.nom, hauteur: niveau.hauteur }] });
}

/**
 * Duplique un niveau existant : nouveau niveau ajouté au SOMMET du dessin, avec des copies des
 * pièces et ouvertures du niveau source sous des ids FRAIS. Schéma d'id déterministe
 * `${ancienId}-copie-${n}` (n = compteur de collision, cf. ci-dessous) — PAS `crypto.randomUUID`
 * (module pur, sans effet de bord : aucun import DOM/Node, résultat reproductible pour les tests).
 * Le compteur `n` part de 1 et s'incrémente jusqu'à trouver un id absent du dessin COURANT
 * (pièces ET ouvertures confondues, tous niveaux) — permet des duplications successives du même
 * niveau source sans collision (cf. test « déterminisme »). Noms des pièces copiées suffixés de
 * `suffixe` (` (étage)` par défaut) ; nom du niveau copié également suffixé.
 * Refus : niveauId source inconnu, nouvelId déjà pris.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} niveauId id du niveau à dupliquer (source — jamais modifié)
 * @param {{nouvelId: *, suffixe?: string}} options nouvelId du niveau dupliqué ; suffixe ajouté
 *   aux noms (niveau et pièces copiées)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function dupliqueNiveau(dessin, niveauId, { nouvelId, suffixe = ' (étage)' } = {}) {
  exigeDessin(dessin, 'dupliqueNiveau');
  const niveauSource = dessin.niveaux.find((n) => n.id === niveauId);
  const erreurs = [];
  if (!niveauSource) erreurs.push(`niveau « ${niveauId} » : introuvable`);
  if (nouvelId === null || nouvelId === undefined || nouvelId === '') erreurs.push('dupliqueNiveau : nouvelId requis');
  else if (dessin.niveaux.some((n) => n.id === nouvelId)) erreurs.push(`niveau « ${nouvelId} » : id déjà utilisé`);
  if (erreurs.length > 0) return refuse(dessin, ...erreurs);

  const idsExistants = new Set([
    ...dessin.pieces.map((p) => p.id),
    ...dessin.ouvertures.map((o) => o.id),
  ]);
  function idFrais(ancienId) {
    let n = 1;
    let candidat = `${ancienId}-copie-${n}`;
    while (idsExistants.has(candidat)) {
      n += 1;
      candidat = `${ancienId}-copie-${n}`;
    }
    idsExistants.add(candidat);
    return candidat;
  }

  const piecesSource = dessin.pieces.filter((p) => p.niveauId === niveauId);
  const correspondance = new Map(); // ancien pieceId → nouveau pieceId
  const piecesCopiees = piecesSource.map((p) => {
    const nouvelIdPiece = idFrais(p.id);
    correspondance.set(p.id, nouvelIdPiece);
    return { ...p, id: nouvelIdPiece, niveauId: nouvelId, nom: `${p.nom}${suffixe}`, polygone: p.polygone.map((pt) => ({ ...pt })) };
  });
  const ouverturesCopiees = dessin.ouvertures
    .filter((o) => correspondance.has(o.pieceId))
    .map((o) => ({ ...o, id: idFrais(o.id), pieceId: correspondance.get(o.pieceId) }));

  const nouveauNiveau = { id: nouvelId, nom: `${niveauSource.nom}${suffixe}`, hauteur: niveauSource.hauteur };

  return accepte({
    ...dessin,
    niveaux: [...dessin.niveaux, nouveauNiveau],
    pieces: [...dessin.pieces, ...piecesCopiees],
    ouvertures: [...dessin.ouvertures, ...ouverturesCopiees],
  });
}

/**
 * Supprime un niveau et TOUTES ses pièces/ouvertures. Refus : niveauId inconnu, ou c'est le
 * DERNIER niveau du dessin (un dessin sans aucun niveau n'a pas de sens — le wizard doit toujours
 * avoir au moins un niveau actif).
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} niveauId id du niveau à retirer
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function supprimeNiveau(dessin, niveauId) {
  exigeDessin(dessin, 'supprimeNiveau');
  if (!dessin.niveaux.some((n) => n.id === niveauId)) {
    return refuse(dessin, `niveau « ${niveauId} » : introuvable`);
  }
  if (dessin.niveaux.length <= 1) {
    return refuse(dessin, 'impossible de supprimer le dernier niveau restant');
  }
  const piecesRetirees = new Set(dessin.pieces.filter((p) => p.niveauId === niveauId).map((p) => p.id));
  return accepte({
    ...dessin,
    niveaux: dessin.niveaux.filter((n) => n.id !== niveauId),
    pieces: dessin.pieces.filter((p) => p.niveauId !== niveauId),
    ouvertures: dessin.ouvertures.filter((o) => !piecesRetirees.has(o.pieceId)),
  });
}

/**
 * Règle l'orientation nord du dessin, normalisée dans [0, 360[ par double-modulo (gère les
 * valeurs négatives : `((n % 360) + 360) % 360`). Refus : valeur non numérique/non finie.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {number} nord angle en degrés, fini (peut être négatif ou ≥ 360 — normalisé)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function regleNord(dessin, nord) {
  exigeDessin(dessin, 'regleNord');
  if (typeof nord !== 'number' || !Number.isFinite(nord)) {
    return refuse(dessin, 'nord doit être un nombre fini (degrés)');
  }
  const normalise = ((nord % 360) + 360) % 360;
  return accepte({ ...dessin, nord: normalise });
}

/**
 * Règle la hauteur sous plafond d'un niveau. Refus : niveauId inconnu, hauteur hors [180, 500] cm.
 * @param {object} dessin dessin courant (jamais muté)
 * @param {*} niveauId id du niveau
 * @param {number} hauteur nouvelle hauteur entière (cm)
 * @returns {{dessin: object, erreurs: string[]}}
 */
export function regleHauteurNiveau(dessin, niveauId, hauteur) {
  exigeDessin(dessin, 'regleHauteurNiveau');
  if (!dessin.niveaux.some((n) => n.id === niveauId)) {
    return refuse(dessin, `niveau « ${niveauId} » : introuvable`);
  }
  if (!Number.isInteger(hauteur) || hauteur < HAUTEUR_NIVEAU_MIN || hauteur > HAUTEUR_NIVEAU_MAX) {
    return refuse(dessin, `niveau « ${niveauId} » : hauteur doit être un entier dans [${HAUTEUR_NIVEAU_MIN}, ${HAUTEUR_NIVEAU_MAX}] cm`);
  }
  return accepte({ ...dessin, niveaux: dessin.niveaux.map((n) => (n.id === niveauId ? { ...n, hauteur } : n)) });
}

/**
 * Validation globale du dessin — LA fonction que le wizard appelle avant d'autoriser le passage à
 * l'étape de calcul. Deux familles de contrôles :
 *  1. Structurels (propres à ce module) : unicité globale des ids (pièces, ouvertures, niveaux —
 *     trois espaces de noms séparés, cf. note ci-dessous), chaque pièce référence un niveau
 *     existant, hauteurs de niveau ∈ [180, 500] cm, `nord` fini.
 *  2. Délégués à `deduireParois` (geometryEngine.js) : erreurs et avertissements géométriques
 *     (polygones invalides, chevauchements, ouvertures mal posées, etc.) — fusionnés tels quels.
 * Si `deduireParois` THROW `'thermique:'` (dessin trop malformé pour même être indexé — ex. pièce
 * référençant un niveau inconnu, cas déjà couvert ci-dessus mais peut aussi provenir d'une entrée
 * non couverte par les contrôles structurels), le throw est RATTRAPÉ et converti en une erreur
 * structurelle supplémentaire : cette fonction est LE pré-vol, elle ne doit JAMAIS lever — un
 * dessin en cours d'édition doit toujours pouvoir être affiché/diagnostiqué par l'UI.
 * Note sur les espaces de noms d'id : pièces, ouvertures et niveaux sont trois collections
 * distinctes dans le modèle de données (§ décision structurante 6) — une collision ENTRE
 * collections (ex. une pièce et un niveau qui partageraient le même id) n'est pas un problème en
 * soi (rien ne les compare jamais l'un à l'autre) ; seule l'unicité INTRA-collection est vérifiée.
 * @param {object} dessin dessin à valider (jamais muté)
 * @returns {{erreurs: string[], avertissements: string[]}}
 */
export function valideDessin(dessin) {
  exigeDessin(dessin, 'valideDessin');
  const erreurs = [];
  const avertissements = [];

  const idsNiveaux = new Set();
  for (const n of dessin.niveaux) {
    if (idsNiveaux.has(n.id)) erreurs.push(`niveau « ${n.id} » : id dupliqué`);
    idsNiveaux.add(n.id);
    if (!Number.isInteger(n.hauteur) || n.hauteur < HAUTEUR_NIVEAU_MIN || n.hauteur > HAUTEUR_NIVEAU_MAX) {
      erreurs.push(`niveau « ${n.id} » : hauteur hors [${HAUTEUR_NIVEAU_MIN}, ${HAUTEUR_NIVEAU_MAX}] cm`);
    }
  }

  const idsPieces = new Set();
  for (const p of dessin.pieces) {
    if (idsPieces.has(p.id)) erreurs.push(`pièce « ${p.id} » : id dupliqué`);
    idsPieces.add(p.id);
    if (!idsNiveaux.has(p.niveauId)) erreurs.push(`pièce « ${p.id} » : référence un niveau inconnu (${p.niveauId})`);
  }

  const idsOuvertures = new Set();
  for (const o of dessin.ouvertures) {
    if (idsOuvertures.has(o.id)) erreurs.push(`ouverture « ${o.id} » : id dupliqué`);
    idsOuvertures.add(o.id);
  }

  if (typeof dessin.nord !== 'number' || !Number.isFinite(dessin.nord)) {
    erreurs.push('dessin : nord doit être un nombre fini (degrés)');
  }

  try {
    const resultat = deduireParois(dessin);
    erreurs.push(...resultat.erreurs);
    avertissements.push(...resultat.avertissements);
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('thermique:')) throw e;
    erreurs.push(`dessin invalide : ${e.message}`);
  }

  return { erreurs, avertissements };
}
