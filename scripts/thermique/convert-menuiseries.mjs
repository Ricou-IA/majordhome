// Conversion Vitrages.txt, Menuiseries.txt, Volets.txt, WarmEdge.txt, CoffreVolets.txt
// -> src/apps/thermique/data/menuiseries.json
//
// NB fenetresTypes : les sources ne fournissent que des composants (Ug des vitrages, Uf des
// profils de menuiserie, deltaR des volets) et jamais un Uw de fenêtre complète prêt à choisir.
// Calculer un Uw à partir de Ug/Uf nécessiterait les fractions de surface vitrage/cadre (non
// présentes dans ces fichiers) : on ne fabrique donc AUCUNE valeur Uw. fenetresTypes est omis.
import { SRC_ROOT_2024, readSource, writeDataJson } from './lib/sourceFiles.js';
import {
  parseVitrages, parseMenuiseriesProfils, parseVolets, parseWarmEdge, parseCoffresVolets,
} from './lib/parseMenuiseries.js';

// Règle "per-file newest" (cf. sourceFiles.js) : Vitrages/Menuiseries/Volets sont plus récents
// dans l'install 2024 ; WarmEdge/CoffreVolets sont identiques octet à octet dans les deux
// installs, on lit donc les 5 fichiers depuis la même racine 2024.
console.log(`source : ${SRC_ROOT_2024}/{Vitrages,Menuiseries,Volets,WarmEdge,CoffreVolets}.txt`);
const vitrages = parseVitrages(readSource('Vitrages.txt', SRC_ROOT_2024));
const menuiseriesTypes = parseMenuiseriesProfils(readSource('Menuiseries.txt', SRC_ROOT_2024));
const volets = parseVolets(readSource('Volets.txt', SRC_ROOT_2024));
const intercalairesWarmEdge = parseWarmEdge(readSource('WarmEdge.txt', SRC_ROOT_2024));
const coffresVolets = parseCoffresVolets(readSource('CoffreVolets.txt', SRC_ROOT_2024));

if (vitrages.length < 3) throw new Error(`${vitrages.length} vitrages seulement — parser à vérifier`);
if (menuiseriesTypes.length < 2) throw new Error(`${menuiseriesTypes.length} profils menuiserie seulement — parser à vérifier`);
if (intercalairesWarmEdge.length < 3) throw new Error(`${intercalairesWarmEdge.length} intercalaires warm-edge seulement — parser à vérifier`);

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
// Ψ linéique d'intercalaire typique : 0.03-0.1 W/(m.K) ; bornes larges [0, 0.2].
for (const { nom, psi } of intercalairesWarmEdge) {
  if (psi < 0 || psi > 0.2) throw new Error(`Intercalaire "${nom}" : psi=${psi} hors [0, 0.2]`);
}
// CoffreVolets.txt exprime aussi un coefficient U (Uc) : mêmes bornes que ug/uf.
for (const { nom, uc } of coffresVolets) {
  if (uc < 0.5 || uc > 6.5) throw new Error(`Coffre volet "${nom}" : uc=${uc} hors [0.5, 6.5]`);
}

writeDataJson('menuiseries.json',
  {
    source: 'C:\\Thermique2 (Vitrages, Menuiseries, Volets 2024 ; WarmEdge, CoffreVolets identiques dans les deux installs)',
    license: 'proprietary-internal',
    note: "fenetresTypes omis : les sources ne donnent que des composants (Ug/Uf/deltaR), jamais un Uw de fenêtre complète — aucune valeur n'est calculée/inventée. intercalairesWarmEdge (psi, W/(m.K)) et coffresVolets (Uc, W/(m².K)) sont des grandeurs annexes hors du triplet ug/uf/deltaR, ajoutées car les fichiers sources existent et sont exploitables.",
  },
  { vitrages, menuiseriesTypes, volets, intercalairesWarmEdge, coffresVolets });
