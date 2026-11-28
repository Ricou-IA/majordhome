// Fiche de relecture docs/devis-fumisterie/correspondances-dinak.md, générée depuis data/equivalences-gammes.json et
// data/dinak-mapping.json. Usage : node scripts/fumisterie/gen-doc-correspondances-dinak.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const R = fileURLToPath(new URL('./data/', import.meta.url));
const E = JSON.parse(readFileSync(R + 'equivalences-gammes.json', 'utf8'));
const M = JSON.parse(readFileSync(R + 'dinak-mapping.json', 'utf8'));
const lg = (a) => (a ? a.join(' / ') : '—');
const out = [];
out.push('# Correspondances DINAK ↔ MODINOX — à relire');
out.push('');
out.push('> Générée le 2026-11-28 depuis `scripts/fumisterie/data/equivalences-gammes.json` et `dinak-mapping.json`.');
out.push('> Une équivalence non validée s’affiche « non validée » dans la comparaison des fabricants. Pour valider : dire « validée » (ou corriger) configuration par configuration.');
out.push('');
out.push('## Équivalences de gamme par configuration');
out.push('');
out.push('| Configuration | Finition | Gamme DINAK | Éléments (mm) | Raccordement (mm) | Réglable (mm) | Validée | Remarque |');
out.push('|---|---|---|---|---|---|---|---|');
for (const e of E) {
  out.push(`| ${e.configuration_code} | ${e.finition ?? '—'} | ${e.gamme_tarif} | ${lg(e.longueurs_elements_mm)} | ${lg(e.longueurs_raccordement_mm)} | ${e.reglable_min_mm ? `${e.reglable_min_mm}–${e.reglable_max_mm}` : '—'} | ${e.validee_le ? `oui (${e.validee_par})` : 'non'} | ${e.notes.replace(/\|/g, '/')} |`);
}
out.push('');
out.push('## Ce qui reste « à chiffrer » chez DINAK (pièces que DINAK ne vend pas sous cette forme)');
out.push('');
out.push('- **CFG-26 / CFG-34** (tubage flexible dans un boisseau) : plaque d’habillage ventilée (entrée par le plafond) ou adaptateur de piquage 90° sur boisseau (entrée par le mur).');
out.push('- **CFG-27 en Ø130** : DINAK ne fait pas de SW BOIS en Ø130 — tout le rigide sort à chiffrer. Ø150 et Ø180 complets.');
out.push('- **CFG-28, 29, 30, 31, 33, 48** (concentrique granulés) : manchon de raccordement sur l’appareil (raccord bi-flux, trois variantes selon la marque du poêle). CFG-28 et 48 : DIFLUX n’a pas de coude à 30°.');
out.push('- **CFG-32 / CFG-42** : souche Polytoit et ses deux pièces (DINASOUCHE se choisit à la dimension de la souche).');
out.push('- **CFG-45** : en Ø80/100 le tuyau court DEKO pellets fait 200 mm (285 en bois) ; rosace à sceller (entrée par le mur) absente en bois.');
out.push('- **CFG-37 / CFG-39** (gaine isolée POLYPERF vendue en kit) et **CFG-40** (conduit MFI) : aucune correspondance DINAK préparée. La gamme DINAFLEX ISOLÉ (15 articles, extraite) n’a pas encore été étudiée.');
out.push('');
out.push('## Supports et coquille isolante (règles du 2026-11-28)');
out.push('');
out.push('- **Support au plancher**, un par plancher traversé (NF DTU 24.1 § 5.4.3), sur les configurations à conduit intérieur (CFG-24, 28, 32, 40, 42, 48). MODINOX : support au plancher galva, coté au Ø extérieur du conduit. DINAK : collier à dalle renforcé 180° (galva : la gamme DW BOIS BLACK n’en a pas).');
out.push('- **Support de toiture** : c’est le « collier universel sous toiture » déjà présent sur CFG-24, ajouté à CFG-28, 40 et 48. Il est désormais pris au Ø extérieur du PTR (PTR150 → D 210) : avant, le collier D 150 du PLA100 / simple paroi 150 était retenu. Pas d’ajout sur CFG-32 / 42 : la souche Polytoit a son propre collier de fixation. DINAK : support au toit avec profil.');
out.push('- **Coquille isolante (option du relevé, décochée par défaut)** : coquille + protection écart au feu, une de chaque par plancher traversé (quantité à confirmer). MODINOX : coquille GBI laine de roche au Ø extérieur, fourreau isolant n°1 à 4 selon le Ø. MFI : pas de coquille GBI à son Ø extérieur → à chiffrer. **DINAK : ni coquille ni fourreau au tarif → les deux lignes sortent à chiffrer.**');
out.push('- **Rosaces** : la rosace de finition (CFG-45, entrée par le plafond) et la rosace plate 2 parties (CFG-29) sortent du métré. Restent la rosace à sceller (traversée de mur) et la plaque de propreté RT2012 (kit RT2012). Chez DINAK, la plaque de propreté RT2012 correspond à une « rosace de finition » (validé le 2026-11-28 sur CFG-24) : à revoir si elle doit être technique.');
out.push('');
out.push('## Correspondance pièce par pièce');
out.push('');
out.push('`{D2}` = Ø sur deux chiffres (150 → 15) ; `{=D}` = même Ø que le relevé, la référence ne le porte pas. Priorité basse = essayée en premier ; une ligne de priorité plus haute est un repli.');
out.push('');
out.push('| Composant MODINOX | Gamme MODINOX | Finition | Gamme DINAK | Pièce | Motif de référence | Priorité | Remarque |');
out.push('|---|---|---|---|---|---|---|---|');
for (const m of [...M].sort((a, b) => a.gamme_catalogue.localeCompare(b.gamme_catalogue) || a.composant_code.localeCompare(b.composant_code) || (a.priorite ?? 100) - (b.priorite ?? 100))) {
  out.push(`| ${m.composant_code} | ${m.gamme_catalogue} | ${m.finition ?? '—'} | ${m.gamme_tarif} | ${m.type_piece} | ${m.motif_code ? '`' + m.motif_code.replace(/\|/g, '\\|') + '`' : '—'} | ${m.priorite ?? 100} | ${(m.notes ?? '').replace(/\|/g, '/')} |`);
}
writeFileSync(fileURLToPath(new URL('../../docs/devis-fumisterie/correspondances-dinak.md', import.meta.url)), out.join('\n') + '\n');
console.log(E.length, 'équivalences,', M.length, 'lignes de correspondance');
