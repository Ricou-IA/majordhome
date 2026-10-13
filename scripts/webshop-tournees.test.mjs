// node --test scripts/webshop-tournees.test.mjs — modèle pur des tournées webshop
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotStatusLabel, addDaysIso, todayParis, stopKey, moveTargets, buildRouteSheet, itineraryUrl, depotFor, tourneeErrorMessage,
} from '../src/lib/webshop/tournees.js';

test('slotStatusLabel précise le motif de fermeture', () => {
  assert.equal(slotStatusLabel({ status: 'open' }), 'Ouverte');
  assert.equal(slotStatusLabel({ status: 'closed', close_reason: 'j_minus_2' }), 'Fermée — J-2');
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
    { id: 'a', order_number: 'WEB-1', first_name: 'Ana', last_name: 'B', phone: '06', created_at: '2026-10-01', paid_at: 'x', status: 'nouvelle', pallet_slots: 1, normalized_address: 'k1', geocoded_address: { label: '1 rue A 31000 T' }, lat: 43.5, lon: 1.4, comments: 'Portail bleu' },
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
    orders, items,
  });
  assert.equal(sheet.dateLabel, 'lundi 2 novembre 2026');
  assert.equal(sheet.depot, 'Dépôt Castanet-Tolosan');
  assert.equal(sheet.stops.length, 2);
  assert.equal(sheet.stops[0].pallets, 2);
  assert.deepEqual(sheet.stops[0].orders.map((o) => o.orderNumber), ['WEB-1', 'WEB-3']);
  assert.deepEqual(sheet.stops[0].orders[0].lines, [{ name: 'Pellets', qty: 1 }]);
  assert.equal(sheet.stops[0].orders[0].comment, 'Portail bleu');
  assert.equal(sheet.stops[1].address, '2 rue B 31320 R');
  assert.equal(sheet.pallets, 4);
  assert.equal(sheet.overKm, true);
  assert.equal(sheet.filename, 'feuille-de-route-2026-11-02-MUR.pdf');
  assert.equal(sheet.itineraryUrl,
    'https://www.google.com/maps/dir/?api=1&origin=Castanet-Tolosan&destination=Castanet-Tolosan&waypoints=43.5%2C1.4%7C2%20rue%20B%2031320%20R&travelmode=driving');
});

test('depotFor : code inconnu → le code, jamais un dépôt inventé', () => {
  assert.deepEqual(depotFor('albi'), { label: 'Dépôt albi', address: 'albi' });
});

test('itineraryUrl sans arrêt : pas de waypoints', () => {
  assert.equal(itineraryUrl('Dépôt', []), 'https://www.google.com/maps/dir/?api=1&origin=D%C3%A9p%C3%B4t&destination=D%C3%A9p%C3%B4t&travelmode=driving');
});

test('tourneeErrorMessage traduit les codes, garde l\'inconnu', () => {
  assert.match(tourneeErrorMessage({ message: 'capacity_exceeded' }), /emplacements/);
  assert.equal(tourneeErrorMessage({ message: 'boom' }), 'Erreur : boom');
});
