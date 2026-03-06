/**
 * _import_excel.mjs — Script d'import Excel → SQL
 * ============================================================================
 * Lit le fichier Excel "Base Client NEW.xlsx" et génère des fichiers SQL
 * pour l'import dans Supabase (clients, contrats, équipements).
 *
 * Usage : node _import_excel.mjs
 * Sortie : _purge.sql, _import_clients.sql, _import_contracts_equipments.sql
 * ============================================================================
 */

import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';
import XLSX from 'xlsx';

// ============================================================================
// CONFIGURATION
// ============================================================================

const EXCEL_PATH = 'G:/Mon Drive/3. Mayer Energie/Clients/Base Client NEW.xlsx';
const ORG_ID = '3c68193e-783b-4aa9-bc0d-fb2ce21e99b1';
const BATCH_SIZE = 200;

// ============================================================================
// HELPERS
// ============================================================================

/** Convertit un serial Excel en date ISO (YYYY-MM-DD) */
function excelSerialToISO(serial) {
  if (!serial || typeof serial !== 'number') return null;
  // Excel epoch: 1899-12-30 (avec le bug Lotus 1-2-3 du 29 feb 1900)
  const epoch = new Date(1899, 11, 30);
  const date = new Date(epoch.getTime() + serial * 86400000);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calcule la prochaine date de maintenance (annuelle) à partir de start_date */
function computeNextMaintenance(startDateISO) {
  if (!startDateISO) return null;
  const start = new Date(startDateISO);
  const now = new Date();
  let next = new Date(start);
  // Avancer année par année jusqu'à trouver une date future
  while (next <= now) {
    next.setFullYear(next.getFullYear() + 1);
  }
  const y = next.getFullYear();
  const m = String(next.getMonth() + 1).padStart(2, '0');
  const d = String(next.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Escape SQL string (simple quotes doublées) */
function esc(val) {
  if (val === null || val === undefined) return 'NULL';
  const str = String(val).trim();
  if (!str) return 'NULL';
  return `'${str.replace(/'/g, "''")}'`;
}

/** Escape SQL string, mais retourne la valeur même vide (pas NULL) */
function escForce(val) {
  if (val === null || val === undefined) return "''";
  const str = String(val).trim();
  return `'${str.replace(/'/g, "''")}'`;
}

// ============================================================================
// MAPPING ÉQUIPEMENTS
// ============================================================================

const EQUIPMENT_KEYWORDS = [
  { keywords: ['PAP', 'POELE A PELLETS', 'POELE PELLETS', 'POÊLE À PELLETS', 'POÊLE PELLETS'], category: 'poele', label: 'Poêle à pellets' },
  { keywords: ['PAB', 'POELE A BOIS', 'POELE BOIS', 'POÊLE À BOIS', 'POÊLE BOIS'], category: 'poele', label: 'Poêle à bois' },
  { keywords: ['INSERT PELLETS'], category: 'poele', label: 'Insert pellets' },
  { keywords: ['INSERT BOIS'], category: 'poele', label: 'Insert bois' },
  { keywords: ['INSERT'], category: 'poele', label: 'Insert' }, // fallback après les spécifiques
  { keywords: ['CHAUDIERE PELLETS', 'CHAUDIÈRE PELLETS'], category: 'chaudiere_bois', label: 'Chaudière pellets' },
  { keywords: ['CHAUDIERE BOIS', 'CHAUDIÈRE BOIS'], category: 'chaudiere_bois', label: 'Chaudière bois' },
  { keywords: ['CHAUDIERE GAZ', 'CHAUDIÈRE GAZ'], category: 'chaudiere_gaz', label: 'Chaudière gaz' },
  { keywords: ['CHAUDIERE FIOUL', 'CHAUDIÈRE FIOUL'], category: 'chaudiere_fioul', label: 'Chaudière fioul' },
  { keywords: ['CHAUDIERE', 'CHAUDIÈRE'], category: 'chaudiere_gaz', label: 'Chaudière' }, // fallback
  { keywords: ['PAC', 'PAG', 'POMPE A CHALEUR', 'POMPE À CHALEUR'], category: 'pac_air_eau', label: 'Pompe à chaleur' },
  { keywords: ['GAINABLE'], category: 'climatisation', label: 'Gainable' },
  { keywords: ['SPLIT'], category: 'climatisation', label: 'Split' },
  { keywords: ['CLIM', 'CLIMATISATION'], category: 'climatisation', label: 'Climatisation' },
  { keywords: ['BALLON THERMO', 'BALLON THERMODYNAMIQUE'], category: 'chauffe_eau_thermo', label: 'Ballon thermodynamique' },
  { keywords: ['BALLON ECS'], category: 'ballon_ecs', label: 'Ballon ECS' },
  { keywords: ['VMC'], category: 'vmc', label: 'VMC' },
];

/**
 * Parse "Type Contrat" et retourne un tableau d'équipements
 * Ex: "PAP + POELE A BOIS" → [{category:'poele', label:'Poêle à pellets'}, {category:'poele', label:'Poêle à bois'}]
 * Ex: "PAC X2" → [{category:'pac_air_eau',...}, {category:'pac_air_eau',...}]
 */
function parseEquipments(typeContrat) {
  if (!typeContrat || typeof typeContrat !== 'string') return [];
  const result = [];
  // Séparer par + ou /
  const parts = typeContrat.split(/\s*[+\/]\s*/);

  for (let part of parts) {
    part = part.trim().toUpperCase();
    if (!part) continue;

    // Détecter multiplicateur (X2, X3, etc.)
    let multiplier = 1;
    const multMatch = part.match(/\s*X\s*(\d+)\s*$/);
    if (multMatch) {
      multiplier = parseInt(multMatch[1], 10);
      part = part.replace(/\s*X\s*\d+\s*$/, '').trim();
    }

    // Chercher le mot-clé correspondant
    let found = false;
    for (const mapping of EQUIPMENT_KEYWORDS) {
      for (const kw of mapping.keywords) {
        if (part.includes(kw) || part === kw) {
          for (let i = 0; i < multiplier; i++) {
            result.push({ category: mapping.category, label: mapping.label });
          }
          found = true;
          break;
        }
      }
      if (found) break;
    }

    // Si pas trouvé, créer un stub "autre"
    if (!found && part.length > 1) {
      for (let i = 0; i < multiplier; i++) {
        result.push({ category: 'autre', label: part });
      }
    }
  }

  return result;
}

// ============================================================================
// LECTURE EXCEL
// ============================================================================

console.log('📖 Lecture du fichier Excel...');
const wb = XLSX.readFile(EXCEL_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: null });
console.log(`   ${rows.length} lignes lues`);

// ============================================================================
// TRAITEMENT DES DONNÉES
// ============================================================================

console.log('🔧 Traitement des données...');

const clients = [];
const contracts = [];
const equipments = [];

let statsEmail = { total: 0, nullified: 0 };
let statsContracts = { ouvert: 0, clos: 0, sans: 0 };
let statsEquipments = { total: 0, autre: 0 };

for (const row of rows) {
  const clientId = randomUUID();
  const projectId = randomUUID();

  // --- Client ---
  const display = row['Display'] || '';
  const nom = row['Nom'] || null;
  const prenom = row['Prénom'] || null;  // Note: accent possible
  const firstName = prenom || (row['Prenom'] || null); // Try both
  const civiliteType = row['Civilité/Type'] || row['Civilite/Type'] || 'Particulier';
  const phone = row['Téléphone'] || row['Telephone'] || null;
  const phone2 = row['Téléphone 2'] || row['Telephone 2'] || null;
  const adresse = row['Adresse'] || null;
  const cp = row['Code Postal'] || null;
  const ville = row['Ville'] || null;
  let email = row['Email'] || null;
  const siren = row['Siren'] || row['SIREN'] || null;
  const tva = row['Numéro TVA'] || row['Numero TVA'] || null;
  const sources = row['Sources'] || null;

  // xxx@gmail.com → NULL
  if (email && typeof email === 'string' && email.toLowerCase().includes('xxx@gmail.com')) {
    email = null;
    statsEmail.nullified++;
  }
  if (email) statsEmail.total++;

  // Client category
  const catRaw = String(civiliteType).trim().toLowerCase();
  const clientCategory = (catRaw === 'entreprise' || catRaw === 'collectivité' || catRaw === 'collectivite')
    ? 'entreprise' : 'particulier';

  // Company name pour entreprises
  const companyName = clientCategory === 'entreprise' ? display : null;

  // Internal notes (TVA)
  const internalNotes = tva ? `TVA: ${tva}` : null;

  // Postal code normalization (peut être un nombre)
  const postalCode = cp ? String(cp).padStart(5, '0') : null;

  clients.push({
    id: clientId,
    projectId,
    orgId: ORG_ID,
    displayName: display,
    firstName: firstName,
    lastName: nom,
    companyName,
    email,
    phone: phone ? String(phone) : null,
    phoneSecondary: phone2 ? String(phone2) : null,
    address: adresse,
    postalCode,
    city: ville,
    clientCategory,
    siren: siren ? String(siren) : null,
    internalNotes,
    leadSource: sources,
    importSource: 'excel_import_2026',
  });

  // --- Contrat ---
  const contratEntretien = row['Contrat Entretien'] || '';
  const contratStatus = String(contratEntretien).trim();

  if (contratStatus === 'Ouvert' || contratStatus === 'Clos') {
    const contractId = randomUUID();
    const tarif = row['Tarif Contrat'] || null;
    const debutRaw = row['Début Contrat'] || row['Debut Contrat'] || null;
    const typeContrat = row['Type Contrat'] || null;

    // Conversion date
    const startDate = excelSerialToISO(debutRaw);
    const nextMaintenance = startDate ? computeNextMaintenance(startDate) : null;

    const status = contratStatus === 'Ouvert' ? 'active' : 'expired';
    if (status === 'active') statsContracts.ouvert++;
    else statsContracts.clos++;

    contracts.push({
      id: contractId,
      orgId: ORG_ID,
      clientId,
      status,
      frequency: 'annuel',
      startDate,
      amount: tarif,
      notes: typeContrat ? String(typeContrat).trim() : null,
      nextMaintenanceDate: nextMaintenance,
    });

    // --- Équipements (stubs depuis Type Contrat) ---
    if (typeContrat) {
      const eqs = parseEquipments(String(typeContrat));
      for (const eq of eqs) {
        const eqId = randomUUID();
        equipments.push({
          id: eqId,
          projectId,
          category: eq.category,
          label: eq.label,
          notes: `Import Excel - ${String(typeContrat).trim()}`,
        });
        statsEquipments.total++;
        if (eq.category === 'autre') statsEquipments.autre++;
      }
    }
  } else {
    statsContracts.sans++;
  }
}

console.log(`\n📊 Statistiques :`);
console.log(`   Clients : ${clients.length}`);
console.log(`   Emails valides : ${statsEmail.total}, xxx@gmail.com nullifiés : ${statsEmail.nullified}`);
console.log(`   Contrats : ${contracts.length} (${statsContracts.ouvert} actifs, ${statsContracts.clos} expirés, ${statsContracts.sans} sans contrat)`);
console.log(`   Équipements stubs : ${equipments.length} (${statsEquipments.autre} catégorie "autre")`);

// ============================================================================
// GÉNÉRATION SQL - PURGE
// ============================================================================

console.log('\n📝 Génération _purge.sql...');

const purgeSql = `-- ============================================================================
-- PURGE COMPLÈTE - Mayer Énergie
-- Généré le ${new Date().toISOString()}
-- ============================================================================

-- Pré-nettoyage tables avec FK NO ACTION
DELETE FROM majordhome.service_requests;
DELETE FROM sources.files WHERE project_id IN (SELECT id FROM core.projects WHERE org_id = '${ORG_ID}');

-- Purge principale (CASCADE : clients, client_activities, contracts,
-- contract_equipments, maintenance_visits, equipments, interventions,
-- home_details, dpe_data, conversations, project_access)
DELETE FROM core.projects WHERE org_id = '${ORG_ID}';

-- Reset séquences
ALTER SEQUENCE majordhome.client_number_seq RESTART WITH 1;
ALTER SEQUENCE majordhome.contract_number_seq RESTART WITH 1;

-- Vérification
SELECT 'clients' AS t, COUNT(*) AS n FROM majordhome.clients WHERE org_id = '${ORG_ID}'
UNION ALL SELECT 'contracts', COUNT(*) FROM majordhome.contracts WHERE org_id = '${ORG_ID}'
UNION ALL SELECT 'equipments', COUNT(*) FROM majordhome.equipments WHERE project_id IN (SELECT id FROM core.projects WHERE org_id = '${ORG_ID}')
UNION ALL SELECT 'projects', COUNT(*) FROM core.projects WHERE org_id = '${ORG_ID}';
`;

writeFileSync('_purge.sql', purgeSql, 'utf8');
console.log('   ✅ _purge.sql écrit');

// ============================================================================
// GÉNÉRATION SQL - IMPORT CLIENTS
// ============================================================================

console.log('📝 Génération _import_clients.sql...');

let clientsSql = `-- ============================================================================
-- IMPORT CLIENTS - ${clients.length} clients
-- Généré le ${new Date().toISOString()}
-- ============================================================================\n\n`;

// D'abord, insérer les core.projects (nécessaire pour FK clients.project_id)
for (let i = 0; i < clients.length; i += BATCH_SIZE) {
  const batch = clients.slice(i, i + BATCH_SIZE);
  clientsSql += `-- Batch projects ${i + 1} à ${i + batch.length}\n`;
  clientsSql += `INSERT INTO core.projects (id, org_id, name, status) VALUES\n`;
  clientsSql += batch.map(c =>
    `(${esc(c.projectId)}, ${esc(c.orgId)}, ${esc(c.displayName || 'Client')}, 'active')`
  ).join(',\n');
  clientsSql += `;\n\n`;
}

// Ensuite, insérer les clients
for (let i = 0; i < clients.length; i += BATCH_SIZE) {
  const batch = clients.slice(i, i + BATCH_SIZE);
  clientsSql += `-- Batch clients ${i + 1} à ${i + batch.length}\n`;
  clientsSql += `INSERT INTO majordhome.clients (id, project_id, org_id, display_name, first_name, last_name, company_name, email, phone, phone_secondary, address, postal_code, city, country, client_category, siren, internal_notes, lead_source, import_source) VALUES\n`;
  clientsSql += batch.map(c =>
    `(${esc(c.id)}, ${esc(c.projectId)}, ${esc(c.orgId)}, ${esc(c.displayName)}, ${esc(c.firstName)}, ${esc(c.lastName)}, ${esc(c.companyName)}, ${esc(c.email)}, ${esc(c.phone)}, ${esc(c.phoneSecondary)}, ${esc(c.address)}, ${esc(c.postalCode)}, ${esc(c.city)}, 'France', ${esc(c.clientCategory)}, ${esc(c.siren)}, ${esc(c.internalNotes)}, ${esc(c.leadSource)}, ${esc(c.importSource)})`
  ).join(',\n');
  clientsSql += `;\n\n`;
}

writeFileSync('_import_clients.sql', clientsSql, 'utf8');
console.log(`   ✅ _import_clients.sql écrit (${clients.length} clients en ${Math.ceil(clients.length / BATCH_SIZE)} batches)`);

// ============================================================================
// GÉNÉRATION SQL - IMPORT CONTRATS + ÉQUIPEMENTS
// ============================================================================

console.log('📝 Génération _import_contracts_equipments.sql...');

let contractsSql = `-- ============================================================================
-- IMPORT CONTRATS + ÉQUIPEMENTS
-- ${contracts.length} contrats, ${equipments.length} équipements
-- Généré le ${new Date().toISOString()}
-- ============================================================================\n\n`;

// Contrats
for (let i = 0; i < contracts.length; i += BATCH_SIZE) {
  const batch = contracts.slice(i, i + BATCH_SIZE);
  contractsSql += `-- Batch contrats ${i + 1} à ${i + batch.length}\n`;
  contractsSql += `INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency, start_date, amount, notes, next_maintenance_date) VALUES\n`;
  contractsSql += batch.map(c =>
    `(${esc(c.id)}, ${esc(c.orgId)}, ${esc(c.clientId)}, ${esc(c.status)}, ${esc(c.frequency)}, ${c.startDate ? esc(c.startDate) : 'NULL'}, ${c.amount !== null && c.amount !== undefined ? c.amount : 'NULL'}, ${esc(c.notes)}, ${c.nextMaintenanceDate ? esc(c.nextMaintenanceDate) : 'NULL'})`
  ).join(',\n');
  contractsSql += `;\n\n`;
}

// Équipements
for (let i = 0; i < equipments.length; i += BATCH_SIZE) {
  const batch = equipments.slice(i, i + BATCH_SIZE);
  contractsSql += `-- Batch équipements ${i + 1} à ${i + batch.length}\n`;
  contractsSql += `INSERT INTO majordhome.equipments (id, project_id, category, brand, model, status, notes) VALUES\n`;
  contractsSql += batch.map(eq =>
    `(${esc(eq.id)}, ${esc(eq.projectId)}, ${esc(eq.category)}, 'À renseigner', 'À renseigner', 'active', ${esc(eq.notes)})`
  ).join(',\n');
  contractsSql += `;\n\n`;
}

writeFileSync('_import_contracts_equipments.sql', contractsSql, 'utf8');
console.log(`   ✅ _import_contracts_equipments.sql écrit (${contracts.length} contrats, ${equipments.length} équipements)`);

// ============================================================================
// GÉNÉRATION SQL INDIVIDUEL PAR BATCH (pour exécution MCP)
// ============================================================================

console.log('\n📝 Génération des batches individuels pour MCP execute_sql...');

// On va aussi écrire un fichier JSON avec tous les batches pour faciliter l'exécution
const batches = [];

// Batch purge
batches.push({
  name: 'purge',
  sql: `DELETE FROM majordhome.service_requests;
DELETE FROM sources.files WHERE project_id IN (SELECT id FROM core.projects WHERE org_id = '${ORG_ID}');
DELETE FROM core.projects WHERE org_id = '${ORG_ID}';
ALTER SEQUENCE majordhome.client_number_seq RESTART WITH 1;
ALTER SEQUENCE majordhome.contract_number_seq RESTART WITH 1;`
});

// Batches projects
for (let i = 0; i < clients.length; i += BATCH_SIZE) {
  const batch = clients.slice(i, i + BATCH_SIZE);
  const sql = `INSERT INTO core.projects (id, org_id, name, status) VALUES\n` +
    batch.map(c => `(${esc(c.projectId)}, ${esc(c.orgId)}, ${esc(c.displayName || 'Client')}, 'active')`).join(',\n') + ';';
  batches.push({ name: `projects_${i + 1}_${i + batch.length}`, sql });
}

// Batches clients
for (let i = 0; i < clients.length; i += BATCH_SIZE) {
  const batch = clients.slice(i, i + BATCH_SIZE);
  const sql = `INSERT INTO majordhome.clients (id, project_id, org_id, display_name, first_name, last_name, company_name, email, phone, phone_secondary, address, postal_code, city, country, client_category, siren, internal_notes, lead_source, import_source) VALUES\n` +
    batch.map(c =>
      `(${esc(c.id)}, ${esc(c.projectId)}, ${esc(c.orgId)}, ${esc(c.displayName)}, ${esc(c.firstName)}, ${esc(c.lastName)}, ${esc(c.companyName)}, ${esc(c.email)}, ${esc(c.phone)}, ${esc(c.phoneSecondary)}, ${esc(c.address)}, ${esc(c.postalCode)}, ${esc(c.city)}, 'France', ${esc(c.clientCategory)}, ${esc(c.siren)}, ${esc(c.internalNotes)}, ${esc(c.leadSource)}, ${esc(c.importSource)})`
    ).join(',\n') + ';';
  batches.push({ name: `clients_${i + 1}_${i + batch.length}`, sql });
}

// Batches contrats
for (let i = 0; i < contracts.length; i += BATCH_SIZE) {
  const batch = contracts.slice(i, i + BATCH_SIZE);
  const sql = `INSERT INTO majordhome.contracts (id, org_id, client_id, status, frequency, start_date, amount, notes, next_maintenance_date) VALUES\n` +
    batch.map(c =>
      `(${esc(c.id)}, ${esc(c.orgId)}, ${esc(c.clientId)}, ${esc(c.status)}, ${esc(c.frequency)}, ${c.startDate ? esc(c.startDate) : 'NULL'}, ${c.amount !== null && c.amount !== undefined ? c.amount : 'NULL'}, ${esc(c.notes)}, ${c.nextMaintenanceDate ? esc(c.nextMaintenanceDate) : 'NULL'})`
    ).join(',\n') + ';';
  batches.push({ name: `contracts_${i + 1}_${i + batch.length}`, sql });
}

// Batches équipements
for (let i = 0; i < equipments.length; i += BATCH_SIZE) {
  const batch = equipments.slice(i, i + BATCH_SIZE);
  const sql = `INSERT INTO majordhome.equipments (id, project_id, category, brand, model, status, notes) VALUES\n` +
    batch.map(eq =>
      `(${esc(eq.id)}, ${esc(eq.projectId)}, ${esc(eq.category)}, 'À renseigner', 'À renseigner', 'active', ${esc(eq.notes)})`
    ).join(',\n') + ';';
  batches.push({ name: `equipments_${i + 1}_${i + batch.length}`, sql });
}

writeFileSync('_import_batches.json', JSON.stringify(batches, null, 2), 'utf8');
console.log(`   ✅ _import_batches.json écrit (${batches.length} batches)`);

console.log('\n✅ Terminé ! Fichiers générés :');
console.log('   - _purge.sql');
console.log('   - _import_clients.sql');
console.log('   - _import_contracts_equipments.sql');
console.log('   - _import_batches.json (pour exécution MCP batch par batch)');
