#!/usr/bin/env node
/**
 * migrate-n8n-refs.mjs — repointe les workflows N8N de Majord'home vers le
 * nouveau projet Supabase.
 * ============================================================================
 *
 * Chaque workflow qui appelle Supabase code EN DUR trois valeurs dans ses
 * noeuds HTTP Request : l'URL du projet, la cle anon, et le MDH_CRON_SECRET en
 * Bearer. Les modifier a la main sur douze workflows est un travail de fourmi
 * et une source d'oublis silencieux.
 *
 * ⚠️ Pourquoi une liste EXPLICITE de workflows, et pas un remplacement global :
 * le ref de l'ancien projet apparait aussi dans les workflows Baikal, Pack
 * Vendeur et GTM Agent, qui doivent continuer a pointer dessus. Un
 * chercher-remplacer sur toute l'instance casserait les autres apps.
 *
 * Usage (PowerShell) :
 *   $env:N8N_URL    = "https://n8n.srv1102213.hstgr.cloud"
 *   $env:N8N_KEY    = "<cle API N8N : Settings > API > Create an API key>"
 *   $env:NEW_ANON   = "<cle anon du nouveau projet>"
 *   $env:OLD_SECRET = "<ancien MDH_CRON_SECRET>"
 *   $env:NEW_SECRET = "<nouveau MDH_CRON_SECRET>"
 *   node scripts/migrate-n8n-refs.mjs --dry-run
 *
 * Toujours passer --dry-run d'abord : il montre, par workflow, ce qui serait
 * remplace, sans rien ecrire.
 */

const OLD_REF = 'odspcxgafcqxjzrarsqf';
const NEW_REF = 'ejqqqwudmizqisdkxohw';

// Cle anon de l'ancien projet — publique par conception, elle est dans le
// bundle navigateur. Presente ici pour pouvoir la reconnaitre et la remplacer.
const OLD_ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9kc3BjeGdhZmNxeGp6cmFyc3FmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM1ODcwNzUsImV4cCI6MjA3OTE2MzA3NX0.DKCg_EwasSi_SNto8D3rC5H7FaShuUra8cGQ6g9Q58g';

// Workflows Majord'home, releves le 2026-08-10. Liste volontairement explicite.
const WORKFLOWS = [
  ['byye2XAO6rmIpJKa', 'Mayer - Contact Lead'],
  ['0F1PCH1VN8UVj8bu', 'Mayer - Slack Interactions'],
  ['9XdRbunVexw7TdrQ', 'Mayer - Urgence SAV'],
  ['yoGBgLCrX2k7RBjs', 'Mayer - Entretien Contrat (inactif)'],
  ['KJGSYuwH9im7B7za', 'Mayer Entretien Web - Souscription Contrat'],
  ['hBJW0TSN1xRKyTgX', 'Mayer - SMS Avis Client'],
  ['NFsOomeMA4TKt1UD', 'Mayer - Meta Ads Insights (Daily)'],
  ['Gi9befccFWoM28ES', 'Mayer - Meta Ads Budget Backfill (inactif)'],
  ['PMgiRyDX8ocb5qkN', 'Major - Pennylane Sync Cron'],
  ['0ULIpKzATDQvt7r1', 'Mayer - Voice Field Report'],
  ['v0KSaPHSp8DBBljI', 'Mayer - SMS RDV'],
  ['AmMYLDIvljgkXJTL', 'Mayer - Meta Leads (Polling)'],
];

const DRY_RUN = process.argv.includes('--dry-run');
const { N8N_URL, N8N_KEY, NEW_ANON, OLD_SECRET, NEW_SECRET } = process.env;

const requis = ['N8N_URL', 'N8N_KEY', 'NEW_ANON'];
const manquants = requis.filter((k) => !process.env[k]);
if (manquants.length) {
  console.error(`Variables manquantes : ${manquants.join(', ')}`);
  process.exit(1);
}
if (Boolean(OLD_SECRET) !== Boolean(NEW_SECRET)) {
  console.error('OLD_SECRET et NEW_SECRET vont par paire : fournir les deux, ou aucun.');
  process.exit(1);
}
if (!OLD_SECRET) {
  console.warn('Sans OLD_SECRET/NEW_SECRET, le Bearer MDH_CRON_SECRET ne sera PAS remplace.\n');
}

const base = N8N_URL.replace(/\/+$/, '');
const entetes = { 'X-N8N-API-KEY': N8N_KEY, 'Content-Type': 'application/json' };

// Les remplacements sont appliques sur le JSON serialise du workflow : ca
// couvre les URL, les en-tetes, le code des noeuds Code et les expressions,
// sans avoir a connaitre la structure de chaque noeud.
const REMPLACEMENTS = [
  ['ref du projet', OLD_REF, NEW_REF],
  ['cle anon', OLD_ANON, NEW_ANON],
  ...(OLD_SECRET ? [['MDH_CRON_SECRET', OLD_SECRET, NEW_SECRET]] : []),
];

let modifies = 0;
let intacts = 0;
let erreurs = 0;

for (const [id, nom] of WORKFLOWS) {
  try {
    const res = await fetch(`${base}/api/v1/workflows/${id}`, { headers: entetes });
    if (!res.ok) throw new Error(`lecture HTTP ${res.status}`);
    const wf = await res.json();

    const avant = JSON.stringify({ nodes: wf.nodes, connections: wf.connections });
    let apres = avant;
    const detail = [];

    for (const [libelle, from, to] of REMPLACEMENTS) {
      if (!from || !to) continue;
      const n = apres.split(from).length - 1;
      if (n > 0) {
        apres = apres.split(from).join(to);
        detail.push(`${libelle} x${n}`);
      }
    }

    if (apres === avant) {
      intacts++;
      console.log(`  =  ${nom} — rien a changer`);
      continue;
    }

    console.log(`  ${DRY_RUN ? '~' : '>'}  ${nom} — ${detail.join(', ')}`);
    if (DRY_RUN) { modifies++; continue; }

    const patch = JSON.parse(apres);

    // L'API N8N n'accepte qu'une liste blanche de proprietes dans `settings`
    // et rejette tout le reste en HTTP 400 (« must NOT have additional
    // properties »). Les workflows portent notamment `availableInMCP` et
    // `binaryMode`, qui sont lisibles mais pas ecrivables. On ne renvoie que
    // ce qui est accepte, sinon rien ne passe.
    const SETTINGS_AUTORISES = [
      'saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution',
      'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow',
      'timezone', 'executionOrder',
    ];
    const settings = Object.fromEntries(
      Object.entries(wf.settings ?? {}).filter(([k]) => SETTINGS_AUTORISES.includes(k)),
    );

    const put = await fetch(`${base}/api/v1/workflows/${id}`, {
      method: 'PUT',
      headers: entetes,
      body: JSON.stringify({
        name: wf.name,
        nodes: patch.nodes,
        connections: patch.connections,
        settings,
      }),
    });
    if (!put.ok) throw new Error(`ecriture HTTP ${put.status} — ${(await put.text()).slice(0, 160)}`);
    modifies++;
  } catch (e) {
    erreurs++;
    console.error(`  !  ${nom} — ${e.message}`);
  }
}

console.log('\n=== Bilan ===');
if (DRY_RUN) console.log('  (simulation, rien n a ete ecrit)');
console.log(`  modifies : ${modifies}`);
console.log(`  intacts  : ${intacts}`);
console.log(`  erreurs  : ${erreurs}`);

if (!DRY_RUN && modifies > 0) {
  console.log('\n  ⚠️ N8N garde une version publiee distincte de la version enregistree.');
  console.log('     Verifie que chaque workflow modifie est bien RE-PUBLIE, sinon');
  console.log('     l ancienne version continue de tourner. Constate sur');
  console.log('     « Major - Pennylane Sync Cron », dont la version active avait');
  console.log('     perdu son en-tete Authorization.');
}

process.exit(erreurs > 0 ? 1 : 0);
