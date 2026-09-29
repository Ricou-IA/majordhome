// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/tournee/etiquetage.js — ne pas éditer.
// ============================================================================
// Étiquetage des journées VIDES par grand secteur — module PUR (auto-RDV,
// spec 2026-09-29 § 4.1 étape 3). Une journée est disponible par nature : la
// machine ne fait qu'y poser une étiquette « ce jour, ce technicien, ce
// secteur », au besoin — jamais tout le mois d'un coup (dispersion) — et une
// de plus dès qu'un secteur approche du plein (`secteursAReouvrir`).
// ============================================================================

/**
 * Besoin en journées par secteur, capacité existante déduite.
 *
 * @param {{ dusParSecteur: Map<string, number>, journeesAmorcees?: Array<{ secteur: string, chargeMinutes: number, budgetMinutes: number }>,
 *   etiquettesVides?: Array<{ secteur: string }>, reglages: { auto_rdv: { capacite_cible: number, marge_pct: number, duree_moyenne_minutes: number } } }} p
 *   `journeesAmorcees` = journées qui portent déjà des entretiens (secteur déduit) ; `etiquettesVides` = journées vides déjà étiquetées.
 * @returns {Map<string, number>}  journées à OUVRIR par secteur (≥ 0)
 */
export function besoinParSecteur({ dusParSecteur, journeesAmorcees = [], etiquettesVides = [], reglages }) {
  const cfg = reglages?.auto_rdv || {};
  const cible = Math.max(1, Number(cfg.capacite_cible) || 4);
  const marge = Math.max(0, Number(cfg.marge_pct) || 0);
  const dureeMoy = Math.max(15, Number(cfg.duree_moyenne_minutes) || 90);
  const places = new Map();
  for (const j of journeesAmorcees) {
    const reste = Math.max(0, (j.budgetMinutes || 0) - (j.chargeMinutes || 0));
    places.set(j.secteur, (places.get(j.secteur) || 0) + Math.floor(reste / dureeMoy));
  }
  for (const e of etiquettesVides) {
    places.set(e.secteur, (places.get(e.secteur) || 0) + cible);
  }
  const besoin = new Map();
  for (const [secteur, dus] of dusParSecteur || []) {
    const contratsAPlacer = Math.ceil((dus || 0) * (1 + marge / 100)) - (places.get(secteur) || 0);
    besoin.set(secteur, Math.max(0, Math.ceil(Math.max(0, contratsAPlacer) / cible)));
  }
  return besoin;
}

/**
 * Journées vides à étiqueter : les plus proches dans les bornes d'abord, en
 * alternant les techniciens (à une même date, un technicien après l'autre),
 * secteur le plus demandeur servi en premier, jamais au-delà du besoin.
 *
 * @param {{ journeesVides: Array<{ date: string, technicienId: string }>, besoin: Map<string, number>, bornes: { debut: string, fin: string } }} p
 * @returns {Array<{ date: string, technicienId: string, secteur: string }>}
 */
export function journeesAEtiqueter({ journeesVides, besoin, bornes }) {
  const candidates = (journeesVides || [])
    .filter((j) => j.date >= bornes.debut && j.date <= bornes.fin)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.technicienId).localeCompare(String(b.technicienId))));
  const file = [...(besoin || [])].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
  const out = [];
  let rang = 0;
  for (const j of candidates) {
    if (file.length === 0) break;
    const [secteur, n] = file[rang % file.length];
    out.push({ date: j.date, technicienId: j.technicienId, secteur });
    if (n - 1 <= 0) file.splice(rang % file.length, 1);
    else file[rang % file.length] = [secteur, n - 1];
    rang += 1;
  }
  return out;
}

/**
 * Secteurs dont TOUTES les journées étiquetées sont remplies à `seuil_reouverture_pct`
 * au moins : le mode « relances » leur ouvre une journée vide de plus.
 *
 * @param {{ journeesEtiquetees: Array<{ secteur: string, chargeMinutes: number, budgetMinutes: number }>, reglages: { auto_rdv: { seuil_reouverture_pct: number } } }} p
 * @returns {string[]}
 */
export function secteursAReouvrir({ journeesEtiquetees, reglages }) {
  const seuil = Math.max(0, Number(reglages?.auto_rdv?.seuil_reouverture_pct) || 75) / 100;
  const parSecteur = new Map();
  for (const j of journeesEtiquetees || []) {
    if (!j.secteur) continue;
    const taux = (j.budgetMinutes || 0) > 0 ? (j.chargeMinutes || 0) / j.budgetMinutes : 1;
    const cur = parSecteur.get(j.secteur) || { n: 0, pleines: 0 };
    cur.n += 1;
    if (taux >= seuil) cur.pleines += 1;
    parSecteur.set(j.secteur, cur);
  }
  return [...parSecteur.entries()].filter(([, v]) => v.n > 0 && v.pleines === v.n).map(([s]) => s).sort((a, b) => a.localeCompare(b, 'fr'));
}
