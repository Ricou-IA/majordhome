/**
 * _execute_batches.mjs — Exécute les batches SQL via Supabase RPC
 * Usage: node _execute_batches.mjs
 */

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://odspcxgafcqxjzrarsqf.supabase.co';
// Lire la clé anon depuis .env
const envContent = readFileSync('.env', 'utf8');
const anonKey = envContent.split('\n')
  .find(l => l.startsWith('VITE_SUPABASE_ANON_KEY='))
  ?.split('=').slice(1).join('=').trim();

if (!anonKey) {
  console.error('❌ VITE_SUPABASE_ANON_KEY non trouvée dans .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, anonKey);

// Charger les batches
const batches = JSON.parse(readFileSync('_import_batches.json', 'utf8'));
// Skip batch 0 (purge, déjà fait)
const toExecute = batches.slice(1);

console.log(`📦 ${toExecute.length} batches à exécuter\n`);

// Exécuter séquentiellement par groupe
const groups = [
  { name: 'PROJECTS', filter: b => b.name.startsWith('projects_') },
  { name: 'CLIENTS', filter: b => b.name.startsWith('clients_') },
  { name: 'CONTRACTS', filter: b => b.name.startsWith('contracts_') },
  { name: 'EQUIPMENTS', filter: b => b.name.startsWith('equipments_') },
];

for (const group of groups) {
  const groupBatches = toExecute.filter(group.filter);
  console.log(`\n🔧 ${group.name} — ${groupBatches.length} batches`);

  // Exécuter en parallèle par groupes de 3
  const PARALLEL = 3;
  for (let i = 0; i < groupBatches.length; i += PARALLEL) {
    const chunk = groupBatches.slice(i, i + PARALLEL);
    const results = await Promise.all(
      chunk.map(async (batch) => {
        const start = Date.now();
        const { data, error } = await supabase.rpc('temp_exec_sql', { sql_text: batch.sql });
        const elapsed = Date.now() - start;
        if (error) {
          console.error(`   ❌ ${batch.name} (${elapsed}ms): ${error.message}`);
          return { name: batch.name, ok: false, error: error.message };
        }
        if (data && data.success === false) {
          console.error(`   ❌ ${batch.name} (${elapsed}ms): ${data.error}`);
          return { name: batch.name, ok: false, error: data.error };
        }
        console.log(`   ✅ ${batch.name} (${elapsed}ms)`);
        return { name: batch.name, ok: true };
      })
    );

    const failures = results.filter(r => !r.ok);
    if (failures.length > 0) {
      console.error(`\n💥 ${failures.length} erreur(s) détectée(s). Arrêt.`);
      process.exit(1);
    }
  }
  console.log(`   ✅ ${group.name} terminé`);
}

console.log('\n✅ Import terminé ! Vérification...');

// Vérification rapide
const { data: counts } = await supabase.rpc('temp_exec_sql', {
  sql_text: "SELECT 'done' AS status"
});
console.log('   RPC fonctionne:', counts);

console.log('\n🎉 Tous les batches exécutés avec succès !');
