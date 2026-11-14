// scripts/catalogue/esc-pieces.js
// Adaptateur PUR (aucune E/S) : relevé des rayons de pièces détachées d'ESC Grossiste (produit par
// releve-esc-pieces.py) → lignes lues par `public.supplier_pieces_upsert`, de la MÊME forme que celles de
// src/lib/catalogue/woocommercePieces.js (la vue majordhome_pieces_catalogue les lit sans distinction).
// Testé sur le relevé réel (scripts/catalogue/esc-pieces.test.mjs). Module de script seulement (comme ecostal-tarif.js).
//
// Ce que donnent les listes du site : nom, marque, prix public TTC, photo, adresse de la fiche, rayons. Ni stock, ni
// référence fabricant (elle est parfois écrite dans le nom). Choix faits ici :
//   - référence fournisseur = « ESC- » + identifiant du produit sur le site (stable, unique) ;
//   - prix public HT = TTC ÷ 1,2 ; achat = public HT × (1 − remise) ; vente par défaut = public HT ;
//   - une pièce n'est retenue que si elle est rangée sous un rayon AUTRE que la racine (la racine mêle piscine et spa) ;
//   - rayons = noms des rayons de la pièce et de leurs parents, racine exclue : la marque et le MODÈLE de l'appareil
//     y sont écrits (« FERROLI BLUEHELIX 25K50 Pièces »), c'est ce que lit « cité pour ce modèle ».

const TVA_PCT = 20;
const CATEGORIE_PIECE = 'piece_detachee';

/** Préfixe de la référence fournisseur. */
export const PREFIXE_REFERENCE = 'ESC-';

/**
 * Division entière arrondie à la demi-unité supérieure (entiers positifs : exact, sans virgule flottante).
 * @param {number} numerateur
 * @param {number} denominateur
 * @returns {number}
 */
function arrondiDemi(numerateur, denominateur) {
  return Math.floor((2 * numerateur + denominateur) / (2 * denominateur));
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function propre(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Remise du fournisseur en pourcent : valeur finie dans ]0 ; 100[, sinon 0.
 * @param {unknown} valeur
 * @returns {number}
 */
function remiseValide(valeur) {
  const r = Number(valeur);
  return Number.isFinite(r) && r > 0 && r < 100 ? r : 0;
}

/**
 * Le relevé est-il complet ? Chaque rayon doit avoir autant de fiches lues qu'annoncé par le site.
 * @param {{ rayons?: Array<{ id: string, annonce?: number|null, lues?: number }>, pieces?: unknown[], fetched_at?: string }|null|undefined} releve
 * @returns {{ ok: boolean, erreurs: string[] }}
 */
export function controlerReleveEsc(releve) {
  const erreurs = [];
  const rayons = Array.isArray(releve && releve.rayons) ? releve.rayons : [];
  const pieces = Array.isArray(releve && releve.pieces) ? releve.pieces : [];
  if (!releve || !releve.fetched_at) erreurs.push('date du relevé absente');
  if (!rayons.length) erreurs.push('aucun rayon');
  if (!pieces.length) erreurs.push('aucune pièce');
  for (const r of rayons) {
    if (r.annonce != null && r.annonce !== r.lues) erreurs.push(`rayon ${r.id} : ${r.lues} fiche(s) lue(s) pour ${r.annonce} annoncée(s)`);
  }
  return { ok: erreurs.length === 0, erreurs };
}

/**
 * Lignes de catalogue de pièces depuis un relevé ESC Grossiste COMPLET.
 * Chaque fiche écartée est comptée dans UN SEUL compteur, testé dans l'ordre : hors_perimetre (rangée seulement à la
 * racine), sans_prix.
 * @param {{ fetched_at: string, racine: string, rayons: Array<{ id: string, nom: string, parent: string|null }>, pieces: Array<{ id: string, url: string, nom: string, marque: string, prix_ttc: number|null, image: string|null, rayons: string[] }> }} releve
 * @param {{ version: string, remisePct?: number|string|null }} options version = specs.source_version ; remisePct en POURCENT (0 par défaut)
 * @returns {{ lignes: Array<Record<string, any>>, compte: { retenues: number, hors_perimetre: number, sans_prix: number }, rayons: string[] }}
 * @throws {Error} `releve_incomplet` ; `reference_en_double`
 */
export function piecesDepuisReleveEsc(releve, { version, remisePct = 0 }) {
  if (!version) throw new Error('version du relevé requise');
  const controle = controlerReleveEsc(releve);
  if (!controle.ok) throw new Error(`releve_incomplet: ${controle.erreurs.slice(0, 5).join(' ; ')}`);
  const remise = remiseValide(remisePct);
  const racine = String(releve.racine);
  const parId = new Map(releve.rayons.map((r) => [String(r.id), r]));

  /**
   * Noms du rayon et de ses parents, du plus haut au plus bas, racine exclue.
   * @param {string} id
   * @returns {string[]}
   */
  const chemin = (id) => {
    const noms = [];
    let courant = parId.get(String(id));
    for (let garde = 0; courant && garde < 12; garde += 1) {
      if (String(courant.id) !== racine) noms.unshift(propre(courant.nom));
      courant = courant.parent == null ? undefined : parId.get(String(courant.parent));
    }
    return noms.filter(Boolean);
  };

  const compte = { retenues: 0, hors_perimetre: 0, sans_prix: 0 };
  /** @type {Array<Record<string, any>>} */
  const lignes = [];
  const vus = new Set();
  /** @type {Set<string>} */
  const rayonsVus = new Set();
  for (const piece of releve.pieces) {
    /** @type {string[]} */
    const rayons = [];
    for (const id of piece.rayons || []) {
      if (String(id) === racine) continue;
      for (const nom of chemin(id)) if (!rayons.includes(nom)) rayons.push(nom);
    }
    if (!rayons.length) { compte.hors_perimetre += 1; continue; }
    const ttc = Number.isFinite(piece.prix_ttc) && piece.prix_ttc > 0 ? Math.round(piece.prix_ttc * 100) : null;
    if (ttc == null) { compte.sans_prix += 1; continue; }
    const reference = `${PREFIXE_REFERENCE}${piece.id}`;
    if (vus.has(reference)) throw new Error(`reference_en_double: ${reference}`);
    vus.add(reference);
    for (const r of rayons) rayonsVus.add(r);
    const htCentimes = arrondiDemi(ttc * 100, 100 + TVA_PCT);
    const achatCentimes = arrondiDemi(htCentimes * (10000 - Math.round(remise * 100)), 10000);
    const fiche = propre(piece.url) || null;
    lignes.push({
      reference,
      name: propre(piece.nom) || reference,
      brand: propre(piece.marque).toUpperCase() || 'DIVERS',
      category: CATEGORIE_PIECE,
      product_kind: 'accessory',
      unit: 'pièce',
      default_tva_rate: TVA_PCT,
      tarif_public: htCentimes / 100,
      taux_remise: remise,
      purchase_price_ht: achatCentimes / 100,
      selling_price_ht_defaut: htCentimes / 100,
      image_url: propre(piece.image) || null,
      image_source_url: fiche,
      specs: {
        source_version: version,
        canonical: {
          catalogue_pieces: true,
          fiche_produit: fiche,
          rayons,
          prix_public_ttc: ttc / 100,
          // le stock n'est pas dans les listes du site : seule la date du relevé est rangée (« stock non communiqué »)
          stock_releve: { at: releve.fetched_at },
        },
      },
    });
  }
  if (!lignes.length) throw new Error('releve_incomplet: aucune pièce retenue');
  compte.retenues = lignes.length;
  return { lignes, compte, rayons: [...rayonsVus] };
}
