// src/apps/artisan/components/devis/metre/metreModel.js
// Helpers PURS de l'écran de métré (hors composants, pour le fast refresh) : critères de
// qualification, filtrage des configurations, relevé initial, conversion en lignes de devis.

export const CRITERES = {
  projet: [['creation_interieur', 'Création de conduit intérieur'], ['creation_exterieur', 'Création de conduit extérieur'], ['tubage', 'Tubage d\'un conduit existant'], ['raccordement', 'Raccordement seul']],
  appareil: [['poele_cuisiniere', 'Poêle ou cuisinière'], ['foyer_insert', 'Foyer ou insert'], ['chaudiere', 'Chaudière']],
  combustible: [['bois_buches', 'Bois bûches'], ['pellets', 'Pellets / granulés']],
  zone: [['zone_1', 'Zone 1 (au-dessus du faîtage)'], ['zone_2', 'Zone 2 (entre gouttière et faîtage)'], ['zone_3', 'Zone 3 (façade / ventouse)']],
  prise_air: [['dans_piece', 'Air pris dans la pièce'], ['dans_conduit', 'Air pris dans le conduit (appareil étanche)']],
};

/** Configurations compatibles avec les critères (un critère vide = pas de filtre). */
export function filtrerConfigurations(configurations, q) {
  return configurations.filter((c) =>
    (!q.projet || c.projets.includes(q.projet))
    && (!q.appareil || c.appareils.includes(q.appareil))
    && (!q.combustible || c.combustibles.includes(q.combustible))
    && (!q.zone || c.zones.length === 0 || c.zones.includes(q.zone))
    && (!q.prise_air || c.prise_air.includes(q.prise_air)));
}

/** Relevé initial : défauts du gabarit, finition = défaut d'org. */
export function releveInitial(gabarit, reglages) {
  const r = {};
  for (const t of gabarit.troncons) for (const p of t.parametres) r[p.cle] = p.defaut ?? null;
  r.finition = reglages.finition_defaut;
  return r;
}

/**
 * Lignes de devis (shape de DevisStepLines) depuis les lignes du moteur. Une ligne sans article
 * est injectée à 0 € avec « À CHIFFRER » dans la description — jamais écartée.
 */
export function versLignesDevis(lignes, supplierId, supplierName) {
  return lignes.map((l) => ({
    line_type: 'product', supplier_product_id: l.article_id, supplier_id: l.article_id ? supplierId : null, supplier_name: l.article_id ? supplierName : null,
    designation: l.libelle, description: [`Rep. ${l.repere}`, l.sous_libelle, l.statut === 'provisoire' ? 'quantité provisoire' : null, l.article_id ? null : 'À CHIFFRER'].filter(Boolean).join(' · '),
    reference: l.reference || '', quantity: l.quantite, unit: l.unite || 'pièce',
    purchase_price_ht: l.prix_achat_ht, unit_price_ht: l.prix_vente_ht ?? 0, tva_rate: l.tva,
  }));
}
