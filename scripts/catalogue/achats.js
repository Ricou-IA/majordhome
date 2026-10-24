// scripts/catalogue/achats.js
// Catalogue d'achats d'un fournisseur à partir de ses factures lues (parserFactureSoditelem / parserFactureTereva,
// ou transcription d'un relevé scanné) : une ligne par référence, au DERNIER prix net payé, avec l'historique des
// achats dans specs.canonical. Lignes au contrat de public.supplier_catalog_upsert (p_rows) — à appeler avec
// p_meta.desactiver_absents = false (migration 20261025_4) : un article non racheté ce mois-ci reste au catalogue.
// Règles :
//   - seules les FACTURES comptent (un avoir est un retour, pas un prix) ; une ligne sans code, sans quantité ou
//     sans prix est écartée et rapportée ;
//   - prix d'achat = prix unitaire net (remise déduite, éco-participation exclue) de la ligne la plus récente
//     (date de facture, puis date de BL, puis ordre dans la facture) à prix NON NUL ; un article seulement vu à
//     0 € (offert dans un pack) est gardé à 0 et marqué `offert_dans_pack` ;
//   - libellé, unité, TVA = ceux de la ligne la plus récente ; prix de vente par défaut = prix public s'il existe,
//     sinon 0 (« à renseigner ») — appliqué par la RPC seulement si le prix de vente est encore à 0 ;
//   - prix public (`tarif_public`) = « Prix de base » du relevé quand le fournisseur l'imprime (Soditelem), avec le
//     taux de remise effectif (Eric 2026-10-24) ; Tereva ne l'imprime pas → null, le drawer reste vide.
// Module PUR, testé scripts/catalogue/achats.test.mjs.

/** @param {string} designation */
function libelle(designation) {
  return String(designation || '').replace(/\s+/g, ' ').trim();
}

function ordreLigne(a, b) {
  return (b.date || '').localeCompare(a.date || '') || (b.bl_date || '').localeCompare(a.bl_date || '') || b.rang - a.rang;
}

/**
 * @param {Array<{ type:string, numero:string|null, date:string|null, format?:string, pennylane_id?:number|null,
 *   lignes: Array<{ code:string, designation:string, complement?:string|null, ref_fabricant?:string|null, quantite:number|null,
 *     unite:string, uf?:string|null, prix_unitaire_net:number|null, montant_ht:number|null, promo?:boolean, eco?:number|null,
 *     deee?:number|null, prix_base?:number|null, remises?:number[], tva_taux?:number|null, bl?:{ numero?:string|null, date?:string|null } }> }>} documents
 * @param {{ version: string, historique_max?: number }} opts
 * @returns {{ lignes: Array<Record<string, any>>, rapport: { factures: number, avoirs_ignores: string[], lignes_lues: number,
 *   lignes_ecartees: string[], articles: number, articles_offerts: number, dernier_achat: string|null } }}
 */
export function catalogueDepuisAchats(documents, { version, historique_max = 24 }) {
  if (!version) throw new Error('version requise');
  const rapport = { factures: 0, avoirs_ignores: [], lignes_lues: 0, lignes_ecartees: [], articles: 0, articles_offerts: 0, dernier_achat: null };
  const achats = new Map();
  for (const doc of documents) {
    if (doc.type !== 'facture') { rapport.avoirs_ignores.push(`${doc.type ?? 'document'} ${doc.numero ?? '?'} du ${doc.date ?? '?'}`); continue; }
    rapport.factures += 1;
    doc.lignes.forEach((l, rang) => {
      rapport.lignes_lues += 1;
      if (!l.code || l.quantite == null || l.prix_unitaire_net == null || !(l.quantite > 0)) {
        rapport.lignes_ecartees.push(`facture ${doc.numero} : ${l.code || '(sans code)'} ${l.designation || ''} — quantité ${l.quantite} prix ${l.prix_unitaire_net}`);
        return;
      }
      const a = { ...l, date: doc.date, facture: doc.numero, bl_date: l.bl?.date ?? null, bl_numero: l.bl?.numero ?? null, rang };
      if (!achats.has(l.code)) achats.set(l.code, []);
      achats.get(l.code).push(a);
      if (doc.date && (!rapport.dernier_achat || doc.date > rapport.dernier_achat)) rapport.dernier_achat = doc.date;
    });
  }

  const lignes = [];
  for (const [code, liste] of achats) {
    liste.sort(ordreLigne);
    const recente = liste[0];
    const prixNonNul = liste.find((a) => a.prix_unitaire_net > 0);
    const reference = prixNonNul ?? recente;
    const offert = !prixNonNul;
    if (offert) rapport.articles_offerts += 1;
    const prix = liste.filter((a) => a.prix_unitaire_net > 0).map((a) => a.prix_unitaire_net);
    const refFabricant = liste.map((a) => a.ref_fabricant).find(Boolean) ?? null;
    const complement = liste.map((a) => a.complement).find(Boolean) ?? null;
    const canonical = {
      source: 'factures_pennylane',
      dernier_achat: recente.date,
      derniere_facture: recente.facture,
      prix_du: reference.date,
      nb_achats: liste.length,
      quantite_totale: Math.round(liste.reduce((s, a) => s + a.quantite, 0) * 1000) / 1000,
      prix_min: prix.length ? Math.min(...prix) : null,
      prix_max: prix.length ? Math.max(...prix) : null,
      historique: liste.slice(0, historique_max).map((a) => ({ date: a.date, facture: a.facture, bl: a.bl_numero, quantite: a.quantite, prix_unitaire_net: a.prix_unitaire_net })),
    };
    if (refFabricant) canonical.ref_fabricant = refFabricant;
    if (complement) canonical.complement = complement;
    if (reference.prix_base != null) canonical.prix_base = reference.prix_base;
    if (reference.remises?.length) canonical.remises_pct = reference.remises;
    if (reference.promo) canonical.promo = true;
    if (reference.uf) canonical.unite_facturation = reference.uf;
    const eco = reference.eco ?? reference.deee;
    if (eco != null && reference.quantite > 0) canonical.eco_participation_unitaire = Math.round((eco / reference.quantite) * 100) / 100;
    if (offert) canonical.offert_dans_pack = true;
    lignes.push({
      reference: code,
      name: libelle(recente.designation) || code,
      brand: null,
      gamme: null,
      product_kind: 'main',
      purchase_price_ht: Math.round(reference.prix_unitaire_net * 10000) / 10000,
      // date du prix (supplier_products.purchase_price_at) = la facture de référence, pas la date du relevé
      purchase_price_at: reference.date,
      // prix public = « Prix de base » imprimé par le fournisseur (Soditelem), remise = taux effectif base → net
      tarif_public: reference.prix_base > 0 ? Math.round(reference.prix_base * 100) / 100 : null,
      taux_remise: reference.prix_base > 0 ? Math.round((1 - reference.prix_unitaire_net / reference.prix_base) * 10000) / 100 : null,
      // vente par défaut = prix public quand le fournisseur l'imprime (Eric 2026-10-24, comme MODINOX) ; la RPC ne
      // l'applique qu'à l'INSERT ou tant que le prix de vente est encore à 0 — une saisie du drawer survit.
      selling_price_ht_defaut: reference.prix_base > 0 ? Math.round(reference.prix_base * 100) / 100 : 0,
      default_tva_rate: recente.tva_taux ?? 20,
      unit: recente.unite || 'pièce',
      category: null,
      specs: { source_version: version, canonical },
    });
  }
  lignes.sort((a, b) => a.reference.localeCompare(b.reference));
  rapport.articles = lignes.length;
  return { lignes, rapport };
}
