// ============================================================================
// Téléchargement des PDF de factures FOURNISSEUR depuis Pennylane, via l'edge pennylane-supplier-invoices.
// Pennylane ne porte, pour un relevé mensuel, que des ventilations comptables sans libellé : le détail
// article / quantité / prix net n'existe que dans le PDF joint (`public_file_url`, lien valable 30 min).
// Le jeton Pennylane reste dans les secrets d'edge functions (l'API de management n'en rend qu'un condensé) :
// l'edge liste les factures d'un fournisseur Pennylane et renvoie leurs liens, le script télécharge dans
// scripts/catalogue/out/factures/<FOURNISSEUR>/<date>_<id>.pdf (gitignoré) et écrit un index JSON.
// Env (.env.local) : DST_URL (projet Supabase), MDH_IMPORT_SECRET (secret partagé de l'edge, 2026-10-24).
// Usage : node --env-file=.env.local scripts/catalogue/telecharger-factures-pennylane.mjs --supplier 273577038 [--supplier 276027202]
//         [--out scripts/catalogue/out/factures]
// ============================================================================
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opts = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const OUT = path.resolve(racine, opts('--out')[0] || 'scripts/catalogue/out/factures');
const SUPPLIERS = opts('--supplier').map(Number).filter(Boolean);
if (SUPPLIERS.length === 0) { console.error('--supplier <id Pennylane> requis (au moins un)'); process.exit(2); }

const SUPABASE_URL = process.env.DST_URL;
const SECRET = process.env.MDH_IMPORT_SECRET;
if (!SUPABASE_URL || !SECRET) throw new Error('DST_URL / MDH_IMPORT_SECRET absents de l’environnement (passer --env-file=.env.local)');

async function facturesDuFournisseur(supplierId) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/pennylane-supplier-invoices`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ supplier_id: supplierId }),
  });
  const texte = await r.text();
  if (!r.ok) throw new Error(`edge pennylane-supplier-invoices (${supplierId}) : HTTP ${r.status} ${texte.slice(0, 300)}`);
  return JSON.parse(texte).items || [];
}

mkdirSync(OUT, { recursive: true });
const INDEX = path.join(OUT, 'index.json');
// L'index est fusionné par facture : un appel pour un seul fournisseur ne fait pas disparaître les autres.
const index = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')).filter((e) => !SUPPLIERS.includes(e.supplier_id)) : [];
for (const supplierId of SUPPLIERS) {
  const factures = await facturesDuFournisseur(supplierId);
  if (factures.length === 0) { console.warn(`Fournisseur ${supplierId} : aucune facture`); continue; }
  for (const f of factures) {
    const nomFournisseur = (f.supplier_name || `supplier_${supplierId}`).replace(/[^A-Za-z0-9_-]+/g, '_');
    const dossier = path.join(OUT, nomFournisseur);
    mkdirSync(dossier, { recursive: true });
    const cible = path.join(dossier, `${f.date}_${f.id}.pdf`);
    const entree = {
      supplier_id: supplierId, supplier: f.supplier_name || null, id: f.id, date: f.date, label: f.label,
      invoice_number: f.invoice_number, amount: f.amount, amount_before_tax: f.amount_before_tax,
      filename: f.filename, pdf: path.relative(racine, cible), telecharge: false, erreur: null,
    };
    if (existsSync(cible)) { entree.telecharge = true; index.push(entree); console.log(`= ${entree.pdf} (déjà présent)`); continue; }
    if (!f.public_file_url) { entree.erreur = 'aucun fichier joint (public_file_url vide)'; index.push(entree); console.warn(`! ${f.label} : ${entree.erreur}`); continue; }
    let r = null;
    for (let essai = 0; essai < 4; essai++) {
      r = await fetch(f.public_file_url);
      if (r.status !== 429) break;
      await new Promise((ok) => setTimeout(ok, 2500 * (essai + 1)));
    }
    if (!r.ok) { entree.erreur = `téléchargement HTTP ${r.status}`; index.push(entree); console.warn(`! ${f.label} : ${entree.erreur}`); continue; }
    writeFileSync(cible, Buffer.from(await r.arrayBuffer()));
    entree.telecharge = true;
    index.push(entree);
    console.log(`+ ${entree.pdf}  ${f.label}  ${f.amount} €`);
  }
}
index.sort((a, b) => a.supplier_id - b.supplier_id || b.date.localeCompare(a.date));
writeFileSync(INDEX, JSON.stringify(index, null, 2), 'utf8');
const ok = index.filter((e) => e.telecharge).length;
console.log(`\n${ok}/${index.length} PDF disponibles → ${path.relative(racine, OUT)}/index.json`);
if (ok !== index.length) process.exitCode = 1;
