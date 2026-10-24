// scripts/catalogue/backfill-catalog-items.mjs
// Backfill des articles Majord'home PAR LOTS, après la migration 20261026_1 (qui ne crée aucun article : la boucle
// sur ~26 000 lignes dépasse le délai d'une requête de l'API de management, vécu le 2026-10-24).
//   node scripts/catalogue/backfill-catalog-items.mjs --env .env.local [--ref ejqqqwudmizqisdkxohw] [--lot 2000] [--dry-run]
// Pour chaque org qui a des lignes fournisseur : catalog_items_ensure(org, lot) répété jusqu'à { crees: 0,
// rattaches: 0 } (idempotent, chaque appel < 1 min), puis quote_lines.catalog_item_id depuis la ligne fournisseur.
// --dry-run : compte seulement les lignes actives sans article. À lancer AVANT le prochain relevé nocturne (04:00 UTC),
// qui appellerait ensure sans limite.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const envFile = opt('--env', '.env.local');
const ref = opt('--ref', 'ejqqqwudmizqisdkxohw');
const lot = Math.max(100, Number(opt('--lot', '2000')) || 2000);
const dryRun = args.includes('--dry-run');

const env = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const token = env.SUPABASE_ACCESS_TOKEN;
if (!token) { console.error(`SUPABASE_ACCESS_TOKEN absent de ${envFile}`); process.exit(2); }

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const j = await r.json();
  if (!r.ok || !Array.isArray(j)) throw new Error(`HTTP ${r.status} ${JSON.stringify(j).slice(0, 400)}`);
  return j;
}

const orgs = await sql(`SELECT org_id, count(*) FILTER (WHERE is_active AND catalog_item_id IS NULL) AS restantes, count(*) FILTER (WHERE is_active) AS actives
  FROM majordhome.supplier_products WHERE org_id IS NOT NULL GROUP BY org_id ORDER BY 2 DESC`);
for (const o of orgs) console.log(`org ${o.org_id} : ${o.actives} lignes actives, ${o.restantes} sans article`);
if (dryRun) process.exit(0);

let totalCrees = 0; let totalRatt = 0;
for (const o of orgs) {
  if (Number(o.restantes) === 0) continue;
  let tour = 0;
  for (;;) {
    tour += 1;
    const debut = Date.now();
    const [{ r }] = await sql(`SELECT public.catalog_items_ensure('${o.org_id}'::uuid, ${lot}) AS r`);
    const res = typeof r === 'string' ? JSON.parse(r) : r;
    totalCrees += res.crees; totalRatt += res.rattaches;
    console.log(`  ${o.org_id.slice(0, 8)} lot ${tour} : ${res.crees} créés, ${res.rattaches} rattachés (${Date.now() - debut} ms)`);
    if (res.crees + res.rattaches === 0) break;
  }
}
const [{ n }] = await sql(`WITH u AS (UPDATE majordhome.quote_lines ql SET catalog_item_id = p.catalog_item_id
  FROM majordhome.supplier_products p WHERE p.id = ql.supplier_product_id AND ql.catalog_item_id IS NULL AND p.catalog_item_id IS NOT NULL RETURNING 1)
  SELECT count(*) AS n FROM u`);
console.log(`Terminé : ${totalCrees} articles créés, ${totalRatt} lignes rattachées à un article existant, ${n} lignes de devis reliées.`);
