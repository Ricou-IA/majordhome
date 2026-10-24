// scripts/catalogue/dump-baywa.browser.js
// Relevé du catalogue BayWa r.e. — À COLLER DANS LA CONSOLE DU NAVIGATEUR (F12 → Console) sur
// https://solarshop.baywa-re.fr une fois CONNECTÉ au compte Mayer (sans session, le prix est masqué et le
// relevé est inutile). Pagine l'API JSON de la boutique (100 articles par page, ~10 pages, une vingtaine de
// secondes) puis télécharge `baywa-AAAA-MM.json`. Déposer ce fichier dans scripts/catalogue/data/ puis :
//   node scripts/catalogue/import-releve.mjs --fournisseur baywa --fichier scripts/catalogue/data/baywa-AAAA-MM.json
// Le niveau de prix (`pricelevel`) est celui de la session connectée : un autre compte verrait d'autres prix.
// Même relevé possible depuis l'app (Settings → Fournisseurs → Actualiser le catalogue) quand les identifiants
// BayWa sont enregistrés ; ce script est le repli si la connexion serveur est refusée.
(async () => {
  const base = '/api/items?language=fr&currency=EUR&c=6376560&sitepath=%2Fsca-lux-2019-2%2FsearchApi.ssp&use_pcv=T&fieldset=search&n=4&custitem_frsy_purchasable_component=false&country=FR&q=&limit=100';
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
        storedescription: it.storedescription, urlcomponent: it.urlcomponent, itemtype: it.itemtype,
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
  const releve = { source: 'https://solarshop.baywa-re.fr/api/items (session connectée)', fetched_at: new Date().toISOString(), total, items };
  const nom = `baywa-${releve.fetched_at.slice(0, 7)}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(releve, null, 1)], { type: 'application/json' }));
  a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`Relevé BayWa téléchargé : ${nom} (${items.length} articles)`);
})();
