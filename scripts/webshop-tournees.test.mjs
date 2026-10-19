// node --test scripts/webshop-tournees.test.mjs — modèle pur des tournées webshop
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotStatusLabel, clientsAPrevenir, resumeTourneeEvent, peutMarquerPartie, peutMarquerLivree, peutRouvrir, addDaysIso, todayParis, stopKey, moveTargets, buildRouteSheet, itineraryUrl, formatPhoneFR, tourneeErrorMessage, sendPendingLabel,
} from '../src/lib/webshop/tournees.js';
import { buildWebshopConfig, depotParCode } from '../src/lib/webshop/reglages.js';

const cfgDefaut = buildWebshopConfig({});

test('slotStatusLabel précise le motif de fermeture', () => {
  assert.equal(slotStatusLabel({ status: 'open' }), 'Ouverte');
  assert.equal(slotStatusLabel({ status: 'closed', close_reason: 'j_minus_2' }), 'Fermée — délai de fermeture');
  assert.equal(slotStatusLabel({ status: 'cancelled', close_reason: 'manual' }), 'Annulée');
});

test('dates : jour Paris et ajout de jours sans dérive', () => {
  assert.equal(todayParis(new Date('2026-10-13T23:30:00Z')), '2026-10-14');
  assert.equal(addDaysIso('2026-10-24', 2), '2026-10-26'); // passage à l'heure d'hiver
  assert.equal(addDaysIso('2026-12-31', 1), '2027-01-01');
});

test('stopKey : adresse normalisée, sinon adresse, sinon la commande', () => {
  assert.equal(stopKey({ id: 'a', normalized_address: '7b route', address: 'X' }), '7b route');
  assert.equal(stopKey({ id: 'a', address: '7B Route' }), '7b route');
  assert.equal(stopKey({ id: 'a' }), 'order:a');
});

const slots = [
  { id: 's1', sector_id: 'm', delivery_date: '2026-11-02', status: 'open', used_slots: 1, capacity_slots: 10, used_stops: 1, capacity_stops: 10 },
  { id: 's2', sector_id: 'm', delivery_date: '2026-11-16', status: 'open', used_slots: 9, capacity_slots: 10, used_stops: 3, capacity_stops: 10 },
  { id: 's3', sector_id: 'm', delivery_date: '2026-11-30', status: 'closed', used_slots: 2, capacity_slots: 10, used_stops: 5, capacity_stops: 5 },
  { id: 's4', sector_id: 'm', delivery_date: '2026-12-14', status: 'cancelled', used_slots: 0, capacity_slots: 10, used_stops: 0, capacity_stops: 10 },
  { id: 's5', sector_id: 't', delivery_date: '2026-11-03', status: 'open', used_slots: 0, capacity_slots: 10, used_stops: 0, capacity_stops: 10 },
  { id: 's0', sector_id: 'm', delivery_date: '2026-10-12', status: 'closed', used_slots: 0, capacity_slots: 10, used_stops: 0, capacity_stops: 10 },
];

test('moveTargets : même secteur, ni annulée ni passée, ni la tournée actuelle ; capacités signalées', () => {
  const order = { id: 'o', sector_id: 'm', delivery_slot_id: 's1', pallet_slots: 2, normalized_address: 'x' };
  const r = moveTargets({ slots, order, today: '2026-10-13' });
  assert.deepEqual(r.map((t) => t.slot.id), ['s2', 's3']);
  assert.equal(r[0].fits, false);
  assert.match(r[0].reason, /emplacements/);
  assert.equal(r[1].fits, false);
  assert.match(r[1].reason, /arrêts/);
});

test('moveTargets : une adresse déjà desservie ne compte pas d\'arrêt en plus', () => {
  const order = { id: 'o', sector_id: 'm', delivery_slot_id: null, pallet_slots: 1, normalized_address: 'x' };
  const r = moveTargets({ slots, order, today: '2026-10-13', stopKeysBySlot: new Map([['s3', new Set(['x'])]]) });
  assert.equal(r.find((t) => t.slot.id === 's3').fits, true);
  assert.equal(r.find((t) => t.slot.id === 's1').fits, true);
});

test('buildRouteSheet : un arrêt par adresse, commandes non payées ou annulées exclues, lignes palette seules', () => {
  const orders = [
    { id: 'a', order_number: 'WEB-1', first_name: 'Ana', last_name: 'B', phone: '06', created_at: '2026-10-01', paid_at: 'x', status: 'nouvelle', pallet_slots: 1, normalized_address: 'k1', geocoded_address: { label: '1 rue A 31000 T' }, lat: 43.5, lon: 1.4, comments: 'Portail bleu', delivery_instructions: 'Appeler avant' },
    { id: 'b', order_number: 'WEB-2', first_name: 'Bob', last_name: 'C', phone: '07', created_at: '2026-10-02', paid_at: 'x', status: 'nouvelle', pallet_slots: 2, normalized_address: 'k2', address: '2 rue B', postal_code: '31320', city: 'R', lat: null, lon: null },
    { id: 'c', order_number: 'WEB-3', first_name: 'Ana', last_name: 'B', phone: '06', created_at: '2026-10-03', paid_at: 'x', status: 'nouvelle', pallet_slots: 1, normalized_address: 'k1' },
    { id: 'd', order_number: 'WEB-4', created_at: '2026-10-04', paid_at: null, status: 'en_attente_paiement', pallet_slots: 1, normalized_address: 'k3' },
    { id: 'e', order_number: 'WEB-5', created_at: '2026-10-05', paid_at: 'x', status: 'annulee', pallet_slots: 1, normalized_address: 'k4' },
  ];
  const items = [
    { order_id: 'a', product_name: 'Pellets', qty: 1, shipping_kind: 'pallet' },
    { order_id: 'a', product_name: 'Serviteur', qty: 1, shipping_kind: 'parcel' },
    { order_id: 'b', product_name: 'Bûches', qty: 2, shipping_kind: 'pallet' },
  ];
  const sheet = buildRouteSheet({
    slot: { delivery_date: '2026-11-02', km_estimated: 400 }, sector: { code: 'MUR', label: 'Muret', max_km: 350, depot: 'castanet' },
    orders, items, cfg: cfgDefaut,
  });
  assert.equal(sheet.dateLabel, 'lundi 2 novembre 2026');
  assert.equal(sheet.depot, 'Dépôt Castanet-Tolosan');
  assert.equal(sheet.stops.length, 2);
  assert.equal(sheet.stops[0].pallets, 2);
  assert.deepEqual(sheet.stops[0].orders.map((o) => o.orderNumber), ['WEB-1', 'WEB-3']);
  assert.deepEqual(sheet.stops[0].orders[0].lines, [{ name: 'Pellets', qty: 1 }]);
  assert.equal(sheet.stops[0].orders[0].comment, 'Portail bleu');
  assert.equal(sheet.stops[0].orders[0].instructions, 'Appeler avant');
  assert.equal(sheet.stops[1].orders[0].instructions, null);
  assert.equal(sheet.stops[1].address, '2 rue B 31320 R');
  assert.equal(sheet.pallets, 4);
  assert.equal(sheet.overKm, true);
  assert.equal(sheet.filename, 'feuille-de-route-2026-11-02-MUR.pdf');
  assert.equal(sheet.itineraryUrl,
    'https://www.google.com/maps/dir/?api=1&origin=Castanet-Tolosan&destination=Castanet-Tolosan&waypoints=43.5%2C1.4%7C2%20rue%20B%2031320%20R&travelmode=driving');
});

test('formatPhoneFR : paires lisibles, international ramené au national, inconnu intact', () => {
  assert.equal(formatPhoneFR('+33686269809'), '06 86 26 98 09');
  assert.equal(formatPhoneFR('0033 5 63 33 33 14'), '05 63 33 33 14');
  assert.equal(formatPhoneFR('0563333314'), '05 63 33 33 14');
  assert.equal(formatPhoneFR('06.86.26.98.09'), '06 86 26 98 09');
  assert.equal(formatPhoneFR('+44 20 7946 0958'), '+44 20 7946 0958');
  assert.equal(formatPhoneFR(null), null);
});

test('depotParCode : code inconnu → le code, jamais un dépôt inventé', () => {
  assert.deepEqual(depotParCode(cfgDefaut, 'albi'), { code: 'albi', libelle: 'Dépôt albi', adresse: 'albi' });
});

test('buildRouteSheet : le dépôt réglé (adresse, libellé) pilote le départ et l\'itinéraire', () => {
  const cfg = buildWebshopConfig({ webshop: { depots: [{ code: 'castanet', libelle: 'Dépôt Nord', adresse: '1 rue X, 31320 Castanet' }] } });
  assert.equal(depotParCode(cfg, 'castanet').adresse, '1 rue X, 31320 Castanet');
  const sheet = buildRouteSheet({ slot: { delivery_date: '2026-11-02' }, sector: { code: 'MUR', depot: 'castanet' }, orders: [], items: [], cfg });
  assert.equal(sheet.depot, 'Dépôt Nord');
  assert.ok(sheet.itineraryUrl.includes(`origin=${encodeURIComponent('1 rue X, 31320 Castanet')}`));
});

test('sendPendingLabel : texte selon envoi auto, délai, heure et destinataires réglés', () => {
  const cfg = buildWebshopConfig({ webshop: { palette: { delai_fermeture_jours: 3, heure_envoi: 17, envoi_auto: true, transporteur: { emails: ['a@x.fr', 'b@x.fr'] } } } });
  assert.equal(sendPendingLabel(cfg, 'open'), 'Feuille pas encore envoyée — partira à la fermeture (J-3, 17 h) vers a@x.fr, b@x.fr');
  assert.match(sendPendingLabel(cfgDefaut, 'open'), /\(J-2, 18 h\) vers aucun transporteur paramétré$/);
  assert.match(sendPendingLabel(cfg, 'closed'), /^Feuille pas encore envoyée — partira à 17 h vers a@x\.fr, b@x\.fr$/);
  const off = buildWebshopConfig({ webshop: { palette: { envoi_auto: false } } });
  assert.equal(sendPendingLabel(off, 'open'), 'Envoi automatique désactivé — utiliser "Envoyer au transporteur"');
});

test('itineraryUrl sans arrêt : pas de waypoints', () => {
  assert.equal(itineraryUrl('Dépôt', []), 'https://www.google.com/maps/dir/?api=1&origin=D%C3%A9p%C3%B4t&destination=D%C3%A9p%C3%B4t&travelmode=driving');
});

test('tourneeErrorMessage traduit les codes, garde l\'inconnu', () => {
  assert.match(tourneeErrorMessage({ message: 'capacity_exceeded' }), /emplacements/);
  assert.equal(tourneeErrorMessage({ message: 'boom' }), 'Erreur : boom');
});

test('slotStatusLabel : « Partie le … » / « Livrée le … » (jour Paris), la livraison prime', () => {
  assert.equal(slotStatusLabel({ status: 'closed', close_reason: 'manual', departed_at: '2026-11-02T06:30:00Z' }), 'Partie le 2 novembre 2026');
  // 23 h UTC le 2 = 00 h à Paris le 3
  assert.equal(slotStatusLabel({ status: 'closed', departed_at: '2026-11-02T23:30:00Z' }), 'Partie le 3 novembre 2026');
  assert.equal(slotStatusLabel({ status: 'closed', departed_at: '2026-11-02T06:30:00Z', delivered_at: '2026-11-02T15:00:00Z' }), 'Livrée le 2 novembre 2026');
  assert.equal(slotStatusLabel({ status: 'closed', close_reason: 'manual', departed_at: null, delivered_at: null }), 'Fermée — à la main');
});

test('clientsAPrevenir : commandes payées non annulées avec ligne palette, sans e-mail à part', () => {
  const orders = [
    { id: 'a', paid_at: 'x', status: 'nouvelle', email: 'a@x.fr' },
    { id: 'b', paid_at: 'x', status: 'nouvelle', email: '' },
    { id: 'c', paid_at: 'x', status: 'annulee', email: 'c@x.fr' },
    { id: 'd', paid_at: null, status: 'en_attente_paiement', email: 'd@x.fr' },
    { id: 'e', paid_at: 'x', status: 'nouvelle', email: 'e@x.fr' }, // colis seul
    { id: 'f', paid_at: 'x', status: 'nouvelle', email: 'f@x.fr' },
  ];
  const items = [
    { order_id: 'a', shipping_kind: 'pallet' }, { order_id: 'b', shipping_kind: 'pallet' },
    { order_id: 'c', shipping_kind: 'pallet' }, { order_id: 'd', shipping_kind: 'pallet' },
    { order_id: 'e', shipping_kind: 'parcel' }, { order_id: 'f', shipping_kind: 'parcel' }, { order_id: 'f', shipping_kind: 'pallet' },
  ];
  assert.deepEqual(clientsAPrevenir({ orders, items }), { total: 3, sansEmail: 1 });
  assert.deepEqual(clientsAPrevenir({ orders: [], items: [] }), { total: 0, sansEmail: 0 });
  assert.deepEqual(clientsAPrevenir({ orders: null, items: null }), { total: 0, sansEmail: 0 });
});

const ACT = (o = {}) => ({ action: 'email_client', status: 'sent', error_code: null, ...o });
test('resumeTourneeEvent : bilan e-mails + cartes, warning dès qu\'un e-mail n\'est pas parti', () => {
  const ok = resumeTourneeEvent('partie', {
    slot: { first_time: true },
    orders: [
      { order_id: 'a', statut_applique: 'expediee', actions: [ACT()] },
      { order_id: 'b', statut_applique: null, actions: [ACT()] },
    ],
  });
  assert.deepEqual(ok, { tone: 'success', message: 'Tournée partie — 2 e-mails envoyés, 1 carte déplacée' });

  const ko = resumeTourneeEvent('livree', {
    slot: { first_time: true },
    orders: [
      { order_id: 'a', statut_applique: 'livree', actions: [ACT({ status: 'failed', error_code: 'template_missing' })] },
      { order_id: 'b', statut_applique: 'livree', actions: [ACT()] },
    ],
  });
  assert.equal(ko.tone, 'warning');
  assert.equal(ko.message, 'Tournée livrée — 1 e-mail envoyé, 1 en échec, 2 cartes déplacées');

  const sansEmail = resumeTourneeEvent('partie', { slot: {}, orders: [{ order_id: 'a', statut_applique: null, actions: [ACT({ status: 'skipped', error_code: 'no_email' })] }] });
  assert.equal(sansEmail.tone, 'warning');
  assert.match(sansEmail.message, /1 en échec/);

  const dejaFait = resumeTourneeEvent('partie', { slot: { first_time: false }, orders: [{ order_id: 'a', statut_applique: null, actions: [ACT({ id: null, status: 'skipped', error_code: 'already_sent' })] }] });
  assert.equal(dejaFait.tone, 'success');
  assert.match(dejaFait.message, /1 déjà envoyé/);

  const erreurCarte = resumeTourneeEvent('partie', { slot: {}, orders: [{ order_id: 'a', statut_applique: null, statut_erreur: 'invalid_transition', actions: [] }] });
  assert.equal(erreurCarte.tone, 'warning');
  assert.match(erreurCarte.message, /1 carte non déplacée/);

  assert.deepEqual(resumeTourneeEvent('partie', { slot: {}, orders: [] }), { tone: 'success', message: 'Tournée partie — aucun client à prévenir' });
});

test('peutMarquerPartie / peutMarquerLivree / peutRouvrir : une tournée partie ne se rouvre plus', () => {
  const fermee = { status: 'closed', delivery_date: '2026-11-10', used_slots: 1, capacity_slots: 5, used_stops: 1, capacity_stops: 5 };
  assert.equal(peutMarquerPartie(fermee), true);
  assert.equal(peutMarquerPartie({ ...fermee, status: 'open' }), false);
  assert.equal(peutMarquerPartie({ ...fermee, departed_at: 'x' }), false);
  assert.equal(peutMarquerLivree(fermee), false);
  assert.equal(peutMarquerLivree({ ...fermee, departed_at: 'x' }), true);
  assert.equal(peutMarquerLivree({ ...fermee, status: 'shipped', departed_at: 'x' }), true);
  assert.equal(peutMarquerLivree({ ...fermee, status: 'open', departed_at: 'x' }), false); // rouverte : la garde SQL refuserait
  assert.equal(peutMarquerLivree({ ...fermee, status: 'cancelled', departed_at: 'x' }), false);
  assert.equal(peutMarquerLivree({ ...fermee, departed_at: 'x', delivered_at: 'y' }), false);
  assert.equal(peutRouvrir(fermee, '2026-11-01'), true);
  assert.equal(peutRouvrir({ ...fermee, departed_at: 'x' }, '2026-11-01'), false);
  assert.equal(peutRouvrir(fermee, '2026-11-09'), false);
});
