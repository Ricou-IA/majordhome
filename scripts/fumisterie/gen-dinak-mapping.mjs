// Génère scripts/fumisterie/data/dinak-mapping.json : correspondances composant MODINOX → pièce DINAK.
// Une ligne = (composant, gamme catalogue) → (gamme du tarif DINAK, type de pièce, motif). priorite : 100 puis 200 (repli, ex. Ø80 pellets).
// Le JSON produit est commité et lu par les tests (couverture figée dans fabricants.test.mjs) et par import-attrs-dinak.mjs.
// Usage : node scripts/fumisterie/gen-dinak-mapping.mjs
// Pas de ligne = pas d'équivalent DINAK : la pièce sort « à chiffrer » (coquille isolante, fourreau isolant…), jamais approchée.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const L = [];
const ligne = (composant_code, gamme_catalogue, gamme_tarif, type_piece, motif_code = null, extra = {}) =>
  L.push({ composant_code, gamme_catalogue, finition: extra.finition ?? null, gamme_tarif, type_piece, motif_code, priorite: extra.priorite ?? 100, ...(extra.statut ? { statut: extra.statut } : {}), ...(extra.notes ? { notes: extra.notes } : {}) });
const BOIS_I = 'DW BOIS 316L / 304'; const BOIS_N = 'DW BOIS BLACK'; const PEL_I = 'DW PELLETS'; const PEL_N = 'DW PELLETS BLACK';
// Éléments droits et ajustable court (023), inox / noir : la finition est dans la référence (03 01… / 03 21…N).
const ELT_I = '^0301{D2}02[0345]DW$'; const ELT_N = '^0321{D2}02[0345]DWN$';

// ── PTR30 → DW BOIS (bois, Ø130+) ; repli DW PELLETS (Ø80/100/130) ───────────────────────────────────────
for (const [gi, gn, p] of [[BOIS_I, BOIS_N, 100], [PEL_I, PEL_N, 200]]) {
  ligne('chapeau_anti_refouleur', 'PTR30', gn, 'chapeau_anti_refouleur', null, { finition: 'noir', priorite: p, notes: 'Capuchon antivent' });
  ligne('chapeau_anti_refouleur', 'PTR30', gi, 'chapeau_anti_refouleur', null, { finition: 'inox', priorite: p, notes: 'Capuchon antivent' });
  ligne('element_droit_exterieur', 'PTR30', gn, 'element_droit', ELT_N, { finition: 'noir', priorite: p });
  ligne('element_droit_exterieur', 'PTR30', gi, 'element_droit', ELT_I, { finition: 'inox', priorite: p });
  ligne('collier_jonction_exterieur', 'PTR30', gn, 'collier_jonction', null, { finition: 'noir', priorite: p, statut: 'provisoire' });
  ligne('collier_jonction_exterieur', 'PTR30', gi, 'collier_jonction', null, { finition: 'inox', priorite: p, statut: 'provisoire' });
  ligne('solin', 'PTR30', gi, 'solin', null, { priorite: p, notes: 'Solin de toit inox en pente (plomb et composite écartés)' });
  ligne('collier_sous_toiture', 'PTR30', gi, 'collier_sous_toiture', null, { priorite: p, notes: 'Support de toiture : support au toit avec profil (le renforcé est écarté)' });
  ligne('coude_devoiement', 'PTR30', gi, 'coude', null, { priorite: p });
  ligne('element_droit_interieur', 'PTR30', gi, 'element_droit', ELT_I, { priorite: p });
  ligne('element_traversee_mur', 'PTR30', gi, 'element_droit', ELT_I, { priorite: p });
  ligne('plaque_proprete_rt2012', 'PTR30', gi, 'rosace', null, { priorite: p, notes: 'Rosace de finition — validée par Eric le 2026-11-28 (CFG-24)' });
  ligne('couronne_coupe_feu', 'PTR30', gi, 'plaque_ecart_feu_ventilee', null, { priorite: p, notes: "Plaque d'écart au feu ventilée — validée par Eric le 2026-11-28 (CFG-24)" });
  ligne('support_mural_intermediaire', 'PTR30', gi, 'collier_mural', '^0309{D2}080(DW)?$', { priorite: p, notes: 'Collier mural' });
  ligne('support_mural_depart', 'PTR30', gi, 'support', '^0601{D2}853DW$', { priorite: p, notes: 'Support de base avec manchon' });
  ligne('te_90_ptr', 'PTR30', gi, 'te', '^0301{D2}031DW$', { priorite: p, notes: 'Té 90°' });
  ligne('purge_ptr', 'PTR30', gi, 'tampon', '^0301{D2}061DW$', { priorite: p, notes: 'Tampon purge' });
}
// Support au plancher (NF DTU 24.1 § 5.4.3) : collier à dalle renforcé, galva (la gamme DW BOIS BLACK n'en a pas).
ligne('support_plancher', 'PTR30', 'DW BOIS 304 / GALVA', 'collier_mural', '^0309{D2}903(DW)?$', { notes: 'Collier à dalle renforcé 180°' });
ligne('support_plancher', 'PTR30', PEL_I, 'collier_mural', '^0309{D2}903DW$', { priorite: 200, notes: 'Collier à dalle renforcé 180° (Ø80/100)' });
ligne('raccord_simple_paroi', 'PTR30', BOIS_I, 'raccord_simple_paroi', '^0301{D2}143DE$', { notes: "Raccord d'adaptation DEKO - DW court (330-400 mm)" });

// ── Raccordement simple paroi : DEKO 1,2 mm (bois) ; repli DEKO PELLETS 1,2 mm (Ø80/100) ──────────────────
for (const [cc, gc] of [['tuyau_emaille', 'ÉMAILLÉ'], ['tuyau_emaille_12', 'ÉMAILLÉ'], ['tuyau_acier_peint', 'ACIER PEINT']]) {
  ligne(cc, gc, 'DEKO BOIS 1,2 mm', 'element_droit', '^039A{D2}02[045]D1N$', { notes: 'Tuyau DEKO acier 1,2 mm noir, série D1N (950 / 450 / 285)' });
  ligne(cc, gc, 'DEKO PELLETS 1,2 mm', 'element_droit', '^059G{D2}02[045]P2N/41$', { priorite: 200, notes: 'Tuyau DEKO pellets 1,2 mm noir (950 / 450 / 200)' });
}
ligne('tuyau_emaille_07', 'ÉMAILLÉ', 'DEKO BOIS', 'element_droit', '^039A{D2}02[045]DENI$', { notes: 'Tuyau DEKO (paroi fine)' });
ligne('tuyau_emaille_07', 'ÉMAILLÉ', 'DEKO PELLETS', 'element_droit', '^039A{D2}02[045]PENI$', { priorite: 200, notes: 'Tuyau DEKO pellets (paroi fine, 945 / 445 / 275)' });
ligne('coude_90_raccord', 'ÉMAILLÉ', 'DEKO BOIS 1,2 mm', 'coude', '^039A{D2}433D1N$', { notes: 'Coude 90°' });
ligne('coude_90_raccord', 'ÉMAILLÉ', 'DEKO PELLETS 1,2 mm', 'coude', '^059G{D2}433P2N/41$', { priorite: 200, notes: 'Coude 90°' });
ligne('rosace_sceller', 'ÉMAILLÉ', 'DEKO PELLETS', 'rosace_special', '^039A{D2}114PENI$', { notes: 'Rosace traversée murale (pellets seulement)' });

// ── Flexible POLYLISSE XT → DINAFLEX INOX (couronnes de 6, 8, 10, 15 m) ──────────────────────────────────
ligne('chapeau_gaine_standard', 'POLYLISSE XT', 'DINAFLEX INOX', 'chapeau_anti_refouleur', '{=D}^0390\\d{2}012SW$', { notes: 'Capuchon antivent' });
ligne('chapeau_gaine_plat', 'POLYLISSE XT', 'DINAFLEX INOX', 'chapeau_pare_pluie', '{=D}^0390\\d{2}010SW$', { notes: 'Capuchon pare-pluie' });
ligne('chapeau_gaine_standard', 'POLYLISSE XT', 'DINAFLEX INOX', 'chapeau_anti_refouleur', '{=D}^039F\\d{2}012SW$', { priorite: 200, notes: 'Capuchon antivent (série F)' });
ligne('chapeau_gaine_plat', 'POLYLISSE XT', 'DINAFLEX INOX', 'chapeau_pare_pluie', '{=D}^039F\\d{2}010SW$', { priorite: 200, notes: 'Capuchon pare-pluie (série F)' });
ligne('collier_tubage', 'POLYLISSE XT', 'DINAFLEX INOX', 'collier_mural', null, { notes: 'Collier haut pour tubage' });
ligne('gaine_polylisse', 'POLYLISSE XT', 'DINAFLEX INOX', 'flexible', null, { notes: 'Flexible DINAFLEX inox, vendu en couronnes' });
ligne('embout_finition', 'POLYLISSE XT', 'DINAFLEX INOX', 'terminal', '^0391{D2}11TDF$', { notes: 'Terminal de sécurité pour flexible' });
ligne('rde', 'POLYLISSE XT', 'DINAFLEX INOX', 'raccord_autre', '^039F{D2}10FSW$', { notes: 'Raccord SW - Flex (départ rigide)' });
ligne('griffaflex', 'POLYLISSE XT', 'DINAFLEX INOX', 'raccord_autre', '^0391{D2}109DF$', { notes: 'Raccord Insert - Flex' });
ligne('kit_couronnement', 'ACCESSOIRES', 'DINAFLEX INOX', 'plaque_autre', '^0390{D2}85BSW$', { notes: 'Plaque de finition pour conduit maçonné' });
ligne('kit_couronnement', 'ACCESSOIRES', 'SW PELLETS', 'plaque_autre', '^0390{D2}85BSW$', { priorite: 200, notes: 'Plaque de finition pour conduit maçonné (Ø80/100)' });

// ── Rigide PRH → SW BOIS (Ø130+) ; repli SW PELLETS (Ø80/100) ────────────────────────────────────────────
for (const [g, p, sfx, f] of [['SW BOIS', 100, 'SW', '0390'], ['SW PELLETS', 200, 'SWJ', '039F']]) {
  ligne('chapeau_prh', 'PRH', g, 'chapeau_anti_refouleur', null, { priorite: p, notes: 'Capuchon antivent' });
  ligne('tuyau_prh_conduit', 'PRH', g, 'element_droit', `^${f}{D2}02[045]${sfx}$`, { priorite: p, notes: 'Élément droit SW (930 / 445 / 275)' });
  ligne('tuyau_prh_raccord', 'PRH', g, 'element_droit', `^${f}{D2}02[045]${sfx}$`, { priorite: p, notes: 'Élément droit SW (930 / 445 / 275)' });
  ligne('coude_90_purge_prh', 'PRH', g, 'coude_special', p === 100 ? '^0390{D2}432SW$' : '^039F{D2}431SWJ$', { priorite: p, notes: 'Coude 90° avec inspection' });
  ligne('tampon_prh', 'PRH', g, 'tampon', `^${f}{D2}061${sfx}$`, { priorite: p, notes: 'Tampon purge' });
  ligne('manchon_buse', 'PRH', g, 'raccord_femelle', null, { priorite: p, notes: 'Raccord femelle' });
}
ligne('plaque_arp', 'PRH', 'SW BOIS', 'plaque_autre', '^0390{D2}854SW$', { notes: 'Plaque de départ avec manchon' });
ligne('plaque_arp', 'PRH', 'SW PELLETS', 'plaque_autre', '^0390{D2}85BSW$', { priorite: 200, notes: 'Plaque de finition pour conduit maçonné' });

// ── Concentrique PLA → DIFLUX PELLETS (80/125, 100/150) ─────────────────────────────────────────────────
const DF = 'DIFLUX PELLETS'; const ELT_DF = '^0301{D2}02[0345]EV$';
ligne('pla_chapeau_ar', 'PLA', DF, 'terminal', '^0311{D2}010EV$', { notes: 'Terminal vertical' });
for (const c of ['pla_element_exterieur', 'pla_element_interieur', 'pla_element_raccord', 'pla_element_vertical', 'pla_element_horizontal']) ligne(c, 'PLA', DF, 'element_droit', ELT_DF, { notes: 'Élément droit DIFLUX (930 / 430 / 265)' });
ligne('pla_collier_jonction', 'PLA', DF, 'collier_jonction', null, { notes: "Collier d'union" });
ligne('solin_pla', 'PLA', DF, 'solin', null, { notes: 'Solin de toit inox en pente' });
ligne('pla_coude_devoiement', 'PLA', DF, 'coude', null);
ligne('pla_coude_90', 'PLA', DF, 'coude', '^0301{D2}433EV$', { notes: 'Coude 90°' });
ligne('pla_plaque_proprete', 'PLA', DF, 'rosace', null, { notes: 'Rosace de finition' });
ligne('support_plancher', 'PLA', DF, 'collier_mural', '^0309{D2}903EV$', { notes: 'Collier à dalle renforcé 180°' });
// Support au toit DIFLUX : la référence porte le Ø extérieur (80/125 → 12), d'où {=D}.
ligne('collier_sous_toiture', 'PLA', DF, 'collier_sous_toiture', '{=D}^0392\\d{2}824SW$', { notes: 'Support de toiture : support au toit avec profil' });
ligne('pla_couronne_coupe_feu', 'PLA', DF, 'plaque_ecart_feu_ventilee', null, { notes: "Plaque d'écart au feu ventilée" });
ligne('pla_raccord_air', 'PLA', DF, 'te_special', '^0301{D2}33GEP$', { notes: "Té 90° piquage M pour amenée d'air" });
ligne('pla_terminal_horizontal', 'PLA', DF, 'terminal', '^0301{D2}11REV$', { notes: 'Sortie horizontale courte' });
for (const c of ['pla_adapt_chapeau', 'pla_adapt_chapeau_ar']) ligne(c, 'PLA', DF, 'plaque_autre', '^0301{D2}85GEP$', { notes: 'Plaque de finition haute boisseau Flex - Diflux' });
for (const c of ['pla_adapt_bas', 'pla_adapt_bas_isole']) ligne(c, 'PLA', DF, 'plaque_autre', '^0301{D2}675EP$', { notes: 'Plaque de départ Dinaflex' });

writeFileSync(process.argv[2] || fileURLToPath(new URL('./data/dinak-mapping.json', import.meta.url)),`${JSON.stringify(L, null, 0).replace(/^\[/, '[\n  ').replace(/\},\{/g, '},\n  {').replace(/\]$/, '\n]')}\n`);
console.log(L.length, 'lignes');
