// scripts/tournee/sync-engine.test.mjs
// Les copies Deno du moteur (supabase/functions/_shared/tournee) doivent être
// identiques à leur source (src/lib) — sinon l'edge slots-propose calcule
// autre chose que l'écran, en silence.
// Run : node --test scripts/tournee/sync-engine.test.mjs   (dans npm run audit:quality)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { FICHIERS, transformer } from '../sync-tournee-engine.mjs';

test('chaque copie _shared/tournee est à jour (sinon : npm run sync:tournee-engine)', () => {
  for (const { source, cible } of FICHIERS) {
    assert.ok(existsSync(cible), `copie manquante : ${cible} — lancer npm run sync:tournee-engine`);
    // Comparaison insensible aux fins de ligne : la copie est écrite en LF, mais un
    // checkout Windows (autocrlf) peut la relivrer en CRLF sans qu'elle ait divergé.
    assert.equal(
      readFileSync(cible, 'utf8').replace(/\r\n/g, '\n'),
      transformer(source, readFileSync(source, 'utf8')),
      `copie périmée : ${cible} — lancer npm run sync:tournee-engine`,
    );
  }
});

test('aucune copie n importe un alias Vite (@…) : elles doivent tourner sous Deno', () => {
  for (const { cible } of FICHIERS) {
    if (!existsSync(cible)) continue;
    const contenu = readFileSync(cible, 'utf8');
    assert.ok(!/from ['"]@/.test(contenu), `${cible} importe un alias Vite`);
  }
});
