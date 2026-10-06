// src/lib/clim/config.js
// Défauts org du dimensionnement de climatisation — module PUR (aucun import). Valeurs org :
// core.organizations.settings.clim (Settings → Socle → Climatisation). ⚠ org_update_settings merge
// niveau 1 → toujours sauver l'objet `clim` COMPLET. Sources des valeurs : spec
// docs/superpowers/specs/2026-10-06-dimensionnement-clim-design.md §2 ; « provisoire » = à
// confirmer à l'usage. Copié tel quel par le site Mayer : ne rien importer ici.

/** @type {{
 *   base_w_m2: number,
 *   hauteur_reference_m: number,
 *   w_m2_par_isolation: Record<string, number>,
 *   exposition_majoration: Record<string, number>,
 *   vitrage_w_m2_par_exposition: Record<string, number>,
 *   facteur_protection_solaire: number,
 *   occupants_inclus: number,
 *   w_par_occupant_supplementaire: number,
 *   sous_toiture_majoration: number,
 *   zone_majoration: number,
 *   marge_securite: number,
 *   tolerance_sous: number,
 *   tolerance_sur: number,
 *   btu_par_m3: number,
 *   btu_par_paroi_vitree: number,
 *   multi: { ratio_max_ui_ge: number },
 *   liaison_paliers: Array<{ max_kw: number, liquide: string, gaz: string }>,
 *   longueur_liaison_defaut_m: number,
 *   gamme_defaut: string,
 * }}
 */
export const DEFAULTS_CLIM = Object.freeze({
  base_w_m2: 100,                       // W/m² à 2,50 m, isolation standard (travaux.com)
  hauteur_reference_m: 2.5,
  // W/m² par classe d'isolation (clés = CLASSES_ISOLATION de dimensionnement.js). Les 120-130 W/m² des
  // guides visent « ancienne peu isolée OU très exposée » : l'exposition étant comptée à part, on garde
  // 115 pour l'ancien isolé en partie et 130 pour le non isolé (calibré 2026-10-06 : salon 60 m² de 1985
  // plein sud = 7,6 kW, là où les guides recommandent 7,5 kW).
  w_m2_par_isolation: Object.freeze({ bbc: 70, rt2012: 80, standard: 100, ancien: 115, non_isole: 130 }),
  // Majoration selon l'exposition dominante de la pièce (sud / ouest +10 à 15 % selon les guides : on prend
  // le bas de fourchette, l'apport des baies vitrées étant compté à part ; nord −10 %)
  exposition_majoration: Object.freeze({ nord: -0.10, est: 0, ouest: 0.05, sud: 0.10 }),
  // Apport par m² de vitrage NON protégé (150 W/m² plein sud : travaux.com ; déclinaison provisoire)
  vitrage_w_m2_par_exposition: Object.freeze({ nord: 30, est: 90, ouest: 130, sud: 150 }),
  facteur_protection_solaire: 0.5,      // volets / stores extérieurs : apport vitrage divisé par 2 (provisoire)
  occupants_inclus: 2,                  // la base couvre 2 personnes
  w_par_occupant_supplementaire: 100,   // travaux.com (80-120 W)
  sous_toiture_majoration: 0.10,        // dernier étage sous toiture / combles aménagés (provisoire)
  zone_majoration: 0,                   // climat de l'org : les W/m² des guides valent déjà pour un été chaud ; à réserver à un cas hors norme
  marge_securite: 0,                    // marge globale ajoutée au besoin (0 : le surdimensionnement est l'erreur type)
  tolerance_sous: 0.05,                 // une unité à 95 % du besoin reste acceptable (évite le saut de palier)
  tolerance_sur: 0.30,                  // au-delà de +30 % : alerte surdimensionnement (cycles courts)
  btu_par_m3: 100,                      // contrôle croisé volume (hellowatt)
  btu_par_paroi_vitree: 1000,
  multi: Object.freeze({ ratio_max_ui_ge: 1.30 }), // Σ kW UI ≤ 130 % du nominal froid du groupe (provisoire)
  // Diamètres de liaison par puissance d'unité intérieure (provisoire, usage installateur)
  liaison_paliers: Object.freeze([
    Object.freeze({ max_kw: 3.5, liquide: '1/4', gaz: '3/8' }),
    Object.freeze({ max_kw: 6.0, liquide: '1/4', gaz: '1/2' }),
    Object.freeze({ max_kw: 99, liquide: '3/8', gaz: '5/8' }),
  ]),
  longueur_liaison_defaut_m: 5,
  gamme_defaut: 'airHome 400',          // gamme proposée par défaut (doit exister dans le catalogue)
});

const estObjet = (v) => v != null && typeof v === 'object' && !Array.isArray(v);

/**
 * Config Climatisation effective d'une org : défauts + surcharge `settings.clim`.
 * Merge niveau 2 pour les objets (`w_m2_par_isolation`, `exposition_majoration`,
 * `vitrage_w_m2_par_exposition`, `multi`), tableaux remplacés s'ils sont valides.
 * @param {{ clim?: object } | null | undefined} settings `core.organizations.settings`
 * @returns {typeof DEFAULTS_CLIM}
 */
export function buildClimConfig(settings) {
  const s = estObjet(settings?.clim) ? settings.clim : {};
  const out = { ...DEFAULTS_CLIM, ...s };
  for (const k of ['w_m2_par_isolation', 'exposition_majoration', 'vitrage_w_m2_par_exposition', 'multi']) {
    out[k] = { ...DEFAULTS_CLIM[k], ...(estObjet(s[k]) ? s[k] : {}) };
  }
  const paliers = Array.isArray(s.liaison_paliers) && s.liaison_paliers.length
    ? s.liaison_paliers.filter((p) => estObjet(p) && Number.isFinite(Number(p.max_kw)) && p.liquide && p.gaz)
    : [];
  out.liaison_paliers = (paliers.length ? paliers : [...DEFAULTS_CLIM.liaison_paliers])
    .map((p) => ({ max_kw: Number(p.max_kw), liquide: String(p.liquide), gaz: String(p.gaz) }))
    .sort((a, b) => a.max_kw - b.max_kw);
  return out;
}
