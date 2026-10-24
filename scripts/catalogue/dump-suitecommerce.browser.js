// scripts/catalogue/dump-suitecommerce.browser.js
// Relevé d'un catalogue NetSuite SuiteCommerce (BayWa r.e. : https://solarshop.baywa-re.fr) — À COLLER DANS LA
// CONSOLE DU NAVIGATEUR (F12 → Console) sur le site du fournisseur, une fois CONNECTÉ au compte Mayer (sans session, le prix est masqué et le
// relevé est inutile). Pagine l'API JSON de la boutique (100 articles par page, ~10 pages, une vingtaine de
// secondes) puis télécharge `baywa-AAAA-MM.json`. Déposer ce fichier dans scripts/catalogue/data/ puis :
//   node scripts/catalogue/import-releve.mjs --fournisseur "BAYWA R.E." --fichier scripts/catalogue/data/baywa-AAAA-MM.json
// Pour un autre site SuiteCommerce : éditer SCA_PATH et SITE_ID (visibles dans les URLs du site : /sca-xxx/… et c=…).
// Le niveau de prix (`pricelevel`) est celui de la session connectée : un autre compte verrait d'autres prix.
// Même relevé possible depuis l'app (Settings → Fournisseurs → Actualiser le catalogue) quand les identifiants
// BayWa sont enregistrés ; ce script est le repli si la connexion serveur est refusée.
// Première URL d'image d'un article (structure NetSuite imbriquée), ou null.
const premiereImage = (v) => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) { for (const x of v) { const u = premiereImage(x); if (u) return u; } return null; }
  if (typeof v === 'object') { if (typeof v.url === 'string') return v.url; for (const k of Object.keys(v)) { const u = premiereImage(v[k]); if (u) return u; } }
  return null;
};
(async () => {
  const SCA_PATH = '/sca-lux-2019-2';
  const SITE_ID = '6376560';
  const PREFIXE = 'baywa';
  const base = `/api/items?language=fr&currency=EUR&c=${SITE_ID}&sitepath=${encodeURIComponent(SCA_PATH + '/searchApi.ssp')}&use_pcv=T&fieldset=search&n=4&custitem_frsy_purchasable_component=false&country=FR&q=&limit=100`;
  const items = [];
  let total = null;
  for (let offset = 0; ; offset += 100) {
    const r = await fetch(base + '&offset=' + offset, { credentials: 'include' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' à offset ' + offset + ' — êtes-vous connecté ?');
    const j = await r.json();
    total = j.total;
    for (const it of j.items) {
      let ws = null;
      try { ws = it.custitem_webshopjson ? JSON.parse(it.custitem_webshopjson) : null; } catch { /* champ absent ou malformé */ }
      const docs = [];
      for (const g of (ws?.documents?.documents || [])) {
        for (const x of (g.docs || [])) if (['FR', 'EN'].includes(x.language)) docs.push({ type: g.name, lang: x.language, url: x.url });
      }
      items.push({
        internalid: it.internalid, itemid: it.itemid, displayname: it.displayname, storedisplayname2: it.storedisplayname2,
        urlcomponent: it.urlcomponent, itemtype: it.itemtype,
        itemimages_detail: premiereImage(it.itemimages_detail),
        price: it.onlinecustomerprice, price_detail: it.onlinecustomerprice_detail, ispurchasable: it.ispurchasable,
        isbackorderable: it.isbackorderable, quantityavailable: it.quantityavailable,
        noprice_visible: it.custitem_frsy_noprice_visible, requiredsalesunit: it.custitem_frsy_requiredsalesunit,
        recommendedsalesunit: it.custitem_recommendedsalesunit, fields: ws?.fields ?? null, docs,
      });
    }
    console.log(`BayWa : ${items.length} / ${total} articles…`);
    if (j.items.length < 100 || items.length >= total) break;
  }
  if (items.length < total) throw new Error(`Relevé incomplet : ${items.length} / ${total}`);
  const sansPrix = items.filter((i) => typeof i.price !== 'number').length;
  if (sansPrix > items.length / 2) throw new Error(`${sansPrix} articles sans prix : la session n'est pas connectée`);
  const releve = { source: location.origin + '/api/items (session connectée)', fetched_at: new Date().toISOString(), total, items };
  const nom = `${PREFIXE}-${releve.fetched_at.slice(0, 7)}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(releve, null, 1)], { type: 'application/json' }));
  a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`Relevé BayWa téléchargé : ${nom} (${items.length} articles)`);
})();
