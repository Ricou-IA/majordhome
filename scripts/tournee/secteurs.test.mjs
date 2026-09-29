// scripts/tournee/secteurs.test.mjs — grands secteurs côté serveur + populations injectables
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { secteursDepuisContrats, normaliserSecteur } from '../../src/lib/tournee/secteurs.js';
import { chargerPopulations } from '../../src/lib/tournee/populations.js';

test('normaliserSecteur : casse et espaces', () => {
  assert.equal(normaliserSecteur('ALBI'), 'Albi');
  assert.equal(normaliserSecteur('  albi '), 'Albi');
  assert.equal(normaliserSecteur('cordes sur ciel'), 'Cordes Sur Ciel');
  assert.equal(normaliserSecteur("L'UNION"), "L'Union");
  assert.equal(normaliserSecteur('SAINT-SULPICE'), 'Saint-Sulpice');
  assert.equal(normaliserSecteur(null), '');
});

const contrat = (id, clientId, cp, city, lat, lng, status = null) => ({
  id, client_id: clientId, client_postal_code: cp, client_city: city, client_latitude: lat, client_longitude: lng, current_year_visit_status: status,
});

test('secteursDepuisContrats : regroupe par CP, nomme par la ville la plus peuplée, maps par client et par CP', () => {
  const contrats = [
    contrat('c1', 'k1', '81000', 'ALBI', 43.93, 2.15),
    contrat('c2', 'k2', '81990', 'LE SEQUESTRE', 43.90, 2.17),
    contrat('c3', 'k3', '81600', 'GAILLAC', 43.90, 1.75), // ~32 km d'Albi : secteur distinct
    contrat('c4', 'k4', '81600', 'Gaillac', 43.91, 1.74, 'completed'),
  ];
  const pops = new Map([['albi', 50000], ['le sequestre', 1800], ['gaillac', 15000]]);
  const { secteurs, byClient, byCp } = secteursDepuisContrats(contrats, { cityPopulation: pops });
  assert.ok(secteurs.length >= 2);
  assert.equal(byClient.get('k1'), 'Albi');
  assert.equal(byClient.get('k2'), 'Albi', 'Le Séquestre est à moins de 15 km d’Albi');
  assert.equal(byClient.get('k3'), 'Gaillac');
  assert.equal(byCp.get('81600'), 'Gaillac');
  assert.ok([...byClient.values()].every((n) => n === normaliserSecteur(n)), 'noms normalisés');
});

test('secteursDepuisContrats : les contrats sans coordonnées ne polluent pas les maps', () => {
  const { byClient, byCp } = secteursDepuisContrats([contrat('c1', 'k1', null, null, null, null)], { cityPopulation: new Map() });
  assert.equal(byClient.has('k1'), false);
  assert.equal(byCp.size, 0);
});

test('chargerPopulations : fetch injecté, dédoublonnage des CP, erreur réseau ignorée', async () => {
  const appels = [];
  const fetchImpl = async (url) => {
    appels.push(url);
    if (url.includes('81000')) return { ok: true, json: async () => [{ nom: 'Albi', population: 49000 }, { nom: 'Albi', population: 51000 }] };
    if (url.includes('81600')) throw new Error('réseau');
    return { ok: false };
  };
  const pops = await chargerPopulations(['81000', '81000', '81600', 'abc', '81990'], { fetchImpl });
  assert.equal(appels.length, 3, 'un appel par CP valide distinct');
  assert.equal(pops.get('albi'), 51000, 'population max retenue');
  assert.equal(pops.size, 1);
});
