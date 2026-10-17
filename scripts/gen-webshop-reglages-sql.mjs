// scripts/gen-webshop-reglages-sql.mjs
// Émet majordhome.webshop_reglages_defaut() depuis WEBSHOP_REGLAGES_DEFAUT (module JS = source unique).
// Lancement : node scripts/gen-webshop-reglages-sql.mjs  → coller la sortie dans la migration.
import { WEBSHOP_REGLAGES_DEFAUT } from '../src/lib/webshop/reglages.js';

const json = JSON.stringify(WEBSHOP_REGLAGES_DEFAUT);
if (json.includes('$defaut$')) throw new Error('délimiteur $defaut$ présent dans les défauts');

console.log(`-- GÉNÉRÉ par scripts/gen-webshop-reglages-sql.mjs depuis src/lib/webshop/reglages.js — ne pas éditer à la main.
CREATE OR REPLACE FUNCTION majordhome.webshop_reglages_defaut()
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO ''
AS $f$
  SELECT $defaut$${json}$defaut$::jsonb;
$f$;
REVOKE EXECUTE ON FUNCTION majordhome.webshop_reglages_defaut() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION majordhome.webshop_reglages_defaut() TO service_role;`);
