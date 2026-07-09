// src/apps/thermique/lib/assembleBatimentParametrique.js
// Assembleur PARAMÉTRIQUE (2026-07-09) : saisie (emprise + pièces paramétriques) → batiment résolu
// pour calculeBatiment. Module PUR. Remplace la chaîne géométrique deduireParois/assembleBatiment
// pour le mode 'parametrique' — le moteur physique (thermalEngine) reste inchangé.
import { surfaceCm2, perimetreCm } from './geometryEngine.js';
import { uDefautPour } from './refDataResolvers.js';

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

  const surfMurExt = (piece.mlMurExterieur ?? 0) / 100 * H - (piece.surfaceOuverture ?? 0);
  if (surfMurExt < 0) {
    erreurs.push(`« ${nom} » : surface d'ouverture (${piece.surfaceOuverture} m²) supérieure au mur extérieur déclaré`);
    return { parois, erreurs };
  }

  const pousse = (famille, type, surface, refTemp) => {
    if (surface <= 0) return;
    const u = resoudUFamille(ctx.compositions, famille, piece.id, { uDefauts: ctx.uDefauts, annee: ctx.annee });
    if (!Number.isFinite(u) || u <= 0) { erreurs.push(`« ${nom} » : U manquant pour « ${famille} »`); return; }
    const poste = famille === 'murs' ? 'murs'
      : famille === 'plancherBas' ? 'plancherBas'
      : famille === 'plafondToiture' ? 'plafondToiture' : 'menuiseries';
    parois.push({ surface, u, deltaUtb: ctx.deltaUtb, poste, type, pieceId: piece.id, ...refTemp });
  };

  // Mur extérieur (b=1) et menuiserie (b=1)
  pousse('murs', 'mur-exterieur', surfMurExt, { b: 1 });
  const famMenu = MENU_FAMILLE[piece.typeMenuiserie] ?? 'fenetre';
  pousse(famMenu, 'menuiserie', piece.surfaceOuverture ?? 0, { b: 1 });
  // Mur sur local non chauffé (b = bLocalNonChauffe)
  const surfLnc = (piece.mlMurLocalNonChauffe ?? 0) / 100 * H;
  pousse('murs', 'mur-lnc', surfLnc, { b: Number.isFinite(piece.bLocalNonChauffe) ? piece.bLocalNonChauffe : 1 });
  // Plancher bas (si rez) / plafond (si dernier niveau)
  if (ctx.estRez) pousse('plancherBas', 'plancher-bas', surfaceSol, { b: ctx.bPlancherBas });
  if (ctx.estDernier) pousse('plafondToiture', 'plafond-comble', surfaceSol, { b: ctx.bComble });

  return { parois, erreurs };
}
