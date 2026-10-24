// scripts/catalogue/dump-woocommerce.browser.js
// Relevé d'un catalogue WooCommerce (Domos Industries : https://webshop.domosindustries.com) — À COLLER DANS LA
// CONSOLE DU NAVIGATEUR (F12 → Console) sur le site du fournisseur, une fois CONNECTÉ au compte Mayer (l'API refuse les visiteurs : 401
// « Authentification requise »). Le site est derrière Cloudflare Turnstile : aucune connexion serveur possible,
// ce relevé depuis le navigateur est LA voie Domos. Pagine l'API WooCommerce Store (100 articles par page,
// 8 pages) puis télécharge `domos-AAAA-MM.json`. Déposer ce fichier dans scripts/catalogue/data/ puis :
//   node scripts/catalogue/import-releve.mjs --fournisseur "DOMOS INDUSTRIES" --fichier scripts/catalogue/data/domos-AAAA-MM.json
// Pour un autre site WooCommerce : éditer PREFIXE (nom du fichier).
// ou l'importer depuis l'app (Settings → Fournisseurs → Importer un relevé). Prix HT en centimes (`prices.price`).
(async () => {
  const PREFIXE = 'domos';
  const strip = (h) => String(h || '').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#8211;|&#8217;|&rsquo;|&amp;/g, (m) => ({ '&nbsp;': ' ', '&#8211;': '–', '&#8217;': '’', '&rsquo;': '’', '&amp;': '&' })[m])
    .replace(/\s+/g, ' ').trim();
  const items = [];
  let total = null;
  for (let page = 1; page <= 50; page++) {
    const r = await fetch(`/wp-json/wc/store/v1/products?per_page=100&page=${page}`, { credentials: 'include' });
    if (r.status === 401) throw new Error('401 Authentification requise : connectez-vous au webshop puis relancez');
    if (!r.ok) throw new Error('HTTP ' + r.status + ' page ' + page);
    total = Number(r.headers.get('x-wp-total'));
    const pages = Number(r.headers.get('x-wp-totalpages'));
    const j = await r.json();
    for (const p of j) {
      items.push({
        id: p.id, name: strip(p.name), slug: p.slug, sku: p.sku, permalink: p.permalink, type: p.type, parent: p.parent,
        prices: p.prices, on_sale: p.on_sale, is_in_stock: p.is_in_stock, is_purchasable: p.is_purchasable,
        stock_availability: p.stock_availability?.text || null, low_stock_remaining: p.low_stock_remaining,
        categories: (p.categories || []).map((c) => ({ id: c.id, name: strip(c.name), slug: c.slug })),
        tags: (p.tags || []).map((t) => t.name), brands: (p.brands || []).map((b) => b.name),
        attributes: (p.attributes || []).map((a) => ({ name: a.name, terms: (a.terms || []).map((t) => t.name) })),
        short_description: strip(p.short_description).slice(0, 600), description: strip(p.description).slice(0, 1200),
        image: p.images?.[0]?.src || null, variations: (p.variations || []).length,
      });
    }
    console.log(`Domos : ${items.length} / ${total} articles…`);
    if (page >= pages) break;
  }
  if (items.length < total) throw new Error(`Relevé incomplet : ${items.length} / ${total}`);
  const rc = await fetch('/wp-json/wc/store/v1/products/categories?per_page=100', { credentials: 'include' });
  const categories = rc.ok ? (await rc.json()).map((c) => ({ id: c.id, name: strip(c.name), slug: c.slug, parent: c.parent, count: c.count })) : [];
  const releve = { source: location.origin + '/wp-json/wc/store/v1/products (session connectée)', fetched_at: new Date().toISOString(), total, items, categories };
  const nom = `${PREFIXE}-${releve.fetched_at.slice(0, 7)}.json`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(releve, null, 1)], { type: 'application/json' }));
  a.download = nom;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`Relevé Domos téléchargé : ${nom} (${items.length} articles)`);
})();
