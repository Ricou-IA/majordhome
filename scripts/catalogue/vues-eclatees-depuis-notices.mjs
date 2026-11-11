// ============================================================================
// Vues éclatées tirées des NOTICES, pour les modèles d'appareil que le site du fabricant publie sans vue éclatée
// (76 modèles Invicta sur 470 au relevé du 2026-11-11, dont 6 ont une notice). Demande d'Eric (2026-11-11), après
// avoir vu « Pas de vue éclatée pour ce modèle » sur un Antaya dont la notice contient pourtant la page « ÉCLATÉ ».
//   1. modèles actifs SANS vue éclatée ayant au moins une notice déjà rangée dans NOTRE Storage ;
//   2. chaque notice est téléchargée depuis notre Storage (aucun appel au site du fabricant) ;
//   3. scripts/catalogue/vue-eclatee-notice.py (PyMuPDF) repère la page titrée « ÉCLATÉ » et la rend en PNG ;
//   4. l'image est déposée dans `${org}/equipment-models/site/vue-<notice>-p<N>.png` et inscrite sur le modèle par la
//      RPC public.equipment_models_set_files, avec `origine: 'notice'` et la page de NOMENCLATURE de la notice.
//   ⚠ Les repères d'une notice ne sont PAS ceux du site (Antaya : taque 16 dans la notice, 17 sur le site). L'écran
//     le dit en toutes lettres et la pièce se retrouve par sa RÉFÉRENCE, identique des deux côtés.
// Un modèle qui a déjà une vue éclatée n'est jamais touché ; rien de trouvé dans une notice = rien d'écrit.
// Rejouable (objets déposés en `upsert: false`, un objet présent est repris).
// Usage : node scripts/catalogue/vues-eclatees-depuis-notices.mjs [--marque Invicta] [--env .env.local] [--sans-ecriture]
// Prérequis : Python + PyMuPDF (comme pdf-mots.py).
// ============================================================================
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ici = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const ORG = opt('--org', '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1');
const REF = opt('--ref', 'ejqqqwudmizqisdkxohw');
const MARQUE = opt('--marque', 'Invicta');
const SANS_ECRITURE = args.includes('--sans-ecriture');
const BUCKET = 'product-documents';

const env = Object.fromEntries(readFileSync(opt('--env', '.env.local'), 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const { DST_URL, DST_KEY, SUPABASE_ACCESS_TOKEN } = env;
if (!DST_URL || !DST_KEY || !SUPABASE_ACCESS_TOKEN) { console.error('DST_URL, DST_KEY et SUPABASE_ACCESS_TOKEN requis dans le fichier env'); process.exit(2); }
if (!DST_URL.includes(REF)) { console.error(`DST_URL ne pointe pas sur le projet ${REF}`); process.exit(2); }

const q = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`SQL HTTP ${r.status} : ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

const candidats = await sql(`
  select m.source_id, m.reference, m.name, d.storage_path, d.label
  from majordhome.equipment_models m
  join majordhome.equipment_documents d on d.equipment_model_id = m.id and d.document_type = 'notice'
  where m.org_id = ${q(ORG)} and m.brand_key = majordhome.equipment_model_key(${q(MARQUE)})
    and m.is_active and jsonb_array_length(m.exploded_views) = 0
  order by m.name, d.created_at, d.id`);
const prefixe = `${ORG}/equipment-models/site/`;
const parModele = new Map();
for (const c of candidats) {
  if (!c.storage_path.startsWith(prefixe)) continue;
  if (!parModele.has(c.source_id)) parModele.set(c.source_id, { ...c, notices: [] });
  parModele.get(c.source_id).notices.push({ chemin: c.storage_path, label: c.label });
}
console.log(`${MARQUE} — ${parModele.size} modèle(s) sans vue éclatée avec une notice`);
if (!parModele.size) process.exit(0);

const storage = createClient(DST_URL, DST_KEY, { auth: { persistSession: false } }).storage.from(BUCKET);
const tmp = mkdtempSync(path.join(os.tmpdir(), 'vues-notices-'));
const pagesParNotice = new Map(); // chemin de la notice → [{ path, width, height }]
const fichiers = [];
const bilan = [];
try {
  for (const modele of parModele.values()) {
    const vues = [];
    for (const notice of modele.notices) {
      if (!pagesParNotice.has(notice.chemin)) {
        const { data, error } = await storage.download(notice.chemin);
        if (error) throw new Error(`Téléchargement ${notice.chemin} : ${error.message}`);
        const nom = path.basename(notice.chemin, '.pdf').replace(/^doc-/, 'vue-');
        const local = path.join(tmp, `${nom}.pdf`);
        writeFileSync(local, Buffer.from(await data.arrayBuffer()));
        const sortie = JSON.parse(execFileSync('python', ['-I', path.join(ici, 'vue-eclatee-notice.py'), local, tmp], { encoding: 'utf8' }));
        const pages = [];
        for (const p of sortie.pages) {
          const chemin = `${prefixe}${p.fichier}`;
          if (!SANS_ECRITURE) {
            const { error: errUp } = await storage.upload(chemin, readFileSync(path.join(tmp, p.fichier)), { contentType: 'image/png', upsert: false });
            if (errUp && !/already exists|duplicate/i.test(errUp.message)) throw new Error(`Dépôt ${chemin} : ${errUp.message}`);
          }
          pages.push({ path: chemin, width: p.width, height: p.height, origine: 'notice', role: p.role, page: p.page });
        }
        pagesParNotice.set(notice.chemin, pages);
      }
      vues.push(...pagesParNotice.get(notice.chemin));
    }
    // une notice qui ne livre que sa nomenclature (sans vue) n'apporte rien
    const aVue = vues.some((v) => v.role === 'vue');
    bilan.push({ reference: modele.reference, modele: modele.name, notices: modele.notices.length, vues: aVue ? vues.filter((v) => v.role === 'vue').length : 0, pages: aVue ? vues.map((v) => `${v.page}${v.role === 'nomenclature' ? ' (nomenclature)' : ''}`).join(', ') : '' });
    if (aVue) fichiers.push({ source_id: modele.source_id, exploded_views: vues });
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.table(bilan);

if (SANS_ECRITURE) {
  console.log('Pas d\'écriture (--sans-ecriture).');
} else if (fichiers.length) {
  const corps = JSON.stringify(fichiers);
  if (corps.includes('$files$')) throw new Error('Balise $files$ présente dans les données');
  // `documents` absent de chaque entrée : les documents du modèle ne sont pas touchés ; la RPC ne pose les vues que
  // si la liste est non vide, et la requête ne sélectionne que des modèles sans vue.
  const [ligne] = await sql(`select public.equipment_models_set_files(${q(ORG)}, ${q(MARQUE)}, 'vues-notices', $files$${corps}$files$::jsonb) as res`);
  console.log(`Base : ${JSON.stringify(ligne.res)}`);
}
const sans = bilan.filter((b) => !b.vues);
if (sans.length) console.log(`Sans page « éclaté » repérée dans la notice : ${sans.map((b) => b.reference).join(', ')}`);
