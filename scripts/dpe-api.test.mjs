// scripts/dpe-api.test.mjs
// Tests du module d'investigation bâtiment (src/lib/dpeApi.js) — runner natif Node.
// Run : node --test scripts/dpe-api.test.mjs
// Aucun appel réseau : `fetchImpl` est stubbé. Les payloads reproduisent la forme
// réelle des réponses BAN et ADEME DPE (relevées le 2026-08-12 sur Gaillac).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAddressQuery,
  parseBanFeature,
  mapDpeRecord,
  buildHeatLossBreakdown,
  buildCostBreakdown,
  assessMatch,
  toClientPatch,
  isDpeExpired,
  investigateAddress,
  fetchDpeNearby,
  fetchDpeByBanId,
  BAN_LOW_CONFIDENCE_SCORE,
  MAX_RECORDS,
  MAX_NEARBY_RECORDS,
} from '../src/lib/dpeApi.js';

// --- Fixtures inspirées des réponses réelles -------------------------------

const BAN_FEATURE = {
  properties: { id: '81099_1030_00003', label: '3 Rue Gaubil 81600 Gaillac', score: 0.963 },
  geometry: { coordinates: [1.895314, 43.901396] },
};

const DPE_ROW = {
  numero_dpe: '2681E0059280I',
  adresse_ban: '3 Rue Gaubil 81600 Gaillac',
  identifiant_ban: '81099_1030_00003',
  etiquette_dpe: 'E',
  type_generateur_chauffage_principal: 'PAC air/air installée à partir de 2015',
  type_energie_principale_chauffage: 'Électricité',
  surface_habitable_logement: 71,
  qualite_isolation_murs: 'insuffisante',
  date_etablissement_dpe: '2026-01-09',
  date_fin_validite_dpe: '2036-01-08',
};

/** fetch stubbé : route sur l'URL, renvoie le payload configuré. */
function stubFetch({ ban = { features: [BAN_FEATURE] }, byBanId, nearby }) {
  const calls = [];
  const impl = async (url) => {
    calls.push(url);
    let body;
    // On route sur `geo_distance` et non sur `identifiant_ban` : ce dernier
    // apparaît AUSSI dans le `select=` des deux requêtes, donc il ne discrimine rien.
    if (url.includes('api-adresse')) body = ban;
    else if (url.includes('geo_distance')) body = nearby;
    else body = byBanId;
    return { ok: true, status: 200, json: async () => body };
  };
  impl.calls = calls;
  return impl;
}

// --- buildAddressQuery -----------------------------------------------------

test('buildAddressQuery — concatène, normalise les espaces', () => {
  assert.equal(
    buildAddressQuery({ address: '  3 Rue Gaubil ', postalCode: '81600', city: 'Gaillac' }),
    '3 Rue Gaubil 81600 Gaillac'
  );
});

test('buildAddressQuery — tolère les champs manquants', () => {
  assert.equal(buildAddressQuery({ postalCode: '81600', city: 'Gaillac' }), '81600 Gaillac');
});

test('buildAddressQuery — rejette ce qui est trop court pour la BAN', () => {
  assert.equal(buildAddressQuery({ address: 'abc' }), '');
  assert.equal(buildAddressQuery({}), '');
  assert.equal(buildAddressQuery(), '');
  assert.equal(buildAddressQuery({ address: null, city: '  ' }), '');
});

// --- parseBanFeature -------------------------------------------------------

test('parseBanFeature — extrait identifiant, score et coordonnées', () => {
  const p = parseBanFeature(BAN_FEATURE);
  assert.equal(p.banId, '81099_1030_00003');
  assert.equal(p.score, 0.963);
  assert.equal(p.lon, 1.895314);
  assert.equal(p.lat, 43.901396);
});

test('parseBanFeature — null si la géométrie est inutilisable', () => {
  assert.equal(parseBanFeature(null), null);
  assert.equal(parseBanFeature({ properties: { id: 'x' } }), null);
  assert.equal(
    parseBanFeature({ properties: { id: 'x' }, geometry: { coordinates: ['a', 'b'] } }),
    null
  );
});

// --- mapDpeRecord ----------------------------------------------------------

test('mapDpeRecord — mappe les champs présents', () => {
  const r = mapDpeRecord(DPE_ROW);
  assert.equal(r.id, '2681E0059280I');
  assert.equal(r.dpeLabel, 'E');
  assert.equal(r.heatingGenerator, 'PAC air/air installée à partir de 2015');
  assert.equal(r.heatingEnergy, 'Électricité');
  assert.equal(r.surface, 71);
  assert.equal(r.insulationWalls, 'insuffisante');
});

test('mapDpeRecord — champs absents à null, jamais undefined', () => {
  const r = mapDpeRecord({});
  for (const k of ['dpeLabel', 'heatingGenerator', 'surface', 'year', 'distanceM', 'id']) {
    assert.equal(r[k], null, `${k} devrait être null`);
  }
});

test('mapDpeRecord — neutralise les valeurs de remplissage', () => {
  const r = mapDpeRecord({
    etiquette_dpe: '   ',
    type_ventilation: 'non renseigné',
    qualite_isolation_plancher_haut_comble_perdu: 'indéterminé',
    qualite_isolation_murs: 'bonne',
  });
  assert.equal(r.dpeLabel, null);
  assert.equal(r.ventilation, null);
  assert.equal(r.insulationRoof, null);
  assert.equal(r.insulationWalls, 'bonne'); // une vraie valeur passe
});

test('mapDpeRecord — toiture : prend la configuration renseignée', () => {
  assert.equal(
    mapDpeRecord({ qualite_isolation_plancher_haut_comble_perdu: 'très bonne' }).insulationRoof,
    'très bonne'
  );
  assert.equal(
    mapDpeRecord({ qualite_isolation_plancher_haut_toit_terrasse: 'insuffisante' }).insulationRoof,
    'insuffisante'
  );
  // Régression : `isolation_toiture` est un booléen 0/1, il ne doit plus être lu
  // (il s'affichait « Toiture · 1 » dans le panneau).
  assert.equal(mapDpeRecord({ isolation_toiture: 1 }).insulationRoof, null);
});

test('mapDpeRecord — arrondit la distance du repli par proximité', () => {
  assert.equal(mapDpeRecord({ _geo_distance: 12.7 }).distanceM, 13);
  assert.equal(mapDpeRecord({ _geo_distance: 0.0043 }).distanceM, 0);
});

// --- buildHeatLossBreakdown ------------------------------------------------

// Valeurs réelles du DPE 2281E1013231P (client RONCA, Lescure-d'Albigeois)
const RONCA_LOSS = {
  deperditions_enveloppe: 659.4,
  deperditions_murs: 406.2,
  deperditions_renouvellement_air: 93.5,
  deperditions_ponts_thermiques: 51.3,
  deperditions_baies_vitrees: 49.2,
  deperditions_portes: 22.6,
  deperditions_planchers_bas: 18.8,
  deperditions_planchers_hauts: 17.8,
};

test('buildHeatLossBreakdown — trie par poids et calcule les parts', () => {
  const b = buildHeatLossBreakdown(mapDpeRecord(RONCA_LOSS));
  assert.equal(b.length, 7);
  assert.equal(b[0].label, 'Murs');
  assert.ok(Math.abs(b[0].share - 61.6) < 0.1, `murs = ${b[0].share}%`);
  assert.equal(b[6].label, 'Planchers hauts');
  // Les parts somment à 100 % : `deperditions_enveloppe` EST bien le total
  const sum = b.reduce((s, p) => s + p.share, 0);
  assert.ok(Math.abs(sum - 100) < 0.01, `somme = ${sum}`);
});

test('buildHeatLossBreakdown — retombe sur la somme si le total manque', () => {
  const partial = { deperditions_murs: 300, deperditions_portes: 100 };
  const b = buildHeatLossBreakdown(mapDpeRecord(partial));
  assert.equal(b.length, 2);
  assert.equal(b[0].share, 75);
  assert.equal(b[1].share, 25);
});

test('buildHeatLossBreakdown — vide plutôt que NaN quand rien n’est fourni', () => {
  assert.deepEqual(buildHeatLossBreakdown(mapDpeRecord({})), []);
  assert.deepEqual(buildHeatLossBreakdown(null), []);
  // Un total seul, sans aucun poste, ne doit rien produire (division stérile)
  assert.deepEqual(buildHeatLossBreakdown(mapDpeRecord({ deperditions_enveloppe: 500 })), []);
});

test('buildCostBreakdown — trie par montant, ignore les usages nuls', () => {
  const b = buildCostBreakdown(
    mapDpeRecord({ cout_chauffage: 3162.9, cout_ecs: 162.6, cout_refroidissement: 0 })
  );
  assert.deepEqual(
    b.map((x) => x.label),
    ['Chauffage', 'Eau chaude']
  );
  assert.equal(b[0].euros, 3162.9);
});

test('buildCostBreakdown — comble le reliquat pour que la colonne s’additionne', () => {
  // ~2 % des DPE : la somme des 5 usages ne retombe pas sur le total (+22 € vu
  // en prod). Sans ligne « Autres », le client additionne et trouve un trou.
  const b = buildCostBreakdown(
    mapDpeRecord({ cout_total_5_usages: 533, cout_chauffage: 400, cout_ecs: 111 })
  );
  assert.equal(b.at(-1).label, 'Autres');
  assert.equal(b.at(-1).euros, 22);
  assert.equal(b.reduce((s, i) => s + i.euros, 0), 533);
});

test('buildCostBreakdown — pas de ligne « Autres » quand ça tombe juste', () => {
  const b = buildCostBreakdown(
    mapDpeRecord({ cout_total_5_usages: 511, cout_chauffage: 400, cout_ecs: 111 })
  );
  assert.deepEqual(b.map((x) => x.key), ['heating', 'ecs']);
});

// --- assessMatch -----------------------------------------------------------

test('assessMatch — correspondance exacte et bien géocodée', () => {
  const r = mapDpeRecord({ score_ban: 0.958, statut_geocodage: "adresse géocodée ban à l'adresse" });
  assert.deepEqual(assessMatch(r, { matchMode: 'ban_id' }), { level: 'exact', reason: null });
});

test('assessMatch — RONCA : score 0,54 passe, le rattachement est bon', () => {
  // Cas réel : le score ADEME est médiocre mais l'identifiant BAN est identique
  // des deux côtés et l'adresse brute correspond. Le seuil ne doit pas le rejeter.
  const r = mapDpeRecord({ score_ban: 0.54, statut_geocodage: "adresse géocodée ban à l'adresse" });
  assert.equal(assessMatch(r, { matchMode: 'ban_id' }).level, 'exact');
});

test('assessMatch — score ADEME faible : à vérifier', () => {
  // Cas réel : « 11 Impasse de Laborie » rattachée à « 11 Impasse de la Borie »
  const r = mapDpeRecord({ score_ban: 0.29, statut_geocodage: "adresse géocodée ban à l'adresse" });
  const m = assessMatch(r, { matchMode: 'ban_id' });
  assert.equal(m.level, 'a_verifier');
  assert.match(m.reason, /approximative/);
});

test('assessMatch — le repli par proximité est toujours à vérifier', () => {
  const r = mapDpeRecord({ score_ban: 0.99, statut_geocodage: "adresse géocodée ban à l'adresse" });
  assert.equal(assessMatch(r, { matchMode: 'proximity' }).level, 'a_verifier');
});

test('assessMatch — un statut de géocodage autre que « à l’adresse » alerte', () => {
  const r = mapDpeRecord({
    score_ban: 0.9,
    statut_geocodage: 'adresse non géocodée ban car aucune correspondance trouvée',
  });
  assert.equal(assessMatch(r, { matchMode: 'ban_id' }).level, 'a_verifier');
});

test('assessMatch — sans indice de géocodage, on n’invente pas d’alerte', () => {
  assert.equal(assessMatch(mapDpeRecord({}), { matchMode: 'ban_id' }).level, 'exact');
});

test('mapDpeRecord — expose l’adresse écrite par le diagnostiqueur', () => {
  const r = mapDpeRecord({
    adresse_brut: '11 Impasse de Laborie',
    code_postal_brut: '81130',
    nom_commune_brut: 'MAILHOC',
    adresse_ban: '11 Impasse de la Borie 81130 Mailhoc',
  });
  assert.equal(r.rawAddress, '11 Impasse de Laborie 81130 MAILHOC');
  assert.notEqual(r.rawAddress, r.address, 'les deux adresses doivent rester distinctes');
});

// --- toClientPatch ---------------------------------------------------------

test('toClientPatch — renseigne n° DPE, surface et type de logement', () => {
  const patch = toClientPatch(mapDpeRecord({ ...DPE_ROW, type_batiment: 'maison' }));
  assert.deepEqual(patch, { dpeNumber: '2681E0059280I', surface: '71', housingType: 'maison' });
});

test('toClientPatch — n’émet pas les clés absentes du DPE', () => {
  // Un champ manquant ne doit PAS écraser la saisie existante par du vide
  const patch = toClientPatch(mapDpeRecord({ numero_dpe: 'X1' }));
  assert.deepEqual(patch, { dpeNumber: 'X1' });
});

test('toClientPatch — ne devine pas un type hors référentiel DPE', () => {
  const patch = toClientPatch(mapDpeRecord({ type_batiment: 'chateau' }));
  assert.equal(patch.housingType, undefined);
});

test('toClientPatch — ne prend jamais le banId pour un n° DPE', () => {
  // `id` retombe sur le banId comme clé React ; `dpeNumber` doit rester vide
  const record = mapDpeRecord({ identifiant_ban: '81099_1030_00003' });
  assert.equal(record.id, '81099_1030_00003');
  assert.equal(toClientPatch(record).dpeNumber, undefined);
});

test('toClientPatch — tolère l’absence de record', () => {
  assert.deepEqual(toClientPatch(null), {});
});

// --- isDpeExpired ----------------------------------------------------------

test('isDpeExpired — compare à la date de fin de validité', () => {
  const rec = mapDpeRecord(DPE_ROW); // valide jusqu'au 2036-01-08
  assert.equal(isDpeExpired(rec, new Date('2026-08-12')), false);
  assert.equal(isDpeExpired(rec, new Date('2037-01-01')), true);
});

test('isDpeExpired — null si la date manque ou est illisible', () => {
  assert.equal(isDpeExpired(mapDpeRecord({})), null);
  assert.equal(isDpeExpired(mapDpeRecord({ date_fin_validite_dpe: 'n/a' })), null);
});

// --- investigateAddress ----------------------------------------------------

const ADDR = { address: '3 Rue Gaubil', postalCode: '81600', city: 'Gaillac' };

test('investigateAddress — correspondance exacte sur identifiant BAN', async () => {
  const fetchImpl = stubFetch({ byBanId: { total: 3, results: [DPE_ROW, DPE_ROW] } });
  const res = await investigateAddress(ADDR, { fetchImpl });

  assert.equal(res.status, 'ok');
  assert.equal(res.matchMode, 'ban_id');
  assert.equal(res.records.length, 2);
  assert.equal(res.total, 3); // le total API peut dépasser la page rendue
  assert.equal(res.lowConfidence, false);
  assert.equal(res.ban.banId, '81099_1030_00003');
  // Pas de repli déclenché quand la correspondance exacte donne un résultat
  assert.equal(fetchImpl.calls.filter((u) => u.includes('geo_distance')).length, 0);
});

test('investigateAddress — le voisinage n’est JAMAIS cherché sans demande explicite', async () => {
  // Régression : un DPE à 51 m est celui du voisin. Le déclencher tout seul
  // revenait à présenter la maison d'à côté comme « le » résultat du client.
  const fetchImpl = stubFetch({
    byBanId: { total: 0, results: [] },
    nearby: { total: 1, results: [{ ...DPE_ROW, _geo_distance: 51 }] },
  });
  const res = await investigateAddress(ADDR, { fetchImpl });

  assert.equal(res.status, 'no_dpe');
  assert.equal(res.records.length, 0);
  assert.equal(fetchImpl.calls.filter((u) => u.includes('geo_distance')).length, 0);
  assert.ok(res.ban, 'les coordonnées restent exposées pour élargir ensuite');
});

test('fetchDpeNearby — n’impose PAS de tri : data-fair ordonne par distance', async () => {
  // Régression : avec `sort=-date_etablissement_dpe`, le DPE à 79 m
  // n'apparaissait pas dans les 6 premiers (on remontait du 164-290 m).
  // Plafonner les résultats en triant par date fait rater les voisins immédiats.
  let seen = null;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, status: 200, json: async () => ({ total: 0, results: [] }) };
  };
  await fetchDpeNearby(1.46, 43.71, { fetchImpl });

  assert.doesNotMatch(seen, /[?&]sort=/, 'aucun tri ne doit être imposé sur une requête géo');
  assert.match(seen, /geo_distance=/);
});

test('fetchDpeNearby — le plafond voisinage est plus large que celui d’une adresse', async () => {
  let seen = null;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, status: 200, json: async () => ({ total: 0, results: [] }) };
  };
  await fetchDpeNearby(1.46, 43.71, { fetchImpl });
  assert.match(seen, new RegExp(`size=${MAX_NEARBY_RECORDS}`));
  assert.ok(MAX_NEARBY_RECORDS > MAX_RECORDS);
});

test('fetchDpeByBanId — garde le tri par date : à une adresse, le récent prime', async () => {
  let seen = null;
  const fetchImpl = async (url) => {
    seen = url;
    return { ok: true, status: 200, json: async () => ({ total: 0, results: [] }) };
  };
  await fetchDpeByBanId('81144_0097_01432', { fetchImpl });
  assert.match(seen, /sort=-date_etablissement_dpe/);
});

test('fetchDpeNearby — un rayon non numérique ne produit JAMAIS une URL cassée', async () => {
  // Vécu en prod : `onClick={searchNearby}` passait l'événement React comme
  // rayon → `geo_distance=lon,lat,[object Object]` → HTTP 400, présenté à
  // l'utilisateur comme une panne de l'ADEME alors que le bug était chez nous.
  for (const bad of [{ nativeEvent: {} }, 'abc', null, NaN, 0, -50, undefined]) {
    let seen = null;
    const fetchImpl = async (url) => {
      seen = url;
      return { ok: true, status: 200, json: async () => ({ total: 0, results: [] }) };
    };
    await fetchDpeNearby(1.46, 43.71, { radiusM: bad, fetchImpl });
    assert.doesNotMatch(seen, /object|NaN|undefined|null/i, `rayon = ${JSON.stringify(bad)}`);
    assert.match(decodeURIComponent(seen), /geo_distance=1\.46,43\.71,\d+$|geo_distance=1\.46,43\.71,\d+&/);
  }
});

test('investigateAddress — le rayon demandé est bien transmis', async () => {
  const fetchImpl = stubFetch({
    byBanId: { total: 0, results: [] },
    nearby: { total: 0, results: [] },
  });
  await investigateAddress(ADDR, { fetchImpl, includeNearby: true, radiusM: 300 });
  const geoCall = fetchImpl.calls.find((u) => u.includes('geo_distance'));
  assert.match(decodeURIComponent(geoCall), /geo_distance=[\d.]+,[\d.]+,300/);
});

test('investigateAddress — voisinage sur demande : résultat étiqueté proximity', async () => {
  const fetchImpl = stubFetch({
    byBanId: { total: 0, results: [] },
    nearby: { total: 1, results: [{ ...DPE_ROW, _geo_distance: 24.4 }] },
  });
  const res = await investigateAddress(ADDR, { fetchImpl, includeNearby: true });

  assert.equal(res.status, 'ok');
  assert.equal(res.matchMode, 'proximity');
  assert.equal(res.records[0].distanceM, 24);
});

test('investigateAddress — la correspondance exacte prime, même avec includeNearby', async () => {
  const fetchImpl = stubFetch({
    byBanId: { total: 1, results: [DPE_ROW] },
    nearby: { total: 9, results: [] },
  });
  const res = await investigateAddress(ADDR, { fetchImpl, includeNearby: true });

  assert.equal(res.matchMode, 'ban_id');
  assert.equal(fetchImpl.calls.filter((u) => u.includes('geo_distance')).length, 0);
});

test('investigateAddress — no_dpe quand le voisinage demandé ne donne rien non plus', async () => {
  const fetchImpl = stubFetch({
    byBanId: { total: 0, results: [] },
    nearby: { total: 0, results: [] },
  });
  const res = await investigateAddress(ADDR, { fetchImpl, includeNearby: true });

  assert.equal(res.status, 'no_dpe');
  assert.equal(res.records.length, 0);
  assert.ok(res.ban, 'l’adresse géocodée reste exposée pour l’affichage');
});

test('mapDpeRecord — décode _geopoint (« lat,lon », ordre inverse de GeoJSON)', () => {
  const r = mapDpeRecord({ _geopoint: '43.96428302144851,2.1594650455477993' });
  assert.ok(Math.abs(r.lat - 43.964283) < 1e-6);
  assert.ok(Math.abs(r.lon - 2.159465) < 1e-6);
  assert.equal(mapDpeRecord({}).lat, null);
  assert.equal(mapDpeRecord({ _geopoint: 'n/a' }).lon, null);
});

test('investigateAddress — signale une adresse peu fiable sans bloquer', async () => {
  const weak = {
    ...BAN_FEATURE,
    properties: { ...BAN_FEATURE.properties, score: BAN_LOW_CONFIDENCE_SCORE - 0.1 },
  };
  const fetchImpl = stubFetch({
    ban: { features: [weak] },
    byBanId: { total: 1, results: [DPE_ROW] },
  });
  const res = await investigateAddress(ADDR, { fetchImpl });

  assert.equal(res.status, 'ok');
  assert.equal(res.lowConfidence, true);
});

test('investigateAddress — no_address sans appel réseau', async () => {
  const fetchImpl = stubFetch({});
  const res = await investigateAddress({ address: 'x' }, { fetchImpl });

  assert.equal(res.status, 'no_address');
  assert.equal(fetchImpl.calls.length, 0);
});

test('investigateAddress — address_not_found si la BAN ne reconnaît rien', async () => {
  const fetchImpl = stubFetch({ ban: { features: [] } });
  const res = await investigateAddress(ADDR, { fetchImpl });

  assert.equal(res.status, 'address_not_found');
  assert.equal(res.ban, null);
});

test('investigateAddress — une panne réseau ressort en status error, jamais en throw', async () => {
  const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const res = await investigateAddress(ADDR, { fetchImpl });

  assert.equal(res.status, 'error');
  assert.match(res.error, /503/);
  assert.equal(res.records.length, 0);
});

test('investigateAddress — un abort est propagé (annulation React Query)', async () => {
  const fetchImpl = async () => {
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  };
  await assert.rejects(() => investigateAddress(ADDR, { fetchImpl }), /aborted/);
});
