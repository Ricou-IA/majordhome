/**
 * scripts/fabdis-import.mjs — Import d'un fichier FAB-DIS
 * ============================================================================
 * Chaine complete : lecture du classeur → parsing → assemblage → payload
 * d'ingestion pour la RPC `public.catalog_ingest_batch`.
 *
 * Usage :
 *   node scripts/fabdis-import.mjs <fichier.xlsx> [options]
 *
 *   --json <chemin>     ecrit le payload d'ingestion (defaut : ./fabdis-payload.json)
 *   --source <nom>      nom de la source enregistre sur les produits (defaut : nom du fichier)
 *   --etim <chemin>     dictionnaire ETIM local (JSON { "EF000008": {"label": "..."} })
 *   --apply             envoie directement a la RPC ; exige SUPABASE_URL et
 *                       SUPABASE_SERVICE_ROLE_KEY dans l'environnement
 *   --batch <n>         taille des lots en mode --apply (defaut 200)
 *
 * TRADUCTION ETIM
 * ---------------
 * Le cahier des charges (section 2.2) prevoit l'API REST ETIM International
 * (OAuth2) pour traduire les codes EC/EF/EV/EU en francais. Tant qu'aucun
 * compte n'est ouvert, `--etim` accepte un dictionnaire local et les codes
 * non traduits sont conserves BRUTS. Rien n'est invente : un code sans
 * traduction reste un code, visible comme tel.
 * ============================================================================
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

import { readFabdisWorkbook, formatReport } from './fabdis/workbook.mjs';
import { assembleProducts, buildAiDescription, hashAiDescription } from './fabdis/parser.mjs';

function parseArgs(argv) {
  const args = { file: null, json: 'fabdis-payload.json', source: null, etim: null, apply: false, batch: 200 };
  const rest = argv.slice(2);

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--json') args.json = rest[++i];
    else if (a === '--source') args.source = rest[++i];
    else if (a === '--etim') args.etim = rest[++i];
    else if (a === '--batch') args.batch = Number(rest[++i]) || 200;
    else if (!a.startsWith('--')) args.file = a;
  }
  return args;
}

/** Charge un dictionnaire ETIM local. Absent → aucune traduction (codes bruts). */
function loadEtimDictionary(path) {
  if (!path) return null;
  const dict = JSON.parse(readFileSync(path, 'utf8'));
  const count = Object.keys(dict).length;
  console.log(`Dictionnaire ETIM : ${count} code(s) charge(s) depuis ${path}`);
  return (code) => dict[code] || null;
}

async function applyBatches(payload, batchSize) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('--apply exige SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY dans l\'environnement');
  }

  const totals = {};
  const batches = [];
  for (let i = 0; i < payload.products.length; i += batchSize) {
    batches.push(payload.products.slice(i, i + batchSize));
  }
  // Les relations partent dans le dernier lot : leurs deux extremites doivent
  // exister en base, donc tous les produits doivent etre inseres avant.
  batches.forEach((products, index) => {
    batches[index] = {
      products,
      relations: index === batches.length - 1 ? payload.relations : [],
    };
  });

  for (const [index, batch] of batches.entries()) {
    const res = await fetch(`${url}/rest/v1/rpc/catalog_ingest_batch`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_products: batch.products,
        p_relations: batch.relations,
        p_source_name: payload.source_name,
        p_source_file: payload.source_file,
      }),
    });

    if (!res.ok) {
      throw new Error(`lot ${index + 1}/${batches.length} refuse (HTTP ${res.status}) : ${await res.text()}`);
    }

    const result = await res.json();
    for (const [k, v] of Object.entries(result)) {
      if (typeof v === 'number') totals[k] = (totals[k] || 0) + v;
    }
    console.log(`  lot ${index + 1}/${batches.length} : ${JSON.stringify(result)}`);
  }

  return totals;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.file) {
    console.error('Usage : node scripts/fabdis-import.mjs <fichier.xlsx> [--json <sortie>] [--etim <dict>] [--apply]');
    process.exit(1);
  }

  const { sheets, report } = await readFabdisWorkbook(args.file);
  console.log(formatReport(report));

  const resolveEtim = loadEtimDictionary(args.etim);
  const { products, relations, warnings } = assembleProducts(sheets, { resolveEtim });

  // Texte d'embedding et son empreinte : calcules ICI, une seule fois, et
  // transmis a la base. La RPC ne les recalcule pas — une seule source.
  for (const product of products) {
    product.ai_description = buildAiDescription(product);
    product.ai_description_hash = hashAiDescription(product.ai_description);
  }

  console.log('');
  console.log(`Assemblage : ${products.length} produit(s), ${relations.length} relation(s)`);

  const sansGtin = products.filter((p) => !p.gtin).length;
  if (sansGtin > 0) {
    console.log(`  ${sansGtin} produit(s) sans GTIN valide — identifies par (marque, reference), sans relation possible`);
  }
  const sansEtim = products.filter((p) => !p.etim_class_code).length;
  if (sansEtim > 0) {
    console.log(`  ${sansEtim} produit(s) sans classe ETIM`);
  }

  if (warnings.length) {
    console.log('');
    console.log(`Avertissements (${warnings.length}) :`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }

  const payload = {
    source_name: args.source || basename(args.file),
    source_file: args.file,
    products,
    relations,
  };

  if (args.apply) {
    console.log('');
    console.log('Ingestion via catalog_ingest_batch :');
    const totals = await applyBatches(payload, args.batch);
    console.log('');
    console.log(`Total : ${JSON.stringify(totals)}`);
  } else {
    writeFileSync(args.json, JSON.stringify(payload, null, 2), 'utf8');
    console.log('');
    console.log(`Payload ecrit : ${args.json}`);
    console.log('  → relancer avec --apply (et les variables SUPABASE_*) pour ingerer.');
  }
}

main().catch((err) => {
  console.error(`Echec : ${err.message}`);
  process.exit(1);
});
