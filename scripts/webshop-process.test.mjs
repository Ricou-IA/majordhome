// node --test scripts/webshop-process.test.mjs — process du webshop (actions par envoi), module pur
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  envoisDeCommande, actionsPourTransition, actionsPourTournee, variablesCommande, cleAction,
} from '../src/lib/webshop/process.js';
import { buildWebshopConfig } from '../src/lib/webshop/reglages.js';
import {
  WEBSHOP_EMAIL_KEYS, WEBSHOP_EMAIL_DEFAULTS, WEBSHOP_EMAIL_PLACEHOLDERS,
} from '../src/lib/webshop/emailTemplates.js';

const CFG = buildWebshopConfig(null);
const colis = { name: 'Granulés 15 kg', qty: 2, unitCents: 650, totalCents: 1300, shippingKind: 'parcel' };
const palette = { name: 'Palette granulés', qty: 1, unitCents: 39000, totalCents: 39000, shippingKind: 'pallet' };
const horsBoutique = { name: 'Ancien produit', qty: 1, unitCents: 100, totalCents: 100, shippingKind: null };
const order = (o = {}) => ({ id: 'o1', order_number: 'WS-001', status: 'confirmee', paid_at: '2026-10-01T10:00:00Z', ...o });

test('envoisDeCommande : colis / palette, hors boutique ignoré', () => {
  const e = envoisDeCommande([colis, palette, horsBoutique]);
  assert.deepEqual(e.colis, [colis]);
  assert.deepEqual(e.palette, [palette]);
  assert.deepEqual(envoisDeCommande(null), { colis: [], palette: [] });
});

test('colis seul : expédiée → e-mail expédition colis ; confirmée → rien', () => {
  assert.deepEqual(actionsPourTransition(CFG, order(), [colis], 'expediee'), [
    { envoi: 'colis', evenement: 'expediee', action: 'email_client', gabarit: 'webshop_expedition_colis' },
  ]);
  assert.deepEqual(actionsPourTransition(CFG, order(), [colis], 'confirmee'), []);
  assert.deepEqual(actionsPourTransition(CFG, order(), [colis], 'annulee'), []);
});

test('palette seule : une transition ne déclenche rien', () => {
  assert.deepEqual(actionsPourTransition(CFG, order(), [palette], 'expediee'), []);
  assert.deepEqual(actionsPourTransition(CFG, order(), [palette], 'livree'), []);
});

test('mixte : 1 action colis, et ITEMS ne parle que des colis', () => {
  const lines = [colis, palette];
  assert.deepEqual(actionsPourTransition(CFG, order(), lines, 'expediee'), [
    { envoi: 'colis', evenement: 'expediee', action: 'email_client', gabarit: 'webshop_expedition_colis' },
  ]);
  const v = variablesCommande({ order: order(), lines, envoi: 'colis' });
  assert.ok(v['{{ITEMS}}'].includes('Granulés 15 kg'));
  assert.ok(!v['{{ITEMS}}'].includes('Palette granulés'));
  const vp = variablesCommande({ order: order(), lines, envoi: 'palette' });
  assert.ok(vp['{{ITEMS}}'].includes('Palette granulés'));
  assert.ok(!vp['{{ITEMS}}'].includes('Granulés 15 kg'));
});

test('ordre colis réglé sur transmise_fournisseur : gabarit webshop_ordre_colis', () => {
  const cfg = buildWebshopConfig({ webshop: { process: { transitions: {
    transmise_fournisseur: { email_client: 'webshop_confirmation', ordre_colis: true },
  } } } });
  assert.deepEqual(actionsPourTransition(cfg, order(), [colis], 'transmise_fournisseur'), [
    { envoi: 'colis', evenement: 'transmise_fournisseur', action: 'email_client', gabarit: 'webshop_confirmation' },
    { envoi: 'colis', evenement: 'transmise_fournisseur', action: 'ordre_colis', gabarit: 'webshop_ordre_colis' },
  ]);
  const seul = buildWebshopConfig({ webshop: { process: { transitions: {
    transmise_fournisseur: { ordre_colis: true },
  } } } });
  assert.deepEqual(actionsPourTransition(seul, order(), [colis], 'transmise_fournisseur'), [
    { envoi: 'colis', evenement: 'transmise_fournisseur', action: 'ordre_colis', gabarit: 'webshop_ordre_colis' },
  ]);
  // Pas de ligne colis : rien, même avec un ordre colis réglé.
  assert.deepEqual(actionsPourTransition(cfg, order(), [palette], 'transmise_fournisseur'), []);
});

test('tournée partie : palette payée confirmée → action + statut expédiée', () => {
  assert.deepEqual(actionsPourTournee(CFG, order(), [palette], 'partie'), {
    actions: [{ envoi: 'palette', evenement: 'tournee_partie', action: 'email_client', gabarit: 'webshop_expedition_palette' }],
    statutCible: 'expediee',
  });
  assert.deepEqual(actionsPourTournee(CFG, order({ status: 'expediee' }), [palette], 'livree'), {
    actions: [{ envoi: 'palette', evenement: 'tournee_livree', action: 'email_client', gabarit: 'webshop_livraison_palette' }],
    statutCible: 'livree',
  });
});

test('tournée partie : mixte → action, jamais de déplacement', () => {
  const r = actionsPourTournee(CFG, order(), [colis, palette], 'partie');
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].evenement, 'tournee_partie');
  assert.equal(r.statutCible, null);
});

test('tournée : non payée ou annulée → rien', () => {
  const vide = { actions: [], statutCible: null };
  assert.deepEqual(actionsPourTournee(CFG, order({ paid_at: null }), [palette], 'partie'), vide);
  assert.deepEqual(actionsPourTournee(CFG, order({ status: 'annulee' }), [palette], 'partie'), vide);
  assert.deepEqual(actionsPourTournee(CFG, order(), [palette], 'inconnu'), vide);
});

test('tournée : jamais de retour en arrière (déjà livrée + partie)', () => {
  const r = actionsPourTournee(CFG, order({ status: 'livree' }), [palette], 'partie');
  assert.equal(r.statutCible, null);
  assert.equal(r.actions.length, 1);
  assert.equal(actionsPourTournee(CFG, order({ status: 'livree' }), [palette], 'livree').statutCible, null);
});

test('tournée : gabarit retiré → pas d action, statut quand même', () => {
  const cfg = buildWebshopConfig({ webshop: { process: { tournee: { partie: { email_client: null } } } } });
  assert.deepEqual(actionsPourTournee(cfg, order(), [palette], 'partie'), { actions: [], statutCible: 'expediee' });
});

test('cleAction : stable et distincte', () => {
  const base = { orderId: 'o1', envoi: 'colis', evenement: 'expediee', action: 'email_client' };
  assert.equal(cleAction(base), cleAction({ ...base }));
  const autres = [
    { ...base, envoi: 'palette' }, { ...base, evenement: 'livree' }, { ...base, action: 'ordre_colis' }, { ...base, orderId: 'o2' },
  ].map(cleAction);
  assert.equal(new Set([cleAction(base), ...autres]).size, 5);
});

test('variablesCommande : échappe le HTML d un nom de produit', () => {
  const l = { ...colis, name: '<script>alert(1)</script>' };
  const v = variablesCommande({ order: order({ first_name: 'A&B' }), lines: [l], envoi: 'colis' });
  assert.ok(!v['{{ITEMS}}'].includes('<script>'));
  assert.ok(v['{{ITEMS}}'].includes('&lt;script&gt;'));
  assert.equal(v['{{CLIENT_NAME}}'], 'A&amp;B');
});

test('variablesCommande : client, adresse, date FR, montants, branding, ordre colis', () => {
  const o = order({
    first_name: 'Jean', last_name: 'Dupont', email: 'j@d.fr', phone: '0601020304',
    address: '1 rue X', postal_code: '81600', city: 'Gaillac', delivery_date: '2026-11-04',
  });
  const v = variablesCommande({
    order: o, lines: [{ ...colis, weightKg: 15 }], envoi: 'colis',
    company: { name: 'Mayer', email: 'c@m.fr', phone: '05' }, depot: { code: 'c', libelle: 'Dépôt C', adresse: 'Rue du dépôt' },
  });
  assert.equal(v['{{CLIENT_NAME}}'], 'Jean Dupont');
  assert.equal(v['{{ORDER_NUMBER}}'], 'WS-001');
  assert.equal(v['{{DELIVERY_ADDRESS}}'], '1 rue X, 81600 Gaillac');
  assert.equal(v['{{BRAND_NAME}}'], 'Mayer');
  assert.equal(v['{{ORG_EMAIL}}'], 'c@m.fr');
  assert.equal(v['{{ORG_PHONE}}'], '05');
  assert.equal(v['{{DEPOT_NAME}}'], 'Dépôt C');
  assert.equal(v['{{DEPOT_ADDRESS}}'], 'Rue du dépôt');
  assert.equal(v['{{TOTAL_WEIGHT}}'], '30 kg');
  assert.ok(v['{{DECLARED_VALUE}}'].startsWith('13'));
  assert.ok(v['{{DECLARED_VALUE}}'].endsWith('€'));
  assert.ok(v['{{PARCELS_TABLE}}'].startsWith('<table'));
  assert.equal(v['{{CLIENT_EMAIL}}'], 'j@d.fr');
  assert.equal(v['{{CLIENT_PHONE}}'], '0601020304');
  // Date de livraison : seulement pour l'envoi palette (le colis n'a pas de date connue).
  assert.equal(v['{{DELIVERY_DATE}}'], '');
  const vp = variablesCommande({ order: o, lines: [palette], envoi: 'palette' });
  assert.equal(vp['{{DELIVERY_DATE}}'], 'mercredi 4 novembre 2026');
  const vs = variablesCommande({ order: o, lines: [palette], envoi: 'palette', slot: { date: '2026-11-06' } });
  assert.equal(vs['{{DELIVERY_DATE}}'], 'vendredi 6 novembre 2026');
  // Poids inconnu → dit, jamais 0 kg.
  assert.equal(variablesCommande({ order: o, lines: [colis], envoi: 'colis' })['{{TOTAL_WEIGHT}}'], 'non renseigné');
  // Retrait : l'adresse de livraison nomme le point.
  const vr = variablesCommande({ order: order({ parcel_delivery_mode: 'pickup', pickup_point_name: 'Relais <A>' }), lines: [colis], envoi: 'colis' });
  assert.equal(vr['{{PICKUP_POINT}}'], 'Relais &lt;A&gt;');
  assert.equal(vr['{{DELIVERY_ADDRESS}}'], 'Relais &lt;A&gt;', 'jamais « Retrait : » dans l adresse');
});

test('variablesCommande : chaque placeholder déclaré a une valeur (sauf feuille de route, rendue par le site)', () => {
  const v = variablesCommande({ order: order(), lines: [colis], envoi: 'colis' });
  for (const key of WEBSHOP_EMAIL_KEYS) {
    if (key === 'webshop_feuille_route') continue;
    for (const ph of WEBSHOP_EMAIL_PLACEHOLDERS[key]) assert.equal(typeof v[ph], 'string', `${key} ${ph}`);
  }
});

test('gabarits par défaut : complets, transactionnels, placeholders déclarés', () => {
  assert.deepEqual(WEBSHOP_EMAIL_KEYS, [
    'webshop_confirmation', 'webshop_expedition_colis', 'webshop_livraison_colis', 'webshop_expedition_palette',
    'webshop_livraison_palette', 'webshop_feuille_route', 'webshop_ordre_colis',
  ]);
  for (const key of WEBSHOP_EMAIL_KEYS) {
    const t = WEBSHOP_EMAIL_DEFAULTS[key];
    assert.equal(t.key, key);
    assert.equal(t.is_transactional, true);
    assert.ok(t.label && t.subject && t.html_body);
    assert.ok(['client', 'transporteur', 'prestataire'].includes(t.destinataire));
    assert.ok(!/<html|<body/i.test(t.html_body), `${key} : corps habillé par le squelette d org`);
    const utilises = new Set((t.subject + t.html_body).match(/\{\{[A-Z_]+\}\}/g));
    for (const ph of utilises) assert.ok(WEBSHOP_EMAIL_PLACEHOLDERS[key].includes(ph), `${key} utilise ${ph} non déclaré`);
  }
  assert.equal(WEBSHOP_EMAIL_DEFAULTS.webshop_feuille_route.destinataire, 'transporteur');
  assert.equal(WEBSHOP_EMAIL_DEFAULTS.webshop_ordre_colis.destinataire, 'prestataire');
  assert.ok(WEBSHOP_EMAIL_PLACEHOLDERS.webshop_ordre_colis.includes('{{PARCELS_TABLE}}'));
  assert.ok(WEBSHOP_EMAIL_PLACEHOLDERS.webshop_feuille_route.includes('{{ITINERAIRE_URL}}'));
  assert.ok(Object.isFrozen(WEBSHOP_EMAIL_DEFAULTS.webshop_confirmation));
});

test('les clés de gabarit des réglages viennent de la même source', async () => {
  const reglages = await import('../src/lib/webshop/reglages.js');
  assert.equal(reglages.WEBSHOP_EMAIL_KEYS, WEBSHOP_EMAIL_KEYS);
});

test('colis en retrait : aucune action colis (ni ordre au prestataire, ni e-mail « colis en route »)', () => {
  const cfg = buildWebshopConfig({ webshop: { process: { transitions: {
    confirmee: { email_client: 'webshop_confirmation', ordre_colis: true },
    transmise_fournisseur: { email_client: null, ordre_colis: true },
    expediee: { email_client: 'webshop_expedition_colis', ordre_colis: true },
    livree: { email_client: 'webshop_livraison_colis', ordre_colis: false },
  } } } });
  const retrait = order({ parcel_delivery_mode: 'pickup', pickup_point_name: 'Dépôt' });
  for (const to of ['confirmee', 'transmise_fournisseur', 'expediee', 'livree']) {
    assert.deepEqual(actionsPourTransition(cfg, retrait, [colis], to), [], to);
    assert.deepEqual(actionsPourTransition(cfg, retrait, [colis, palette], to), [], `${to} mixte`);
  }
  // Témoin : même réglage, colis livré → l'ordre colis part.
  assert.equal(actionsPourTransition(cfg, order({ parcel_delivery_mode: 'delivery' }), [colis], 'expediee').length, 2);
  // Retrait des PALETTES seulement : les colis livrés gardent leurs actions.
  assert.equal(actionsPourTransition(cfg, order({ pallet_delivery_mode: 'pickup', parcel_delivery_mode: 'delivery' }), [colis, palette], 'expediee').length, 2);
});

test('{{DELIVERY_LINE}} : ligne entière, vide si rien à dire, jamais « Livraison : Retrait : »', () => {
  const adr = { address: '1 rue X', postal_code: '81600', city: 'Gaillac' };
  assert.equal(variablesCommande({ order: order(adr), lines: [colis], envoi: 'colis' })['{{DELIVERY_LINE}}'],
    '<p>Livraison : 1 rue X, 81600 Gaillac</p>');
  assert.equal(variablesCommande({ order: order({ ...adr, pallet_delivery_mode: 'pickup', pickup_point_name: 'Relais <A>' }), lines: [palette], envoi: 'palette' })['{{DELIVERY_LINE}}'],
    '<p>Retrait : Relais &lt;A&gt;</p>');
  assert.equal(variablesCommande({ order: order({ pallet_delivery_mode: 'pickup' }), lines: [palette], envoi: 'palette' })['{{DELIVERY_LINE}}'], '');
  assert.equal(variablesCommande({ order: order(), lines: [colis], envoi: 'colis' })['{{DELIVERY_LINE}}'], '');
  // Proposée aux seuls e-mails du process (rendus par l'edge) ; la confirmation, rendue par le site, ne la remplit pas.
  assert.ok(WEBSHOP_EMAIL_PLACEHOLDERS.webshop_expedition_palette.includes('{{DELIVERY_LINE}}'));
  assert.ok(!WEBSHOP_EMAIL_PLACEHOLDERS.webshop_confirmation.includes('{{DELIVERY_LINE}}'));
});

test('gabarits par défaut : libellés justes (palette « en route », pas de « Livraison : » orphelin)', () => {
  const pal = WEBSHOP_EMAIL_DEFAULTS.webshop_expedition_palette;
  assert.doesNotMatch(pal.subject + pal.html_body, /aujourd/i);
  assert.match(pal.subject, /en route/);
  for (const key of WEBSHOP_EMAIL_KEYS) {
    const t = WEBSHOP_EMAIL_DEFAULTS[key];
    assert.doesNotMatch(t.html_body, /Livraison : \{\{/, `${key} : « Livraison : » devant une variable qui peut être vide`);
  }
  assert.ok(WEBSHOP_EMAIL_DEFAULTS.webshop_expedition_colis.html_body.includes('{{DELIVERY_LINE}}'));
  assert.ok(pal.html_body.includes('{{DELIVERY_LINE}}'));
});

test('feuille de route par défaut : arrêts, dépôt, km et emplacements (objet compris)', () => {
  const t = WEBSHOP_EMAIL_DEFAULTS.webshop_feuille_route;
  for (const ph of ['{{ARRETS}}', '{{DEPOT}}', '{{KM_ESTIMES}}', '{{NB_EMPLACEMENTS}}']) {
    assert.ok(WEBSHOP_EMAIL_PLACEHOLDERS.webshop_feuille_route.includes(ph), `${ph} non déclaré`);
    assert.ok(t.html_body.includes(ph), `${ph} absent du corps`);
  }
  assert.ok(t.subject.includes('{{NB_EMPLACEMENTS}}'));
  assert.ok(t.subject.includes('{{NB_ARRETS}}'));
});
