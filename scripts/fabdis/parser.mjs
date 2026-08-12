/**
 * scripts/fabdis/parser.mjs — Parser FAB-DIS (module PUR)
 * ============================================================================
 * Traduit les onglets d'un fichier FAB-DIS fabricant en enregistrements
 * canoniques prets a etre inseres dans le schema `catalog`.
 *
 * Onglets couverts, NOMMES SELON LA NORME FAB-DIS 3.0 :
 *   B01_COMMERCE       identite, libelles, prix public, unite de vente
 *   B03_MEDIA          visuels, fiches techniques, notices, certificats
 *   C04_ETIM           classe ETIM et couples caracteristique/valeur
 *   C02_CORRESPONDANCE accessoires, compatibilites, produits complementaires
 *   C06_SUBSTITUTION   produits de remplacement
 *
 * ⚠️ ECART AVEC LE CAHIER DES CHARGES — verifie sur la norme le 2026-08-12 :
 * le document designe le media par « B04_MEDIA » et l'ETIM par « B05_ETIM ».
 * Or en FAB-DIS 3.0 le media est en B03, l'ETIM en C04, et B04 est l'onglet
 * REGLEMENTAIRE. Suivre le document aurait fait lire des donnees
 * reglementaires comme des medias. Les intitules du document restent acceptes
 * comme alias, mais les codes NUS ambigus sont refuses.
 *
 * Onglets de la norme non exploites a ce jour : B00_CARTOUCHE, B02_LOGISTIQUE,
 * B04_REGLEMENTAIRE, C01_EXTENSION, C03_VARIANTE, C05_ARRET, F01_PYRAMIDE.
 *
 * ⚠️ POURQUOI UN MAPPING PAR ALIAS, ET PAS DES NOMS DE COLONNES EN DUR
 * -------------------------------------------------------------------
 * Les intitules exacts varient d'un fabricant a l'autre (accents, casse,
 * abreviations, colonnes optionnelles absentes). Un parser qui exige des noms
 * figes casse sur le premier fichier reel. Chaque champ declare donc une liste
 * d'alias, et `parseSheet()` retourne les colonnes qu'il n'a PAS su relier :
 * une colonne inconnue est signalee, jamais avalee en silence.
 *
 * Completer ALIASES quand un vrai fichier fabricant est disponible est le
 * geste d'adaptation prevu — pas une reecriture.
 *
 * Module pur : aucune I/O, aucun acces reseau ou base. Teste par
 * `node --test scripts/fabdis.test.mjs`.
 * ============================================================================
 */

import { createHash } from 'node:crypto';

// ----------------------------------------------------------------------------
// NORMALISATION
// ----------------------------------------------------------------------------

/**
 * Normalise un intitule de colonne pour le rapprochement :
 * minuscules, sans accents, sans ponctuation, espaces reduits.
 * « Prix public HT (€) » → « prix public ht »
 * @param {unknown} raw
 * @returns {string}
 */
export function normalizeHeader(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Convertit une cellule en nombre. Gere les formats FR (« 1 234,56 »),
 * les symboles monetaires et les cellules vides.
 * @param {unknown} raw
 * @returns {number|null} null si non convertible
 */
export function toNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const cleaned = String(raw)
    .replace(/[^\d,.\-]/g, '')
    .replace(/\.(?=\d{3}\b)/g, '')
    .replace(',', '.');
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * Nettoie une cellule texte. Retourne null (et non '') pour une cellule vide,
 * afin qu'un champ absent reste absent en base plutot que d'y ecrire du vide.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function toText(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === '' ? null : s;
}

/**
 * Valide un GTIN : 8, 12, 13 ou 14 chiffres, avec cle de controle correcte.
 * Les tarifs contiennent regulierement des GTIN tronques ou des references
 * internes glissees dans la colonne — les accepter reviendrait a creer des
 * produits fantomes et a faire echouer les relations qui pointent dessus.
 * @param {unknown} raw
 * @returns {string|null} GTIN normalise, ou null si invalide
 */
export function normalizeGtin(raw) {
  const s = toText(raw);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(digits.length)) return null;

  // Cle de controle GS1 : somme ponderee 3/1 en partant de la droite.
  const body = digits.slice(0, -1);
  const check = Number(digits.slice(-1));
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === check ? digits : null;
}

// ----------------------------------------------------------------------------
// SPECIFICATIONS D'ONGLETS
// ----------------------------------------------------------------------------

/**
 * Un champ = une cle canonique + les intitules sous lesquels on l'a rencontre.
 * `required` sert au controle de coherence : un onglet sans ses champs requis
 * est rejete en bloc plutot que d'importer des lignes mutilees.
 */
export const SHEET_SPECS = {
  B01_COMMERCE: {
    sheetAliases: ['b01 commerce', 'b01', 'commerce'],
    fields: [
      { key: 'manufacturer_ref', required: true,
        aliases: ['refciale', 'reference fabricant', 'ref fabricant', 'refinfor',
                  'reference', 'ref', 'code article', 'article', 'reference article'] },
      { key: 'gtin',
        aliases: ['gtin', 'ean', 'code ean', 'ean13', 'gtin ean', 'code barre', 'gencod'] },
      { key: 'brand_code',
        aliases: ['marque', 'code marque', 'brand', 'code fabricant', 'fabricant'] },
      // Ordre = priorite. LIBELLE80 avant LIBELLE40 : le format 40 caracteres
      // arrive tronque et sans espaces dans les fichiers reels
      // (« CuvefioulRothalen700 »).
      { key: 'label', required: true,
        aliases: ['libelle80', 'libelle40', 'libelle court', 'designation', 'libelle',
                  'denomination', 'libelle commercial', 'nom', 'label'] },
      { key: 'description_text',
        aliases: ['libelle240', 'libelle long', 'description', 'descriptif',
                  'libelle etendu', 'description longue'] },
      { key: 'public_price_ht',
        aliases: ['tarif', 'prix public ht', 'prix public', 'tarif public', 'prix ht',
                  'prix de base ht', 'pvpc ht'] },
      { key: 'currency',
        aliases: ['dev', 'devise', 'currency', 'monnaie'] },
      { key: 'unit',
        aliases: ['ub', 'unite de vente', 'unite', 'uv', 'unite facturation', 'conditionnement'] },
      { key: 'range_name',
        aliases: ['gamme', 'famille commerciale'] },
    ],
  },

  // Onglet B03 en FAB-DIS 3.0. L'alias nu « b04 » est VOLONTAIREMENT absent :
  // en 3.0, B04 est l'onglet REGLEMENTAIRE. L'accepter ici ferait lire des
  // donnees reglementaires comme des medias, sans lever la moindre erreur.
  B03_MEDIA: {
    sheetAliases: ['b03 media', 'b04 media', 'media', 'medias'],
    fields: [
      { key: 'manufacturer_ref', required: true,
        aliases: ['refciale', 'reference fabricant', 'ref fabricant', 'reference', 'ref', 'code article'] },
      { key: 'gtin', aliases: ['gtin', 'ean', 'code ean'] },
      { key: 'media_type', required: true,
        aliases: ['mtyp', 'type de media', 'type media', 'type', 'nature du document', 'categorie media'] },
      { key: 'url', required: true,
        aliases: ['murl', 'url', 'lien', 'adresse', 'url media', 'lien fichier', 'http'] },
      { key: 'media_label',
        aliases: ['mnom', 'mtexte', 'libelle', 'description', 'titre', 'nom du fichier'] },
    ],
  },

  // Onglet C04 en FAB-DIS 3.0. « B05_ETIM » ne figure pas dans la norme ;
  // l'alias est conserve par tolerance pour les fichiers non conformes.
  C04_ETIM: {
    sheetAliases: ['c04 etim', 'c04', 'b05 etim', 'etim', 'caracteristiques'],
    fields: [
      { key: 'manufacturer_ref', required: true,
        aliases: ['refciale', 'reference fabricant', 'ref fabricant', 'reference', 'ref', 'code article'] },
      { key: 'gtin', aliases: ['gtin', 'ean', 'code ean'] },
      { key: 'brand_code', aliases: ['marque', 'code marque'] },
      { key: 'etim_class_code',
        aliases: ['artclassid', 'classe etim', 'code classe', 'etim class', 'classe', 'code classe etim'] },
      { key: 'feature_code', required: true,
        aliases: ['featureid', 'code caracteristique', 'caracteristique', 'code feature', 'feature', 'ef'] },
      // FVALUE porte indifferemment un code valeur (EV…) ou une valeur brute :
      // `assembleProducts` tranche selon que le contenu est numerique ou non.
      { key: 'value_code',
        aliases: ['fvalue', 'code valeur', 'valeur code', 'value', 'ev'] },
      { key: 'value_numeric',
        aliases: ['valeur numerique', 'valeur num', 'numeric value', 'valeur'] },
      { key: 'unit_code',
        aliases: ['code unite', 'unite', 'unit', 'eu'] },
      { key: 'etim_version', aliases: ['etimv', 'version etim'] },
    ],
  },

  // ⚠️ Les onglets de relations designent les produits par REFERENCE
  // COMMERCIALE, pas par GTIN — verifie sur un fichier fabricant reel. Les
  // deux sont acceptes ; `assembleProducts` resout les references en GTIN a
  // partir de B01, seul moyen de satisfaire les cles etrangeres de
  // catalog.product_relations.
  C02_CORRESPONDANCE: {
    sheetAliases: ['c02 correspondance', 'c02', 'correspondance', 'correspondances'],
    requiredAny: [['parent_gtin', 'parent_ref'], ['child_gtin', 'child_ref']],
    fields: [
      { key: 'parent_ref',
        aliases: ['refciale', 'reference principale', 'ref principale'] },
      { key: 'parent_brand', aliases: ['marque'] },
      { key: 'parent_gtin',
        aliases: ['gtin principal', 'gtin parent', 'ean principal', 'gtin', 'ean'] },
      { key: 'child_ref',
        aliases: ['refcialecor', 'reference associee', 'ref associee'] },
      { key: 'child_brand', aliases: ['marquecor'] },
      { key: 'child_gtin',
        aliases: ['gtin associe', 'gtin lie', 'ean associe', 'gtin accessoire', 'gtin enfant'] },
      { key: 'relation_type',
        aliases: ['cortyp', 'type de relation', 'type relation', 'nature', 'type', 'type association'] },
      { key: 'quantity_required',
        aliases: ['corq', 'quantite', 'qte', 'quantity', 'nombre'] },
    ],
  },

  C06_SUBSTITUTION: {
    sheetAliases: ['c06 substitution', 'c06', 'substitution', 'substitutions', 'remplacement'],
    requiredAny: [['parent_gtin', 'parent_ref'], ['child_gtin', 'child_ref']],
    fields: [
      { key: 'parent_ref', aliases: ['refold', 'reference remplacee', 'ancienne reference'] },
      { key: 'parent_brand', aliases: ['mqerefold', 'marque'] },
      { key: 'parent_gtin',
        aliases: ['gtin remplace', 'gtin origine', 'ancien gtin', 'gtin', 'ean'] },
      { key: 'child_ref', aliases: ['refcialesub', 'reference remplacante', 'nouvelle reference'] },
      { key: 'child_brand', aliases: ['marquesub'] },
      { key: 'child_gtin',
        aliases: ['gtin remplacant', 'nouveau gtin', 'gtin substitution', 'gtin de remplacement'] },
    ],
  },
};

/**
 * Valeurs rencontrees dans la colonne « type de relation » de C02, ramenees
 * a l'allowlist de catalog.product_relations. Une valeur non reconnue n'est
 * PAS transformee en OPTIONAL par defaut : la ligne est rejetee et signalee
 * (une dependance obligatoire vue comme optionnelle produit un devis incomplet,
 * une optionnelle vue comme obligatoire facture au client une piece inutile).
 */
export const RELATION_TYPE_MAP = {
  mandatory: 'MANDATORY', obligatoire: 'MANDATORY', obligatoires: 'MANDATORY',
  requis: 'MANDATORY', 'accessoire obligatoire': 'MANDATORY',
  optional: 'OPTIONAL', optionnel: 'OPTIONAL', optionnelle: 'OPTIONAL',
  accessoire: 'OPTIONAL', complementaire: 'OPTIONAL', option: 'OPTIONAL',
  compatible: 'COMPATIBLE', compatibilite: 'COMPATIBLE', associe: 'COMPATIBLE',
  substitution: 'SUBSTITUTION', remplacement: 'SUBSTITUTION', remplace: 'SUBSTITUTION',
};

// ----------------------------------------------------------------------------
// PARSING GENERIQUE
// ----------------------------------------------------------------------------

/**
 * Relie les en-tetes d'un onglet aux cles canoniques de sa specification.
 * @param {unknown[]} headers ligne d'en-tete brute
 * @param {object} spec entree de SHEET_SPECS
 * @returns {{map: Record<number,string>, unknown: string[], missing: string[]}}
 */
export function buildHeaderMap(headers, spec) {
  const map = {};
  const unknown = [];
  // key → { index, rank } : rang de l'alias qui a gagne, pour arbitrer les
  // doublons. Un fichier reel porte souvent plusieurs colonnes candidates pour
  // le meme champ (LIBELLE40 / LIBELLE80 / LIBELLE240) : sans arbitrage c'est
  // l'ordre des colonnes qui tranche, donc le libelle tronque a 40 caracteres
  // qui l'emporte. La position dans `aliases` fait foi : le premier gagne.
  const chosen = new Map();

  headers.forEach((raw, index) => {
    const norm = normalizeHeader(raw);
    if (!norm) return;

    let matched = null;
    for (const field of spec.fields) {
      const rank = field.aliases.indexOf(norm);
      if (rank !== -1) { matched = { field, rank }; break; }
    }

    if (!matched) {
      unknown.push(String(raw));
      return;
    }

    const previous = chosen.get(matched.field.key);
    if (!previous) {
      chosen.set(matched.field.key, { index, rank: matched.rank });
    } else if (matched.rank < previous.rank) {
      delete map[previous.index];
      chosen.set(matched.field.key, { index, rank: matched.rank });
    } else {
      return;
    }
    map[index] = matched.field.key;
  });

  const missing = spec.fields
    .filter((f) => f.required && !chosen.has(f.key))
    .map((f) => f.key);

  // `requiredAny` : groupes dont AU MOINS un membre doit etre present. Sert aux
  // onglets de relations, qui designent les produits tantot par GTIN, tantot
  // par reference commerciale selon le fabricant.
  for (const group of spec.requiredAny || []) {
    if (!group.some((key) => chosen.has(key))) missing.push(group.join('|'));
  }

  return { map, unknown, missing };
}

/**
 * Transforme les lignes brutes d'un onglet en enregistrements canoniques.
 * @param {unknown[][]} rows lignes brutes, en-tete incluse en position 0
 * @param {object} spec entree de SHEET_SPECS
 * @returns {{records: object[], unknownColumns: string[], missingColumns: string[], skipped: number}}
 */
export function parseSheet(rows, spec) {
  if (!Array.isArray(rows) || rows.length < 2) {
    return { records: [], unknownColumns: [], missingColumns: [], skipped: 0 };
  }

  const { map, unknown, missing } = buildHeaderMap(rows[0], spec);

  // Onglet inexploitable : on ne devine pas, on remonte l'anomalie a l'appelant.
  if (missing.length > 0) {
    return { records: [], unknownColumns: unknown, missingColumns: missing, skipped: rows.length - 1 };
  }

  const records = [];
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const rec = {};
    for (const [index, key] of Object.entries(map)) {
      rec[key] = row[Number(index)];
    }
    const hasRequired = spec.fields
      .filter((f) => f.required)
      .every((f) => toText(rec[f.key]) !== null)
      && (spec.requiredAny || []).every((g) => g.some((k) => toText(rec[k]) !== null));
    if (hasRequired) records.push(rec);
    else skipped += 1;
  }

  return { records, unknownColumns: unknown, missingColumns: [], skipped };
}

// ----------------------------------------------------------------------------
// ASSEMBLAGE
// ----------------------------------------------------------------------------

/**
 * Cle primaire d'un produit : le GTIN s'il est valide, sinon la reference.
 */
function joinKey(rec) {
  return normalizeGtin(rec.gtin) || toText(rec.manufacturer_ref);
}

/**
 * Index de rapprochement inter-onglets.
 *
 * Un meme produit n'est pas designe de la meme facon partout : B01 porte
 * generalement le GTIN, tandis que B04/B05 ne referencent souvent que la
 * reference fabricant (colonne GTIN absente ou vide). Indexer sur une seule
 * de ces cles fait echouer la jointure en silence : les produits sortent
 * sans media ni caracteristique, et rien ne le signale.
 * On enregistre donc CHAQUE identifiant connu du produit, et on resout une
 * ligne par n'importe lequel d'entre eux.
 */
function indexProduct(index, product) {
  if (product.gtin) index.set(`g:${product.gtin}`, product);
  if (product.manufacturer_ref) index.set(`r:${product.manufacturer_ref}`, product);
}

/** Retrouve le produit designe par une ligne, via son GTIN ou sa reference. */
function lookupProduct(index, rec) {
  const gtin = normalizeGtin(rec.gtin);
  if (gtin && index.has(`g:${gtin}`)) return index.get(`g:${gtin}`);
  const ref = toText(rec.manufacturer_ref);
  if (ref && index.has(`r:${ref}`)) return index.get(`r:${ref}`);
  return null;
}

/**
 * Assemble les onglets en produits canoniques.
 *
 * @param {object} sheets enregistrements par onglet (sorties de parseSheet)
 * @param {object[]} [sheets.B01_COMMERCE]
 * @param {object[]} [sheets.B03_MEDIA]
 * @param {object[]} [sheets.C04_ETIM]
 * @param {object[]} [sheets.C02_CORRESPONDANCE]
 * @param {object[]} [sheets.C06_SUBSTITUTION]
 * @param {object} [options]
 * @param {(code: string) => {label?: string, unit?: string}|null} [options.resolveEtim]
 *        traducteur ETIM (code EF/EV/EU → libelle FR). Absent → les codes sont
 *        conserves bruts, jamais inventes.
 * @returns {{products: object[], relations: object[], warnings: string[]}}
 */
export function assembleProducts(sheets = {}, options = {}) {
  const warnings = [];
  const byKey = new Map();
  const index = new Map();

  // --- B01 : socle produit ---------------------------------------------------
  for (const rec of sheets.B01_COMMERCE || []) {
    const key = joinKey(rec);
    if (!key) continue;

    const rawGtin = toText(rec.gtin);
    const gtin = normalizeGtin(rec.gtin);
    if (rawGtin && !gtin) {
      warnings.push(`GTIN invalide ignore pour ${toText(rec.manufacturer_ref)} : ${rawGtin}`);
    }

    if (byKey.has(key)) {
      warnings.push(`Doublon B01 sur ${key} — premiere occurrence conservee`);
      continue;
    }

    const product = {
      gtin,
      brand_code: toText(rec.brand_code),
      manufacturer_ref: toText(rec.manufacturer_ref),
      label: toText(rec.label),
      description_text: toText(rec.description_text),
      unit: toText(rec.unit) || 'PCE',
      public_price_ht: toNumber(rec.public_price_ht),
      currency: toText(rec.currency) || 'EUR',
      etim_class_code: null,
      etim_features: {},
      technical_pdf_url: null,
      installation_manual_url: null,
      media: {},
    };
    byKey.set(key, product);
    indexProduct(index, product);
  }

  // --- B04 : documents et visuels -------------------------------------------
  for (const rec of sheets.B03_MEDIA || []) {
    const product = lookupProduct(index, rec);
    if (!product) continue;

    const url = toText(rec.url);
    if (!url) continue;
    const type = normalizeHeader(rec.media_type);

    // Codes MTYP releves sur un fichier FAB-DIS 3.0 reel : FICHE, NOTICE,
    // PHOTO, PHOTOA, PHOTO3D, SCHEMA, ARGUC, PLUSPROD, VIDEO, VIDEOTU.
    // Le code est un mot seul (« FICHE »), pas une phrase : une regex qui
    // exigeait « fiche technique » ne captait rien.
    if (/^fiche$|fiche technique|technical|datasheet|documentation technique/.test(type)) {
      product.technical_pdf_url = product.technical_pdf_url || url;
    } else if (/^notice$|notice|installation|manuel|montage|pose/.test(type)) {
      product.installation_manual_url = product.installation_manual_url || url;
    }

    // Tout le reste (visuels HD, DoP, certificats CE) est conserve : la
    // conformite reglementaire en depend, et le document ne prevoyait que
    // deux colonnes.
    const bucket = type || 'autre';
    product.media[bucket] = product.media[bucket] || [];
    product.media[bucket].push({ url, label: toText(rec.media_label) });
  }

  // --- B05 : classification et caracteristiques ETIM -------------------------
  const resolveEtim = typeof options.resolveEtim === 'function' ? options.resolveEtim : null;

  for (const rec of sheets.C04_ETIM || []) {
    const product = lookupProduct(index, rec);
    if (!product) continue;

    const classCode = toText(rec.etim_class_code);
    if (classCode && !product.etim_class_code) {
      product.etim_class_code = classCode;
      const resolved = resolveEtim ? resolveEtim(classCode) : null;
      if (resolved?.label) product.etim_class_label = resolved.label;
    }

    const featureCode = toText(rec.feature_code);
    if (!featureCode) continue;

    const valueCode = toText(rec.value_code);
    const numeric = toNumber(rec.value_numeric);
    const unitCode = toText(rec.unit_code);

    const featureMeta = resolveEtim ? resolveEtim(featureCode) : null;
    const valueMeta = valueCode && resolveEtim ? resolveEtim(valueCode) : null;
    const unitMeta = unitCode && resolveEtim ? resolveEtim(unitCode) : null;

    product.etim_features[featureCode] = {
      label: featureMeta?.label ?? null,
      value: numeric !== null ? numeric : (valueMeta?.label ?? valueCode),
      value_code: valueCode,
      unit: unitMeta?.label ?? unitCode,
    };
  }

  // --- C02 / C06 : relations -------------------------------------------------
  // Ces onglets designent les produits par reference commerciale, alors que
  // catalog.product_relations pointe sur des GTIN. On construit donc un index
  // de resolution a partir de B01. Une reference portee par deux produits
  // distincts est ecartee de l'index : mieux vaut ne pas resoudre que resoudre
  // vers le mauvais article.
  const refToGtin = new Map();
  const ambiguousRefs = new Set();
  for (const product of byKey.values()) {
    if (!product.gtin || !product.manufacturer_ref) continue;
    const ref = product.manufacturer_ref;
    const brandKey = product.brand_code ? `b:${product.brand_code}|${ref}` : null;
    if (brandKey) refToGtin.set(brandKey, product.gtin);

    const bare = `r:${ref}`;
    if (refToGtin.has(bare) && refToGtin.get(bare) !== product.gtin) ambiguousRefs.add(bare);
    else refToGtin.set(bare, product.gtin);
  }
  for (const key of ambiguousRefs) refToGtin.delete(key);

  /** GTIN d'une extremite de relation, par GTIN direct ou par reference. */
  const resolveEndpoint = (rawGtin, rawRef, rawBrand) => {
    const direct = normalizeGtin(rawGtin);
    if (direct) return direct;
    const ref = toText(rawRef);
    if (!ref) return null;
    const brand = toText(rawBrand);
    if (brand && refToGtin.has(`b:${brand}|${ref}`)) return refToGtin.get(`b:${brand}|${ref}`);
    return refToGtin.get(`r:${ref}`) || null;
  };

  const relations = [];
  const seenRelations = new Set();

  const pushRelation = (parentRec, childRec, type, qty, origin) => {
    const parent = resolveEndpoint(parentRec.gtin, parentRec.ref, parentRec.brand);
    const child = resolveEndpoint(childRec.gtin, childRec.ref, childRec.brand);
    if (!parent || !child) {
      const shown = (r) => toText(r.gtin) || toText(r.ref) || '(vide)';
      warnings.push(`${origin} : relation ignoree, extremite non resolue (${shown(parentRec)} → ${shown(childRec)})`);
      return;
    }
    if (parent === child) {
      warnings.push(`${origin} : relation ignoree, parent et enfant identiques (${parent})`);
      return;
    }
    const dedup = `${parent}|${child}|${type}`;
    if (seenRelations.has(dedup)) return;
    seenRelations.add(dedup);
    relations.push({
      parent_gtin: parent,
      child_gtin: child,
      relation_type: type,
      quantity_required: qty && qty > 0 ? Math.round(qty) : 1,
    });
  };

  for (const rec of sheets.C02_CORRESPONDANCE || []) {
    const rawType = normalizeHeader(rec.relation_type);
    const type = RELATION_TYPE_MAP[rawType];
    if (!type) {
      warnings.push(`C02 : type de relation non reconnu, ligne ignoree — « ${toText(rec.relation_type) ?? '(vide)'} »`);
      continue;
    }
    pushRelation(
      { gtin: rec.parent_gtin, ref: rec.parent_ref, brand: rec.parent_brand },
      { gtin: rec.child_gtin, ref: rec.child_ref, brand: rec.child_brand },
      type, toNumber(rec.quantity_required), 'C02',
    );
  }

  for (const rec of sheets.C06_SUBSTITUTION || []) {
    pushRelation(
      { gtin: rec.parent_gtin, ref: rec.parent_ref, brand: rec.parent_brand },
      { gtin: rec.child_gtin, ref: rec.child_ref, brand: rec.child_brand },
      'SUBSTITUTION', 1, 'C06',
    );
  }

  return { products: [...byKey.values()], relations, warnings };
}

// ----------------------------------------------------------------------------
// TEXTE POUR EMBEDDING (section 4)
// ----------------------------------------------------------------------------

/**
 * Construit le texte soumis a l'embedding : identite du produit puis
 * caracteristiques ETIM traduites, en francais clair.
 *
 * Le PRIX en est volontairement absent. C'est ce qui permet a un changement
 * de tarif de ne declencher aucun appel API : l'empreinte du texte reste
 * identique, donc le vecteur n'est pas regenere (section 4 du cahier des
 * charges, « cout API IA : 0 EUR »).
 *
 * @param {object} product produit canonique issu d'assembleProducts
 * @returns {string}
 */
export function buildAiDescription(product) {
  if (!product) return '';
  const parts = [];

  const identity = [product.label, product.brand_code, product.manufacturer_ref]
    .filter(Boolean).join(' ');
  if (identity) parts.push(identity);

  if (product.etim_class_label) parts.push(product.etim_class_label);
  else if (product.etim_class_code) parts.push(product.etim_class_code);

  if (product.description_text) parts.push(product.description_text);

  for (const [code, feature] of Object.entries(product.etim_features || {})) {
    const name = feature.label || code;
    const value = feature.value;
    if (value === null || value === undefined || value === '') continue;
    parts.push(feature.unit ? `${name} : ${value} ${feature.unit}` : `${name} : ${value}`);
  }

  return parts.join('. ');
}

/**
 * Empreinte stable du texte d'embedding, stockee dans
 * catalog.products.ai_description_hash.
 * @param {string} text
 * @returns {string} sha256 hexadecimal
 */
export function hashAiDescription(text) {
  return createHash('sha256').update(text ?? '', 'utf8').digest('hex');
}
