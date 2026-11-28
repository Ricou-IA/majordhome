// src/lib/fumisterie/index.js
// Point d'entrée UNIQUE du moteur de métré (écran, edge Hermes, PDF) — module PUR.
// ENGINE_VERSION à incrémenter à tout changement de règle : fum_metres.engine_version le porte
// et l'écran affiche une bannière si le résultat enregistré vient d'une autre version.
import { geometrieG1, hauteurSortieMinimale } from './gabarits/g1.js';
import { geometrieG4 } from './gabarits/g4.js';
import { geometrieG3, hauteurSortieMinimaleG3 } from './gabarits/g3.js';
import { geometrieG6 } from './gabarits/g6.js';
import { controlesG1, controlesG3, controlesG4, controlesG5, controlesG6, controlesNomenclature, pointsAVerifier, natureInstallation } from './controles.js';
import { construireNomenclature, totaliser } from './nomenclature.js';
import { reglagesDuFabricant } from './config.js';
import { bilanConduitExistant, justificationDimensionnement } from './bilanExistant.js';

// dtu-2026.11 : hauteur de sortie selon l'arrêté de 1969 (8 m, acrotère, obstacle, toit plat < 15°), règles
// du NF DTU 24.1 / Cahier CSTB 3708 en alertes non bloquantes, points « à vérifier sur place ».
// fab-2026.11 : longueurs propres au fabricant, réglable choisi par sa plage, bilan du conduit existant et
// justification du dimensionnement figés dans le résultat.
// fab-2026.11b : flexible vendu en couronnes, motif {=D}, repli par motif sur le même type de pièce, doublon de
// référence au tarif sans ambiguïté, rigide composé dans les longueurs du fabricant.
// fab-2026.11c : supports au plancher et de toiture (NF DTU 24.1 § 5.4.3), coquille isolante en option (+ fourreau
// écart au feu), rosaces décoratives retirées, motifs {=D+n} et {D:a|b}, option absente du relevé = « non ».
export const ENGINE_VERSION = 'fab-2026.11d'; // d : justification absente = « Non renseignée » (plus « Notice »)

const GABARITS = {
  G1: { geometrie: geometrieG1, controles: controlesG1, sortieMinimale: hauteurSortieMinimale },
  // Tubage : même géométrie, le code du gabarit dit si le conduit est flexible (G4) ou rigide PRH (G4R).
  G4: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false }, cfg), controles: controlesG4, sortieMinimale: null },
  G4R: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: true }, cfg), controles: controlesG4, sortieMinimale: null },
  // Flexible isolé POLYPERF : le bas de conduit (`bas`) décide de l'entrée ; sur un foyer, pas de tuyau de raccordement.
  G4P: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false, entree: r.bas === 'mur' ? 'mur' : 'plafond', hsp1: r.bas === 'foyer' ? r.hBuse : r.hsp1 }, cfg), controles: (g, r, cfg, conf) => controlesG4(g, r, cfg, conf).filter((a) => !(a.code === 'buse' && r.bas === 'foyer')), sortieMinimale: null },
  // Kit rénovation PLA (adaptateurs haut/bas) : même géométrie qu'un tubage flexible.
  G4K: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false }, cfg), controles: controlesG4, sortieMinimale: null },
  // Foyer raccordé directement au flexible (Griffaflex) : pas de tuyau simple paroi.
  G4F: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false, entree: 'plafond', hsp1: r.hBuse }, cfg), controles: (g, r, cfg, conf) => controlesG4(g, r, cfg, conf).filter((a) => a.code !== 'buse'), sortieMinimale: null },
  // Raccordement seul : pas de conduit métré (dessiné à titre indicatif).
  G5: { geometrie: (r, cfg) => geometrieG4({ ...r, rigide: false, hConduit: 0 }, cfg), controles: controlesG5, sortieMinimale: null },
  G3: { geometrie: geometrieG3, controles: controlesG3, sortieMinimale: hauteurSortieMinimaleG3 },
  G3P: { geometrie: geometrieG3, controles: controlesG3, sortieMinimale: hauteurSortieMinimaleG3 },
  G6: { geometrie: geometrieG6, controles: controlesG6, sortieMinimale: null },
};

/**
 * Un paramètre conditionnel (`si`) n'est affiché — donc exigé — que si sa condition est remplie :
 * `{ nbEtages: 1 }` (égalité) ou `{ angle: '>0' }`.
 * @param {{ si?: Record<string, unknown> }} p paramètre du gabarit
 * @param {Record<string, unknown>} releve
 * @returns {boolean}
 */
export function parametreVisible(p, releve) {
  if (!p.si) return true;
  return Object.entries(p.si).every(([k, v]) => (v === '>0' ? Number(releve[k]) > 0 : releve[k] === v));
}

const fmt = (v) => String(v).replace('.', ',');

/**
 * Contrôle le relevé contre les paramètres du gabarit : chaque paramètre visible doit être un
 * nombre fini dans [min, max] (ou l'une des valeurs de `choix`). Un champ vidé ne doit JAMAIS
 * devenir un 0 silencieux dans la géométrie.
 * @param {{ troncons?: Array<{ parametres: Array<object> }> } | null | undefined} gabarit
 * @param {Record<string, unknown> | null | undefined} releve
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function validerReleve(gabarit, releve) {
  if (!gabarit?.troncons?.length) return { ok: false, erreurs: ['gabarit de métré absent'] };
  const r = releve || {};
  const erreurs = [];
  for (const t of gabarit.troncons) {
    for (const p of t.parametres || []) {
      if (!parametreVisible(p, r)) continue;
      const v = r[p.cle];
      // Une option (tronçon « options » : kit d'air, coquille isolante) n'est jamais obligatoire : absente, elle
      // vaut « non » (brouillon ou métré antérieur à l'option) et la nomenclature ne retient pas ses pièces.
      if (t.type === 'options' && v == null) continue;
      if (p.choix) {
        if (!p.choix.includes(v)) erreurs.push(`${p.libelle} (valeur attendue parmi ${p.choix.map(fmt).join(', ')})`);
        continue;
      }
      if (v === '' || v == null || typeof v !== 'number' || !Number.isFinite(v)) { erreurs.push(`${p.libelle} (non renseigné)`); continue; }
      const u = p.unite ? ` ${p.unite}` : '';
      if ((p.min != null && v < p.min) || (p.max != null && v > p.max)) {
        erreurs.push(`${p.libelle} (${fmt(v)}${u} hors plage ${fmt(p.min ?? '−∞')}–${fmt(p.max ?? '+∞')}${u})`);
      }
    }
  }
  return { ok: erreurs.length === 0, erreurs };
}

/**
 * @param {{ configuration: {code:string, gabarit_code:string}, gabarit: object, composants: object[], mapping: object[],
 *   articles: object[], reglages: object, releve: object }} p
 */
export function calculerMetre({ configuration, gabarit, composants, mapping, articles, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  const moteur = GABARITS[code];
  if (!moteur) throw new Error(`Gabarit ${code} non pris en charge par le moteur (${ENGINE_VERSION})`);
  const validation = validerReleve(gabarit, releve);
  if (!validation.ok) throw new Error(`Relevé incomplet : ${validation.erreurs.join(' ; ')}`);
  const geometrie = moteur.geometrie(releve, reglages);
  const alertes = moteur.controles(geometrie, releve, reglages, configuration);
  const nomenclature = construireNomenclature({ composants, mapping, articles, geometrie, releve, reglages });
  const lignes = nomenclature.lignes;
  // Bilan du conduit existant et justification : figés avec le résultat (la fiche chantier les relit).
  const bilan = bilanConduitExistant(releve, code, configuration);
  const justification = justificationDimensionnement(releve);
  const alertesBilan = (bilan?.nonConformites || []).map((n) => ({ niveau: 'warn', code: n.code, message: n.texte, source: n.source }));
  const alerteJustification = justification.mode === 'non_justifie'
    ? [{ niveau: 'info', code: 'dimensionnement_non_justifie', source: 'NF DTU 24.1 § 5.5', message: 'Dimensionnement non justifié (notice, essai de couplage, abaque ou logiciel) : il sera écrit tel quel sur la fiche chantier.' }]
    : [];
  return { engine_version: ENGINE_VERSION, geometrie, lignes,
    alertes: [...alertes, ...alertesBilan, ...alerteJustification, ...nomenclature.alertes, ...controlesNomenclature(code, lignes, releve), ...pointsAVerifier(code, configuration)],
    totaux: totaliser(lignes), bilan, justification: justification.texte };
}

/**
 * Équivalence de gamme d'un fabricant pour le relevé : celle de la finition relevée, sinon la première.
 * @param {Array<{ finition?: string|null }>|null|undefined} equivalences
 * @param {{ finition?: string }} releve
 */
export function equivalencePour(equivalences, releve) {
  if (!equivalences?.length) return null;
  return equivalences.find((e) => e.finition === releve?.finition) || equivalences.find((e) => !e.finition) || equivalences[0];
}

/**
 * Le même relevé calculé chez chaque fabricant reconnu pour la configuration. Un fabricant sans mapping pour
 * les composants de la configuration n'a pas de colonne (jamais une colonne à 0 €). « Moins cher » n'est
 * désigné que s'il y a au moins deux colonnes, toutes complètes (aucune ligne à chiffrer ni ambiguë).
 * @param {{ configuration: object, gabarit: object, composants: object[], reglages: object, releve: object }} base
 * @param {Array<{ supplierId: string, nom: string, mapping: object[], articles: object[], equivalences?: object[]|null, historique?: boolean, prixVerifies?: boolean }>} fabricants
 * @returns {{ colonnes: Array<{ supplierId:string, nom:string, resultat:object|null, totaux:object|null, aChiffrer:number, ambigus:number, validee:boolean, prixVerifies:boolean, erreur:string|null }>, complete: boolean, moinsCher: string|null }}
 */
export function comparerFabricants(base, fabricants) {
  const codes = new Set((base.composants || []).map((c) => c.composant_code));
  const colonnes = [];
  for (const f of fabricants) {
    if (!f.mapping?.some((m) => codes.has(m.composant_code))) continue;
    // Un fabricant ajouté n'a de colonne que pour une configuration qui a son équivalence de gamme : ses lignes de
    // mapping partagées (tuyau de raccordement…) ne suffisent pas à le rendre comparable.
    if (!f.historique && !f.equivalences?.length) continue;
    const equivalence = equivalencePour(f.equivalences, base.releve);
    let resultat = null; let erreur = null;
    try {
      resultat = calculerMetre({ ...base, mapping: f.mapping, articles: f.articles || [], reglages: reglagesDuFabricant(base.reglages, equivalence) });
    } catch (e) { erreur = e.message; }
    const alertes = resultat?.alertes || [];
    colonnes.push({
      supplierId: f.supplierId, nom: f.nom, resultat, totaux: resultat?.totaux || null, erreur,
      aChiffrer: alertes.filter((a) => a.code === 'article_manquant').length,
      ambigus: alertes.filter((a) => a.code === 'article_ambigu').length,
      // Le fabricant historique (mapping écrit avec le catalogue de la configuration) fait référence.
      validee: f.historique ? true : !!equivalence?.validee_le,
      prixVerifies: f.prixVerifies !== false,
    });
  }
  const complete = colonnes.length > 1 && colonnes.every((c) => !c.erreur && c.aChiffrer === 0 && c.ambigus === 0);
  const moinsCher = complete ? colonnes.reduce((a, b) => (b.totaux.vente_ht < a.totaux.vente_ht ? b : a)).supplierId : null;
  return { colonnes, complete, moinsCher };
}

/**
 * Colonne de la comparaison dont le calcul est affiché et injecté : le fabricant choisi s'il a une colonne,
 * sinon le fabricant historique, sinon la première.
 * @param {ReturnType<typeof comparerFabricants>|null} comparaison
 * @param {string|null} supplierId choix de l'utilisateur (ou dernier choix de l'organisation)
 * @param {Array<{ supplierId: string, historique?: boolean }>} [fabricants]
 */
export function choisirColonne(comparaison, supplierId, fabricants = []) {
  const cols = comparaison?.colonnes || [];
  if (!cols.length) return null;
  const historique = fabricants.find((f) => f.historique)?.supplierId;
  return cols.find((c) => c.supplierId === supplierId) || cols.find((c) => c.supplierId === historique) || cols[0];
}

/** Hauteur de sortie minimale conforme pour le gabarit de la configuration (bouton « Ajuster »). null si le gabarit n'a pas de sortie de toit (tubage). */
export function sortieMinimale({ configuration, gabarit, reglages, releve }) {
  const code = gabarit?.code || configuration?.gabarit_code;
  const fn = GABARITS[code]?.sortieMinimale;
  return fn ? fn(releve, reglages) : null;
}

export { geometrieG1, geometrieG3, geometrieG4, geometrieG6, controlesG1, controlesG3, controlesG4, controlesG5, controlesG6, controlesNomenclature, pointsAVerifier, natureInstallation, construireNomenclature, totaliser };
