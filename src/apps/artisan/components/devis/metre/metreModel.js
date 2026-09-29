// src/apps/artisan/components/devis/metre/metreModel.js
// Helpers PURS de l'écran de métré (hors composants, pour le fast refresh) : critères de
// qualification, filtrage des configurations, relevé initial, conversion en lignes de devis.
import { calculerMetre } from '@/lib/fumisterie/index.js';

/**
 * calculerMetre sans jamais planter l'écran : une exception du moteur devient un résultat
 * vide portant `erreur` + une alerte visible (l'injection est alors refusée).
 */
export function calculerMetreSurEcran(params) {
  try { return calculerMetre(params); }
  catch (e) { return { erreur: e.message, lignes: [], alertes: [{ niveau: 'warn', code: 'moteur', message: e.message, source: 'moteur' }], totaux: { vente_ht: 0, achat_ht: 0, marge_ht: 0, lignes_a_chiffrer: 0 }, geometrie: null }; }
}

export const CRITERES = {
  projet: [['creation_interieur', 'Création de conduit intérieur'], ['creation_exterieur', 'Création de conduit extérieur'], ['tubage', 'Tubage d\'un conduit existant'], ['raccordement', 'Raccordement seul']],
  appareil: [['poele_cuisiniere', 'Poêle ou cuisinière'], ['foyer_insert', 'Foyer ou insert'], ['chaudiere', 'Chaudière']],
  combustible: [['bois_buches', 'Bois bûches'], ['pellets', 'Pellets / granulés']],
  zone: [['zone_1', 'Zone 1 (au-dessus du faîtage)'], ['zone_2', 'Zone 2 (entre gouttière et faîtage)'], ['zone_3', 'Zone 3 (façade / ventouse)']],
  prise_air: [['dans_piece', 'Air pris dans la pièce'], ['dans_conduit', 'Air pris dans le conduit (appareil étanche)']],
};

export const CRITERES_VIDES = { projet: null, appareil: null, combustible: null, zone: null, prise_air: null };

/** La question de l'écran de qualification : [code, titre, sous-titre]. */
export const PROJETS = [
  ['creation_interieur', 'Créer un conduit dans la maison', 'Neuf, à travers les planchers et la toiture'],
  ['creation_exterieur', 'Créer un conduit en façade', 'Neuf, le long du mur extérieur'],
  ['tubage', 'Tuber un conduit existant', 'Boisseau maçonné ou conduit isolé en place'],
  ['raccordement', 'Raccorder seulement', 'Le conduit existant est conforme'],
];

/** Libellés courts, en français métier, des configurations du catalogue (titre catalogue en sous-titre). */
export const LIBELLES_COURTS = {
  'CFG-24': 'Conduit isolé PTR30 neuf, à travers la maison',
  'CFG-25': 'Conduit isolé PTR neuf, le long de la façade',
  'CFG-26': 'Flexible POLYLISSE dans le conduit existant (bois)',
  'CFG-27': 'Tubage rigide PRH / ATRINOX (bois)',
  'CFG-28': 'Conduit concentrique PLA neuf (appareil étanche)',
  'CFG-29': 'Sortie ventouse en façade PLA (appareil étanche)',
  'CFG-30': 'Kit rénovation PLA dans un boisseau maçonné (appareil étanche)',
  'CFG-31': 'Kit rénovation PLA dans un conduit isolé existant (appareil étanche)',
  'CFG-32': 'Conduit isolé PTR neuf avec souche Polytoit',
  'CFG-33': 'PLA à l\'intérieur + PTR en façade (appareil étanche)',
  'CFG-34': 'Flexible POLYLISSE dans le conduit existant (pellets)',
  'CFG-35': 'Tubage rigide PRH (pellets)',
  'CFG-37': 'Gaine isolée POLYPERF (conduit maçonné conforme DTU 24.1)',
  'CFG-39': 'Gaine isolée POLYPERF (épaisseur du conduit non vérifiable)',
  'CFG-40': 'Conduit multi-flux MFI (appareil étanche, fiche appareil requise)',
  'CFG-42': 'Foyer raccordé par les combles, souche Polytoit',
  'CFG-43': 'Foyer raccordé au flexible POLYLISSE',
  'CFG-45': 'Tuyau simple paroi émaillé ou acier peint',
  'CFG-48': 'Conduit PLA pour chaudière à pellets étanche',
};

/**
 * Critères déduits de la famille d'installation choisie à l'étape 1 du devis (QUOTE_TEMPLATE_FAMILIES) :
 * on ne redemande pas ce que le devis sait déjà. Famille inconnue ⇒ rien de pré-rempli.
 */
export function criteresDepuisFamille(family) {
  const parFamille = {
    'Poêle à Granulé': { appareil: 'poele_cuisiniere', combustible: 'pellets' },
    'Poêle à Bois': { appareil: 'poele_cuisiniere', combustible: 'bois_buches' },
  };
  return { ...CRITERES_VIDES, ...(parFamille[family] || {}) };
}

/** Configurations compatibles avec les critères (un critère vide = pas de filtre). */
export function filtrerConfigurations(configurations, q) {
  return configurations.filter((c) =>
    (!q.projet || c.projets.includes(q.projet))
    && (!q.appareil || c.appareils.includes(q.appareil))
    && (!q.combustible || c.combustibles.includes(q.combustible))
    && (!q.zone || c.zones.length === 0 || c.zones.includes(q.zone))
    && (!q.prise_air || c.prise_air.includes(q.prise_air)));
}

/**
 * Relevé initial : défauts du gabarit, finition = défaut d'org, et le diamètre qui dépend du
 * combustible (recette 2026-09-29 : un poêle à granulés démarrait en Ø150) : pellets → Ø80.
 * Le tuyau reste « émaillé 1,2 mm » (Mayer pose du 1,2 mm ; en Ø80/100 c'est la gamme pellets standard).
 */
export function releveInitial(gabarit, reglages, criteres = null) {
  const r = {};
  for (const t of gabarit.troncons) for (const p of t.parametres) r[p.cle] = p.defaut ?? null;
  const param = (cle) => gabarit.troncons.flatMap((t) => t.parametres).find((p) => p.cle === cle);
  if (criteres?.combustible === 'pellets' && param('diametre')?.choix?.includes(80)) r.diametre = 80;
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
