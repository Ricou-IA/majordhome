// src/apps/thermique/lib/assembleBatimentParametrique.js
// Assembleur PARAMÉTRIQUE (2026-07-09) : saisie (emprise + pièces paramétriques) → batiment résolu
// pour calculeBatiment. Module PUR. Remplace la chaîne géométrique deduireParois/assembleBatiment
// pour le mode 'parametrique' — le moteur physique (thermalEngine) reste inchangé.
import { surfaceCm2, perimetreCm } from './geometryEngine.js';
import { uDefautPour, thetaBasePour, resolvePeriode, debitVentilationPour, coefficientBPour } from './refDataResolvers.js';
import { typePieceInfo, PLAGES_VRAISEMBLANCE, normaliseOuvertures } from './thermiqueConfig.js';
import { bPlancherBasPour } from './assembleBatiment.js';

/** Dérivés d'une emprise dessinée : surface au sol (m²) et périmètre extérieur (m). */
export function empriseDerives(emprise) {
  const poly = emprise?.polygone;
  if (!Array.isArray(poly) || poly.length < 3) return { surfaceSol: 0, perimetre: 0 };
  return { surfaceSol: surfaceCm2(poly) / 10000, perimetre: perimetreCm(poly) / 100 };
}

const TYPE_U_DEFAUT = { murs: 'mur', plancherBas: 'plancherBas', plafondToiture: 'plafond' };

/** U résolu pour une famille sur une pièce : exception (pièce×famille) > famille (défaut année | valeur). */
export function resoudUFamille(compositions, famille, pieceId, { uDefauts, annee }) {
  const excP = compositions?.exceptions?.parois?.[`${pieceId}:${famille}`];
  if (excP && Number.isFinite(excP.u)) return excP.u;
  const fam = compositions?.familles?.[famille] ?? {};
  if (fam.mode === 'defaut' && TYPE_U_DEFAUT[famille]) {
    return uDefautPour(uDefauts, TYPE_U_DEFAUT[famille], annee);
  }
  return Number.isFinite(fam.u) ? fam.u : null;
}

const MENU_FAMILLE = { fenetre: 'fenetre', porteFenetre: 'porteFenetre', porte: 'porte' };

/** Parois moteur d'une pièce paramétrique. ctx : voir JSDoc de assembleBatimentParametrique.
 * @returns {{ parois: object[], erreurs: string[] }} */
export function paroisPieceParametrique(piece, ctx) {
  const erreurs = [];
  const parois = [];
  const H = (piece.hauteur ?? 0) / 100;          // cm → m
  const L = (piece.longueur ?? 0) / 100;
  const l = (piece.largeur ?? 0) / 100;
  const surfaceSol = L * l;
  const nom = piece.nom ?? piece.id;

  // Ouvertures multiples (2026-07-15) : une pièce peut porter plusieurs menuiseries de U distincts.
  // `u` d'une ouverture prime ; sinon défaut de la famille du type. Rétro-compat via normaliseOuvertures.
  const ouvertures = normaliseOuvertures(piece);
  const surfOuvTotale = ouvertures.reduce((s, o) => s + (Number.isFinite(o.surface) ? o.surface : 0), 0);

  const surfMurExt = (piece.mlMurExterieur ?? 0) / 100 * H - surfOuvTotale;
  if (surfMurExt < 0) {
    const surfArrondie = Math.round(surfOuvTotale * 100) / 100;
    erreurs.push(`« ${nom} » : surface d'ouverture (${surfArrondie} m²) supérieure au mur extérieur déclaré`);
    return { parois, erreurs };
  }

  const pousse = (famille, type, surface, refTemp, uForce) => {
    if (surface <= 0) return;
    const u = Number.isFinite(uForce)
      ? uForce
      : resoudUFamille(ctx.compositions, famille, piece.id, { uDefauts: ctx.uDefauts, annee: ctx.annee });
    if (!Number.isFinite(u) || u <= 0) { erreurs.push(`« ${nom} » : U manquant pour « ${famille} »`); return; }
    const poste = famille === 'murs' ? 'murs'
      : famille === 'plancherBas' ? 'plancherBas'
      : famille === 'plafondToiture' ? 'plafondToiture' : 'menuiseries';
    parois.push({ surface, u, deltaUtb: ctx.deltaUtb, poste, type, pieceId: piece.id, ...refTemp });
  };

  // Mur extérieur (b=1)
  pousse('murs', 'mur-exterieur', surfMurExt, { b: 1 });
  // Menuiseries : une paroi par ouverture (b=1), U = override d'ouverture ou défaut famille du type
  for (const o of ouvertures) {
    const famMenu = MENU_FAMILLE[o.type] ?? 'fenetre';
    pousse(famMenu, 'menuiserie', Number.isFinite(o.surface) ? o.surface : 0, { b: 1 }, o.u);
  }
  // Mur sur local non chauffé (b = bLocalNonChauffe)
  const surfLnc = (piece.mlMurLocalNonChauffe ?? 0) / 100 * H;
  pousse('murs', 'mur-lnc', surfLnc, { b: Number.isFinite(piece.bLocalNonChauffe) ? piece.bLocalNonChauffe : 1 });
  // Plancher bas (si rez) / plafond (si dernier niveau). Toiture : comble → b comble ;
  // rampant → b=1 (pas d'espace tampon), même mapping que l'assembleur géométrique legacy.
  if (ctx.estRez) pousse('plancherBas', 'plancher-bas', surfaceSol, { b: ctx.bPlancherBas });
  if (ctx.estDernier) {
    if (ctx.toitureRampant) pousse('plafondToiture', 'toiture-rampant', surfaceSol, { b: 1 });
    else pousse('plafondToiture', 'plafond-comble', surfaceSol, { b: ctx.bComble });
  }

  return { parois, erreurs };
}

const B_COMBLE = {
  isole: 'Toiture isolée',
  'non-isole': 'Autres toitures non isolée',
  'fortement-ventile': 'Espace sous toiture fortement ventilé sans feutre ni panneau en sous face',
};

/**
 * Assembleur paramétrique : saisie + données + choix → entrée de calculeBatiment.
 * Même shape de sortie qu'assembleBatiment. batiment null si erreurs bloquantes (l'UI liste, jamais throw).
 */
export function assembleBatimentParametrique(saisie, options) {
  const { data, contexte, compositions, reglages } = options;
  const erreurs = [];
  const avertissements = [];

  // θe : forçage manuel opérateur prioritaire (contexte.thetaEForce) — bypass thetaBasePour, donc
  // fonctionne même si la table climat manque pour le département. Sinon θe départementale brute
  // (correction d'altitude non calibrée, cf. docs/thermique-calibration-altitude.md).
  let thetaE = null;
  if (Number.isFinite(contexte.thetaEForce)) {
    thetaE = contexte.thetaEForce;
  } else {
    try { thetaE = thetaBasePour(data.climat, contexte.dept, contexte.altitude).thetaE; }
    catch (e) { erreurs.push(e.message); }
  }

  const deltaUtb = reglages.deltaUtb[contexte.isolation];
  if (!Number.isFinite(deltaUtb)) erreurs.push(`type d'isolation inconnu « ${contexte.isolation} »`);
  const bComble = coefficientBPour(data.coefficientsB, 'Espace sous toiture', B_COMBLE[contexte.combleIsolation] ?? B_COMBLE.isole);
  const bPlancherBas = bPlancherBasPour(data.coefficientsB, saisie.plancherBasType, contexte.sousSolAvecOuvertures);
  const rangs = saisie.niveaux.map((n) => n.rang ?? 0);
  const rangMax = Math.max(...rangs);
  // rangMin (pas 0 en dur) : le niveau le plus bas EXISTANT porte le plancher bas — sinon
  // supprimer le niveau rez ferait disparaître silencieusement les déperditions plancher (R6/#3).
  const rangMin = Math.min(...rangs);
  const toitureRampant = saisie.toitureType === 'rampant';

  const chauffees = saisie.pieces.filter((p) => p.chauffee);
  if (chauffees.length === 0) erreurs.push('aucune pièce chauffée — ajoutez au moins une pièce chauffée');

  const paroisResolues = [];
  const piecesBat = [];
  for (const p of chauffees) {
    if (!Number.isFinite(p.thetaInt)) { erreurs.push(`« ${p.nom ?? p.id} » : température de consigne manquante`); continue; }
    const niveau = saisie.niveaux.find((n) => n.id === p.niveauId);
    const ctx = {
      compositions, uDefauts: data.uDefauts, annee: contexte.annee, deltaUtb: deltaUtb ?? 0,
      bPlancherBas, bComble, toitureRampant,
      estRez: (niveau?.rang ?? 0) === rangMin, estDernier: (niveau?.rang ?? 0) === rangMax,
    };
    const { parois, erreurs: errP } = paroisPieceParametrique(p, ctx);
    erreurs.push(...errP);
    paroisResolues.push(...parois);
    const surface = (p.longueur / 100) * (p.largeur / 100);
    const volume = surface * (p.hauteur / 100);
    piecesBat.push({ id: p.id, nom: p.nom, surface, volume, thetaInt: p.thetaInt, humide: typePieceInfo(p.typePiece).humide, parois });
  }

  let systemeVentilation = null; let debitTotal = null;
  try {
    const nbPrincipales = chauffees.filter((p) => typePieceInfo(p.typePiece).principale).length;
    ({ systeme: systemeVentilation, debitTotal } = debitVentilationPour(data.ventilation, contexte.typeVentilation, Math.max(1, nbPrincipales)));
  } catch (e) { erreurs.push(e.message); }

  if (erreurs.length > 0) return { batiment: null, thetaE, parois: paroisResolues, erreurs, avertissements };

  const batiment = {
    thetaExt: thetaE, systemeVentilation, debitTotal,
    fRH: contexte.relance ? reglages.fRH : 0,
    plageVraisemblance: PLAGES_VRAISEMBLANCE[resolvePeriode(contexte.annee)],
    pieces: piecesBat,
  };
  return { batiment, thetaE, parois: paroisResolues, erreurs, avertissements };
}
