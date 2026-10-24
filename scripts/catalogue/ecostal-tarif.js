// scripts/catalogue/ecostal-tarif.js
// Transcription du tarif ECOSTAL (JSON) → lignes attendues par public.supplier_catalog_upsert. Module PUR, testé
// scripts/catalogue/ecostal.test.mjs. Le tarif est un PDF transcrit à la main (pas de relevé automatique) : les
// contrôles (référence en double, prix manquant, fiche sans article) sont le seul filet.

/**
 * @param {{ fournisseur: object, tarif: { date: string }, marque: string, categorie: string, fiches?: Array<{prefixes: string[]}>, articles: Array<object> }} tarif
 * @param {{ version: string }} opts
 * @returns {{ fournisseur: object, lignes: Array<object> }}
 */
export function lignesDepuisTarifEcostal(tarif, { version }) {
  const { fournisseur, articles } = tarif || {};
  if (!fournisseur?.nom || !Array.isArray(articles) || articles.length === 0) throw new Error('Tarif Ecostal incomplet (fournisseur / articles)');
  if (!tarif.tarif?.date || !tarif.marque || !tarif.categorie) throw new Error('Tarif Ecostal incomplet (date / marque / catégorie)');

  const vus = new Set();
  const sansPrix = [];
  for (const a of articles) {
    if (!a.reference || !a.name) throw new Error(`Article sans référence ou sans libellé : ${JSON.stringify(a)}`);
    if (vus.has(a.reference)) throw new Error(`Référence en double : ${a.reference}`);
    vus.add(a.reference);
    if (!Number.isFinite(Number(a.prix)) || Number(a.prix) <= 0) sansPrix.push(a.reference);
    if (a.kind && !['main', 'accessory', 'consumable'].includes(a.kind)) throw new Error(`Nature inconnue pour ${a.reference} : ${a.kind}`);
  }
  if (sansPrix.length) throw new Error(`${sansPrix.length} article(s) sans prix : ${sansPrix.join(', ')}`);

  for (const f of tarif.fiches || []) {
    const couverts = articles.filter((a) => (f.prefixes || []).some((p) => a.reference.startsWith(p)));
    if (!couverts.length) throw new Error(`Fiche « ${f.fichier} » : aucun article ne commence par ${JSON.stringify(f.prefixes)}`);
  }

  const centimes = (v) => Math.round(Number(v) * 100) / 100;
  const lignes = articles.map((a) => ({
    reference: a.reference,
    name: a.name,
    brand: tarif.marque,
    gamme: a.gamme ?? null,
    product_kind: a.kind ?? 'main',
    purchase_price_ht: centimes(a.prix),
    selling_price_ht_defaut: null,
    default_tva_rate: 20,
    unit: a.unit ?? 'pièce',
    category: tarif.categorie,
    specs: {
      canonical: { ...(a.specs || {}), fabricant: tarif.marque, prix_tarif_ht: centimes(a.prix), date_tarif: tarif.tarif.date },
      source_version: version,
    },
  }));
  return { fournisseur, lignes };
}
