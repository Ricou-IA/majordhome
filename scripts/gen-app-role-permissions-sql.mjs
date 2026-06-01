// scripts/gen-app-role-permissions-sql.mjs
// Émet le SQL de seed app_role_permissions depuis le registre (registre = source unique).
// Lancement : node scripts/gen-app-role-permissions-sql.mjs
import { iterAppDefaults } from '../src/lib/permissionsRegistry.js';

const rows = [...iterAppDefaults()]
  .map((r) => `  ('${r.role}','${r.resource}','${r.action}',${r.allowed})`)
  .join(',\n');

console.log(`INSERT INTO majordhome.app_role_permissions (role, resource, action, allowed) VALUES
${rows}
ON CONFLICT (role, resource, action) DO UPDATE SET allowed = EXCLUDED.allowed;`);
