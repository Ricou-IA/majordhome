import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const DATA = 'src/apps/thermique/data';

test('tous les JSON de data parsent et portent _meta.source + license', () => {
  for (const f of readdirSync(DATA).filter((f) => f.endsWith('.json'))) {
    const d = JSON.parse(readFileSync(`${DATA}/${f}`, 'utf8'));
    assert.ok(d._meta?.source, `${f}: _meta.source manquant`);
    assert.ok(d._meta?.license, `${f}: _meta.license manquant`);
  }
});

test('tarifs énergie renseignés (pas de 0 restant)', () => {
  const d = JSON.parse(readFileSync(`${DATA}/tarifs-energie.json`, 'utf8'));
  assert.ok(d.tarifs.length >= 4);
  for (const t of d.tarifs) assert.ok((t.prixKwh ?? t.prixUnite) > 0.01, `${t.id} non renseigné`);
});
