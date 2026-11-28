// src/lib/fumisterie/complements.js
// Compléments FACULTATIFS du relevé — module PUR. Ils affinent les règles du NF DTU 24.1 et du
// Cahier CSTB 3708 sans jamais rien exiger : `validerReleve` ne les connaît pas, un complément vide
// laisse la règle « non vérifiée » (jamais « conforme »), et l'injection n'est jamais bloquée.
// Ils vivent dans le relevé (fum_metres.releve) à côté des paramètres du gabarit.

const TOUS = ['G1', 'G3', 'G3P', 'G4', 'G4R', 'G4P', 'G4K', 'G4F', 'G5', 'G6'];
const SORTIE_TOIT = ['G1', 'G3', 'G3P'];
const TUBAGES = ['G4', 'G4R', 'G4P', 'G4K', 'G4F'];

/**
 * @type {Array<{ cle:string, libelle:string, type:'nombre'|'choix'|'texte', unite?:string, choix?:string[],
 *   libelles?:Record<string,string>, gabarits:string[], groupe:string, min?:number, max?:number, pas?:number, aide?:string }>}
 */
export const COMPLEMENTS = Object.freeze([
  // Débouché (arrêté du 22/10/1969, art. 18)
  { cle: 'obstacleDistance', libelle: 'Obstacle plus haut : distance horizontale', type: 'nombre', unite: 'm', min: 0, max: 50, pas: 0.1, gabarits: SORTIE_TOIT, groupe: 'debouche',
    aide: 'Bâtiment, mur ou arbre plus haut que la sortie à proximité. Pris en compte à moins de 8 m.' },
  { cle: 'obstacleHauteur', libelle: 'Obstacle : hauteur au-dessus de la sortie de toit', type: 'nombre', unite: 'm', min: 0, max: 30, pas: 0.05, gabarits: SORTIE_TOIT, groupe: 'debouche' },
  { cle: 'hAcrotere', libelle: 'Toit plat : hauteur de l\'acrotère', type: 'nombre', unite: 'm', min: 0, max: 3, pas: 0.05, gabarits: SORTIE_TOIT, groupe: 'debouche' },
  // Raccordement
  { cle: 'sortieBuse', libelle: 'Sortie de la buse', type: 'choix', choix: ['dessus', 'arriere'], libelles: { dessus: 'Dessus', arriere: 'Arrière ou côté' }, gabarits: TOUS, groupe: 'raccordement' },
  { cle: 'diametreBuse', libelle: 'Diamètre de la buse', type: 'nombre', unite: 'mm', min: 60, max: 300, pas: 1, gabarits: TOUS, groupe: 'raccordement' },
  { cle: 'angleBoisseau', libelle: 'Dévoiement du conduit existant (angle)', type: 'nombre', unite: '°', min: 0, max: 90, pas: 1, gabarits: TUBAGES, groupe: 'raccordement' },
  // Ventouse (Cahier CSTB 3708)
  { cle: 'hVerticalNotice', libelle: 'Hauteur verticale minimale avant la ventouse (notice)', type: 'nombre', unite: 'm', min: 0, max: 5, pas: 0.05, gabarits: ['G6'], groupe: 'ventouse' },
  { cle: 'batimentRecentOuErp', libelle: 'Bâtiment de moins de 3 ans, ou établissement recevant du public', type: 'choix', choix: ['non', 'oui'], libelles: { non: 'Non', oui: 'Oui' }, gabarits: ['G6'], groupe: 'ventouse' },
]);

/**
 * @param {string} code code du gabarit
 * @returns {typeof COMPLEMENTS}
 */
export function complementsDuGabarit(code) {
  return COMPLEMENTS.filter((c) => c.gabarits.includes(code));
}

const PAR_CLE = Object.fromEntries(COMPLEMENTS.map((c) => [c.cle, c]));

/**
 * Valeur utilisable d'un complément : `null` si vide, illisible ou hors plage — jamais un 0 inventé.
 * @param {Record<string, unknown>|null|undefined} releve
 * @param {string} cle
 * @returns {number|string|null}
 */
export function lireComplement(releve, cle) {
  const def = PAR_CLE[cle];
  const v = releve?.[cle];
  if (!def || v == null || v === '') return null;
  if (def.type === 'nombre') {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
    if (!Number.isFinite(n)) return null;
    if ((def.min != null && n < def.min) || (def.max != null && n > def.max)) return null;
    return n;
  }
  if (def.type === 'choix') return def.choix.includes(v) ? v : null;
  return String(v).trim() || null;
}
