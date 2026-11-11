// scripts/catalogue/invicta-pieces.js
// Adaptateur PUR : relevé du site de pièces détachées du groupe Invicta (format de invictaPiecesReleve.js) →
// pièces (lignes de l'écrivain public.supplier_pieces_upsert), modèles d'appareil et nomenclature
// (public.equipment_models_upsert). Aucun import, aucune écriture. Testé sur le relevé réel
// (scripts/catalogue/invicta-pieces.test.mjs). Spec :
// docs/superpowers/specs/2026-11-11-pieces-detachees-invicta-releve-nomenclature-design.md § 5.2.
//
// Prix (Eric, 2026-11-11) : le prix HT du site est le PRIX PUBLIC (assiette) ; la remise du compte s'applique au
// panier. tarif_public = vente par défaut = prix du site ; achat = prix du site × (1 − remise).

export const CATEGORIE_PIECE = 'piece_detachee';

const centime = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const CYCLES = { OnSale: 'en_vente', Discontinued: 'arretee', UntilEndOfStock: 'fin_de_stock' };
const UNITES = { PCE: 'pièce' };

// Préfixes de type d'appareil retirés du nom du site pour obtenir le nom de modèle (du plus long au plus court).
const PREFIXES_MODELE = [
  'POELE A GRANULES', 'POELE GRANULES', 'POELE A PELLETS', 'POELE PELLETS', 'POELE PELETS', 'POELE A BOIS', 'POELE',
  'INSERT', 'FOYER', 'CUISINIERE', 'CHEMINEE',
];
const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Nom de modèle depuis le nom du site : « POELE OXANA - P601314 » → « OXANA ». La référence finale et le type
 * d'appareil en tête sont retirés ; s'il ne reste rien, le nom privé de sa référence est rendu.
 * @param {string} name nom complet du site
 * @param {string} reference référence fabricant de l'appareil
 * @returns {string}
 */
export function nomModele(name, reference) {
  let n = String(name || '').replace(/\s+/g, ' ').trim();
  const ref = String(reference || '').trim();
  if (ref) {
    const fin = new RegExp(`\\s*[-–]?\\s*${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
    n = n.replace(fin, '').trim();
  }
  const base = n;
  const maj = sansAccents(n).toUpperCase();
  for (const p of PREFIXES_MODELE) {
    if (maj === p) break;
    if (maj.startsWith(`${p} `)) { n = n.slice(p.length).trim(); break; }
  }
  n = n.replace(/^[-–\s]+/, '').trim();
  return n || base;
}

/**
 * @param {object} releve relevé au format de scripts/catalogue/dump-invicta-pieces.browser.js
 * @param {{ version: string, remisePct?: number|string|null, referencesTarif?: string[] }} opts
 *   version = version du relevé (specs.source_version) ; remisePct = remise du compte en POURCENT (30) ;
 *   referencesTarif = références déjà présentes chez le fournisseur HORS pièces détachées (elles ne sont pas
 *   réécrites : la nomenclature pointe la ligne du tarif).
 * @returns {{ pieces: object[], modeles: object[], nomenclature: object[], compteRendu: object }}
 */
export function piecesDepuisReleveInvicta(releve, opts) {
  const version = opts && opts.version;
  if (!version) throw new Error('version du relevé requise');
  const appareils = (releve && releve.appareils) || [];
  if (!appareils.length) throw new Error('relevé vide : aucun appareil');
  const marque = (releve.manufacturer && releve.manufacturer.name) || '';
  if (!marque) throw new Error('relevé sans marque (manufacturer.name)');
  const site = String(releve.source || '').replace(/\/api\/.*$/, '');

  const avertissements = [];
  let remise = Number(opts.remisePct);
  if (opts.remisePct == null || opts.remisePct === '' || !Number.isFinite(remise) || remise < 0 || remise >= 100) {
    remise = 0;
    avertissements.push('remise absente ou invalide : prix d\'achat = prix public');
  }
  const auTarif = new Set((opts.referencesTarif || []).map((r) => String(r)));

  const parRef = new Map(); // référence → pièce brute (première vue)
  // Une même référence désigne parfois plusieurs produits du site (kits composés par appareil, visserie vendue à
  // l'unité ou en lot) : 50 références sur 1 771 au relevé du 2026-11-11, avec des prix différents selon l'appareil.
  // Le prix de CHAQUE ligne de nomenclature est donc gardé (prix_public) ; la pièce du catalogue n'a de prix que
  // s'il est le même partout, sinon 0 et `prix_selon_appareil` (pas d'article, le prix se lit sur l'appareil).
  const prixVus = new Map(); // référence → Set des prix publics vus
  const dejaAuTarif = new Set();
  const modeles = [];
  const nomenclature = [];
  const refsModeles = new Set();
  const sansPieces = [];

  for (const a of appareils) {
    if (!a.reference) throw new Error(`appareil sans référence (${a.publicId || a.name || '?'})`);
    // Identité d'un appareil = son publicId du site : une même référence fabricant peut désigner deux appareils
    // (« FOYER 700 DO INVICTA » et sa version EXPORT portent tous deux P687644).
    if (!a.publicId) throw new Error(`appareil sans identifiant du site (${a.reference})`);
    if (refsModeles.has(a.publicId)) throw new Error(`appareil en double dans le relevé : ${a.reference} (${a.publicId})`);
    refsModeles.add(a.publicId);
    modeles.push({
      reference: a.reference, name: a.name, model_name: nomModele(a.name, a.reference), brand: marque,
      category: a.categorie || null, lifecycle: CYCLES[a.lifecycleStage] || (a.lifecycleStage ? String(a.lifecycleStage).toLowerCase() : null),
      photo: a.photo ? { url: a.photo.url, fileId: a.photo.fileId } : null,
      exploded_views: (a.vues_eclatees || []).map((v) => ({ url: v.url, fileId: v.fileId, width: v.width, height: v.height })),
      documents: a.documents || [],
      source: { site, publicId: a.publicId, version },
    });
    if (!(a.items || []).length) sansPieces.push(a.reference);
    (a.items || []).forEach((it, i) => {
      const p = it.piece || {};
      if (!p.reference) throw new Error(`pièce sans référence sur l'appareil ${a.reference} (repère ${it.repere})`);
      const prixLigne = p.isPurchasable !== false && p.price != null && Number(p.price) > 0 ? centime(p.price) : null;
      nomenclature.push({
        modele_source_id: a.publicId, modele_reference: a.reference, position: i + 1, repere: it.repere || '', piece_reference: p.reference,
        quantity: Number.isFinite(Number(it.quantity)) ? Number(it.quantity) : 1, notes: it.notes || '',
        prix_public: prixLigne,
      });
      if (auTarif.has(p.reference)) { dejaAuTarif.add(p.reference); return; }
      if (!parRef.has(p.reference)) { parRef.set(p.reference, p); prixVus.set(p.reference, new Set()); }
      prixVus.get(p.reference).add(prixLigne);
    });
  }

  const compte = { sans_prix: 0, prix_selon_appareil: 0, arretees: 0, remplacees: 0, kits: 0, somme: 0 };
  const pieces = [...parRef.values()].map((p) => {
    // Seuls les prix RÉELS comptent : une pièce à 12,50 € sur trente appareils et sans prix sur un autre reste à
    // 12,50 € (l'occurrence sans prix est gardée telle quelle sur sa ligne de nomenclature).
    const prix = [...prixVus.get(p.reference)].filter((x) => x != null);
    const variable = prix.length > 1;
    const vendable = prix.length === 1;
    const publicHt = vendable ? prix[0] : 0;
    const cycle = CYCLES[p.lifecycleStage] || (p.lifecycleStage ? String(p.lifecycleStage).toLowerCase() : 'en_vente');
    const kit = !!(p.isBundle || p.isVirtualKit);
    if (variable) compte.prix_selon_appareil += 1;
    else if (!vendable) compte.sans_prix += 1;
    if (cycle === 'arretee') compte.arretees += 1;
    if (p.remplacement) compte.remplacees += 1;
    if (kit) compte.kits += 1;
    compte.somme += publicHt;
    const unite = p.unitCode ? (UNITES[p.unitCode] || String(p.unitCode).toLowerCase()) : 'pièce';
    return {
      reference: p.reference, name: String(p.name || p.reference).replace(/\s+/g, ' ').trim(), brand: marque,
      category: CATEGORIE_PIECE, product_kind: 'accessory', unit: unite, default_tva_rate: 20,
      tarif_public: publicHt, taux_remise: remise,
      purchase_price_ht: centime(publicHt * (1 - remise / 100)), selling_price_ht_defaut: publicHt,
      image_url: p.image_url || null,
      specs: {
        source_version: version,
        canonical: {
          cycle_de_vie: cycle, remplacee_par: p.remplacement ? p.remplacement.reference : null, kit,
          prix_selon_appareil: variable, vendue_seule: (vendable || variable) && !p.onlyAvailableInBundle, poids_kg: p.weight ?? null, stock_releve: p.stockAvailable ?? null,
        },
      },
    };
  });

  return {
    pieces, modeles, nomenclature,
    compteRendu: {
      marque, version, appareils: modeles.length, pieces: pieces.length, lignes_nomenclature: nomenclature.length,
      appareils_sans_piece: sansPieces.length, references_sans_piece: sansPieces.sort(),
      deja_au_tarif: dejaAuTarif.size, references_deja_au_tarif: [...dejaAuTarif].sort(),
      sans_prix: compte.sans_prix, prix_selon_appareil: compte.prix_selon_appareil, arretees: compte.arretees, remplacees: compte.remplacees, kits: compte.kits,
      somme_prix_public: centime(compte.somme), remise_pct: remise, avertissements,
    },
  };
}

/**
 * Découpe modèles + nomenclature en lots pour l'import, sans jamais couper un modèle en deux.
 * @param {object[]} modeles
 * @param {object[]} nomenclature
 * @param {number} tailleMax nombre de modèles par lot
 * @returns {Array<{ modeles: object[], parts: object[] }>}
 */
export function lotsParModele(modeles, nomenclature, tailleMax) {
  const taille = Math.max(1, Math.floor(tailleMax) || 1);
  const parModele = new Map();
  for (const l of nomenclature) {
    if (!parModele.has(l.modele_source_id)) parModele.set(l.modele_source_id, []);
    parModele.get(l.modele_source_id).push(l);
  }
  const lots = [];
  for (let i = 0; i < modeles.length; i += taille) {
    const tranche = modeles.slice(i, i + taille);
    lots.push({ modeles: tranche, parts: tranche.flatMap((m) => parModele.get(m.source.publicId) || []) });
  }
  return lots;
}
