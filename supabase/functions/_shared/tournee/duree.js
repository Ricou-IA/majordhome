// ⚠️ COPIE GÉNÉRÉE par scripts/sync-tournee-engine.mjs depuis src/lib/tournee/duree.js — ne pas éditer.
// src/lib/tournee/duree.js
// ============================================================================
// Durée d'intervention d'un entretien. Module PUR (aucun import) — exécutable
// par Node, Vite et Deno. Testé : node --test scripts/tournee/duree.test.mjs
//
// La durée suit exactement la même mécanique que le PRIX (base + unités
// au-delà de `included_units`), sur les mêmes colonnes de
// `majordhome.pricing_equipment_types`. Une seule source de vérité par type.
// ============================================================================

/**
 * Durée d'un équipement. `type` peut être absent (équipement non typé) ou sans
 * durée renseignée : on retombe alors sur `fallbackMinutes`, jamais sur 0 —
 * une durée nulle ferait déborder la journée en silence.
 *
 * @param {{ unit_count?: number }} equipement
 * @param {{ duration_base_minutes?: number, duration_per_extra_unit_minutes?: number, included_units?: number }|null} type
 * @param {number} fallbackMinutes
 * @returns {number} minutes
 */
export function dureeEquipement(equipement, type, fallbackMinutes) {
  const base = type?.duration_base_minutes;
  if (base == null) return fallbackMinutes;
  const perUnit = type.duration_per_extra_unit_minutes || 0;
  const included = type.included_units ?? 1;
  const count = equipement?.unit_count || 1;
  return base + Math.max(0, count - included) * perUnit;
}

/**
 * Durée totale d'un contrat = somme de ses équipements, moins le gain
 * « plusieurs équipements chez le même client » (`gainMultiPct`, réglage
 * `gain_multi_equipements_pct`) dès 2 lignes d'équipement. Une seule ligne
 * à `unit_count` > 1 n'est pas « multi » : son barème porte déjà le tarif
 * dégressif par unité supplémentaire.
 *
 * @param {Array<{ equipment_type_id?: string|null, category_id?: string|null, unit_count?: number }>} equipements
 * @param {Map} typesById
 * @param {{ parCategorie: Record<string, number>, defaut: number }} fallbacks  clés = category_id (uuid du référentiel)
 * @param {{ gainMultiPct?: number }} [opts]
 * @returns {number} minutes
 */
export function dureeContrat(equipements, typesById, fallbacks, { gainMultiPct = 0 } = {}) {
  const lignes = equipements || [];
  const brut = lignes.reduce((total, eq) => {
    const type = eq.equipment_type_id ? typesById.get(eq.equipment_type_id) : null;
    const fallback = fallbacks?.parCategorie?.[eq.category_id] ?? fallbacks?.defaut ?? 0;
    return total + dureeEquipement(eq, type, fallback);
  }, 0);
  if (lignes.length >= 2 && gainMultiPct > 0) return Math.round(brut * (1 - gainMultiPct / 100));
  return brut;
}

/**
 * Fallback par catégorie = durée du type DOMINANT (le plus fréquent) de cette
 * catégorie dans le parc réel. Un fallback uniforme sous-estimerait les
 * chaudières bois d'une heure et ferait déborder leur journée.
 * Les catégories sans aucun équipement typé restent absentes -> `defaut`.
 * Clé = `category_id` (uuid de majordhome.equipment_categories), plus le code enum.
 *
 * @param {Array} parc  tous les équipements connus (typés ou non)
 * @param {Map} typesById
 * @param {number} defautMinutes
 * @returns {{ parCategorie: Record<string, number>, defaut: number }}
 */
export function construireFallbacks(parc, typesById, defautMinutes = 90) {
  const comptes = new Map(); // category_id -> Map(typeId -> n)
  for (const eq of parc || []) {
    if (!eq.equipment_type_id || !eq.category_id) continue;
    if (!comptes.has(eq.category_id)) comptes.set(eq.category_id, new Map());
    const parType = comptes.get(eq.category_id);
    parType.set(eq.equipment_type_id, (parType.get(eq.equipment_type_id) || 0) + 1);
  }

  const parCategorie = {};
  for (const [category, parType] of comptes) {
    let dominantId = null;
    let meilleur = -1;
    // Tri par id à égalité de compte : rend le résultat déterministe.
    for (const id of [...parType.keys()].sort()) {
      const n = parType.get(id);
      if (n > meilleur) {
        meilleur = n;
        dominantId = id;
      }
    }
    const duree = typesById.get(dominantId)?.duration_base_minutes;
    if (duree != null) parCategorie[category] = duree;
  }

  return { parCategorie, defaut: defautMinutes };
}
