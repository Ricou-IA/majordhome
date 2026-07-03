// Conversion Vitrages.txt, Menuiseries.txt, Volets.txt, WarmEdge.txt, CoffreVolets.txt
// -> src/apps/thermique/data/menuiseries.json
//
// NB fenetresTypes : les sources ne fournissent que des composants (Ug des vitrages, Uf des
// profils de menuiserie, deltaR des volets) et jamais un Uw de fenêtre complète prêt à choisir.
// Calculer un Uw à partir de Ug/Uf nécessiterait les fractions de surface vitrage/cadre (non
// présentes dans ces fichiers) : on ne fabrique donc AUCUNE valeur Uw. fenetresTypes est omis.
import { readSource, writeDataJson } from './lib/sourceFiles.js';
import {
  parseVitrages, parseMenuiseriesProfils, parseVolets, parseWarmEdge, parseCoffresVolets,
} from './lib/parseMenuiseries.js';

const vitrages = parseVitrages(readSource('Vitrages.txt'));
const menuiseriesTypes = parseMenuiseriesProfils(readSource('Menuiseries.txt'));
const volets = parseVolets(readSource('Volets.txt'));
const intercalairesWarmEdge = parseWarmEdge(readSource('WarmEdge.txt'));
const coffresVolets = parseCoffresVolets(readSource('CoffreVolets.txt'));

if (vitrages.length < 3) throw new Error(`${vitrages.length} vitrages seulement — parser à vérifier`);
if (menuiseriesTypes.length < 2) throw new Error(`${menuiseriesTypes.length} profils menuiserie seulement — parser à vérifier`);

// Garde-fous physiques (bornes de la tâche) : ug/uf dans [0.5, 6.5], deltaR dans [0, 1].
for (const { nom, ug } of vitrages) {
  if (ug < 0.5 || ug > 6.5) throw new Error(`Vitrage "${nom}" : ug=${ug} hors [0.5, 6.5]`);
}
for (const { nom, uf } of menuiseriesTypes) {
  if (uf < 0.5 || uf > 6.5) throw new Error(`Menuiserie "${nom}" : uf=${uf} hors [0.5, 6.5]`);
}
for (const { nom, deltaR } of volets) {
  if (deltaR < 0 || deltaR > 1) throw new Error(`Volet "${nom}" : deltaR=${deltaR} hors [0, 1]`);
}
// CoffreVolets.txt exprime aussi un coefficient U (Uc) : mêmes bornes que ug/uf.
for (const { nom, uc } of coffresVolets) {
  if (uc < 0.5 || uc > 6.5) throw new Error(`Coffre volet "${nom}" : uc=${uc} hors [0.5, 6.5]`);
}

writeDataJson('menuiseries.json',
  {
    source: 'C:\\Thermique (Vitrages, Menuiseries, Volets, WarmEdge, CoffreVolets)',
    license: 'proprietary-internal',
    note: "fenetresTypes omis : les sources ne donnent que des composants (Ug/Uf/deltaR), jamais un Uw de fenêtre complète — aucune valeur n'est calculée/inventée. intercalairesWarmEdge (psi, W/(m.K)) et coffresVolets (Uc, W/(m².K)) sont des grandeurs annexes hors du triplet ug/uf/deltaR, ajoutées car les fichiers sources existent et sont exploitables.",
  },
  { vitrages, menuiseriesTypes, volets, intercalairesWarmEdge, coffresVolets });
