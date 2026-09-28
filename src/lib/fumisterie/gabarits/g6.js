// Gabarit G6 — sortie horizontale en façade (ventouse, zone 3, CFG-29 PLA concentrique). Géométrie PURE,
// règles PROVISOIRES : montée verticale de la buse au coude, tronçon horizontal jusqu'au mur, traversée
// et terminal horizontal. Les conditions de zone 3 (catalogue p.80-89) ne sont PAS vérifiées : l'écran le dit.
import { composer } from '../compose.js';

/**
 * @param {{diametre:number, hBuse:number, hSortie:number, lHoriz:number, epMur:number}} r relevé
 * @param {ReturnType<import('../config.js').buildFumisterieConfig>} cfg
 */
export function geometrieG6(r, cfg) {
  const yCoude = Number(r.hSortie);
  const Lv = Math.max(0, yCoude - Number(r.hBuse));
  const Lh = Math.max(0, Number(r.lHoriz));
  const Ltrav = Number(r.epMur);
  const base = { longueurs: cfg.longueurs_elements_mm, reglable: cfg.reglable, avecReglable: false };
  const troncons = {
    vertical: { longueur_mm: Math.round(Lv * 1000), composition: composer(Lv * 1000, base) },
    horizontal: { longueur_mm: Math.round(Lh * 1000), composition: composer(Lh * 1000, base) },
    traversee_mur: { longueur_mm: Math.round(Ltrav * 1000), composition: null },
  };
  return { yCoude, Lv, Lh, Ltrav, troncons };
}
