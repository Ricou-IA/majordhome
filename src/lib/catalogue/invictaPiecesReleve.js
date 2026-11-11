// src/lib/catalogue/invictaPiecesReleve.js
// Forme d'un relevé du site de pièces détachées du groupe Invicta (https://pieces-detachees.invicta-group.fr,
// API JSON /api/1.0.0, session du compte pro). Module PUR (aucun import) : ces deux fonctions sont RECOPIÉES telles
// quelles dans scripts/catalogue/dump-invicta-pieces.browser.js (la console du navigateur n'importe rien) — toute
// modification se fait ici, se teste (scripts/catalogue/invicta-pieces.test.mjs), puis se recopie.
// Spec : docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md § 5.1.

/**
 * Plus grande variante d'une image du site (photo ou vue éclatée).
 * @param {{ url?: string, fileId?: string, variants?: Array<{ url: string, fileId: string, width: number, height: number }> } | null} image
 * @returns {{ url: string, fileId: string, width: number|null, height: number|null } | null}
 */
export function plusGrandeVariante(image) {
  if (!image) return null;
  const variantes = Array.isArray(image.variants) ? image.variants.filter((v) => v && v.url) : [];
  if (!variantes.length) return image.url ? { url: image.url, fileId: image.fileId || null, width: null, height: null } : null;
  const v = variantes.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a));
  return { url: v.url, fileId: v.fileId || null, width: v.width ?? null, height: v.height ?? null };
}

/**
 * Appareil relevé, depuis `GET products/{publicId}` et `GET products/{id}/documents`.
 * @param {object} produit réponse de l'API pour l'appareil
 * @param {Array<object>} documents réponse de l'API pour ses documents
 * @param {string} categorie nom du rayon du site (« Poêles », « Granulés »…)
 * @returns {object} appareil au format du relevé
 */
export function appareilDepuisApi(produit, documents, categorie) {
  const p = produit || {};
  return {
    id: p.id, publicId: p.publicId, reference: p.reference, name: p.name, categorie,
    lifecycleStage: p.lifecycleStage ?? null,
    photo: plusGrandeVariante(p.image),
    vues_eclatees: ((p.gallery && p.gallery.explodedViews) || []).map(plusGrandeVariante).filter(Boolean),
    documents: (documents || []).map((d) => ({ id: d.id, type: d.type, label: d.label, fileKey: d.fileKey ?? null, publicFileKey: d.publicFileKey ?? null })),
    items: (p.items || []).map((it) => {
      const x = it.item || {};
      const r = x.replacementProduct;
      return {
        repere: it.reference == null ? '' : String(it.reference), quantity: it.quantity ?? 1, notes: it.notes || '',
        piece: {
          publicId: x.publicId, reference: x.reference, name: x.name, price: x.price ?? null, taxRate: x.taxRate ?? null,
          weight: x.weight ?? null, unitCode: x.unitCode ?? null, isPurchasable: x.isPurchasable !== false,
          isBundle: !!x.isBundle, isVirtualKit: !!x.isVirtualKit, onlyAvailableInBundle: !!x.onlyAvailableInBundle,
          lifecycleStage: x.lifecycleStage ?? null, stockAvailable: x.stockAvailable ?? null,
          image_url: (plusGrandeVariante(x.image) || {}).url || null,
          remplacement: r && r.reference ? { reference: r.reference, name: r.name || '' } : null,
        },
      };
    }),
  };
}

/**
 * Contrôle de complétude d'un relevé avant de l'enregistrer : chaque rayon rend autant d'appareils qu'annoncé,
 * aucun appareil n'est en erreur (session expirée, appel refusé), aucun appareil sans référence.
 * @param {{ categories?: Array<{ name: string, total: number }>, appareils?: Array<object> }} releve
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function controlerReleve(releve) {
  const erreurs = [];
  const appareils = (releve && releve.appareils) || [];
  const categories = (releve && releve.categories) || [];
  if (!categories.length) erreurs.push('Aucun rayon relevé');
  for (const c of categories) {
    const lus = appareils.filter((a) => a.categorie === c.name).length;
    if (lus !== c.total) erreurs.push(`${c.name} : ${lus} / ${c.total} appareils lus`);
  }
  for (const a of appareils) {
    if (a.erreur) erreurs.push(`${a.reference || a.publicId || 'appareil'} : ${a.erreur}`);
    else if (!a.reference) erreurs.push(`${a.publicId || 'appareil'} : sans référence`);
  }
  return { ok: erreurs.length === 0, erreurs };
}
