// Tests du module pur src/lib/chantierCardDate.js — `node --test scripts/chantier-card-date.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bandeDeCarteChantier, comparerCartesChantier, adresseDeCarte, objetDeCarte,
} from '../src/lib/chantierCardDate.js';

const chantier = (extra = {}) => ({
  id: 'c1',
  chantier_status: 'gagne',
  won_date: '2026-10-01',
  has_active_rdv: false,
  next_rdv_date: null,
  realized_date: null,
  ...extra,
});

test('Gagné : la date de signature, même si une pose est au planning', () => {
  const b = bandeDeCarteChantier(chantier({ has_active_rdv: true, next_rdv_date: '2026-12-01' }));
  assert.deepEqual(b, { date: '2026-10-01', libelle: 'Gagné le', repere: 'date' });
});

test('Gagné sans date de signature : icône, pas une autre date', () => {
  const b = bandeDeCarteChantier(chantier({ won_date: null, next_rdv_date: '2026-12-01', has_active_rdv: true }));
  assert.equal(b.date, null);
  assert.equal(b.repere, 'inconnue');
});

test('Commande à faire et À planifier : aucune date, quoi que porte le chantier', () => {
  const dates = { has_active_rdv: true, next_rdv_date: '2026-12-01', realized_date: '2026-12-02' };
  const commande = bandeDeCarteChantier(chantier({ chantier_status: 'commande_a_faire', ...dates }));
  assert.equal(commande.date, null);
  assert.equal(commande.repere, 'commande');
  const aPlanifier = bandeDeCarteChantier(chantier({ chantier_status: 'commande_recue', ...dates }));
  assert.equal(aPlanifier.date, null);
  assert.equal(aPlanifier.repere, 'a_planifier');
});

test('Planifié : le début de la pose au planning', () => {
  const b = bandeDeCarteChantier(chantier({ chantier_status: 'planification', has_active_rdv: true, next_rdv_date: '2026-12-01' }));
  assert.deepEqual(b, { date: '2026-12-01', libelle: 'Début de la pose', repere: 'date' });
});

test('Planifié sans pose active : à replanifier, jamais la date de signature', () => {
  const sansRdv = bandeDeCarteChantier(chantier({ chantier_status: 'planification' }));
  assert.equal(sansRdv.date, null);
  assert.equal(sansRdv.repere, 'a_replanifier');
  const sansDate = bandeDeCarteChantier(chantier({ chantier_status: 'planification', has_active_rdv: true }));
  assert.equal(sansDate.repere, 'a_replanifier');
});

test('Réceptionné : la date de réalisation ; inconnue ⇒ icône, pas la signature', () => {
  const date = bandeDeCarteChantier(chantier({ chantier_status: 'realise', realized_date: '2026-11-04' }));
  assert.deepEqual(date, { date: '2026-11-04', libelle: 'Réceptionné le', repere: 'date' });
  const inconnue = bandeDeCarteChantier(chantier({ chantier_status: 'realise' }));
  assert.equal(inconnue.date, null);
  assert.equal(inconnue.repere, 'inconnue');
  assert.equal(bandeDeCarteChantier(chantier({ chantier_status: 'facture', realized_date: '2026-11-04' })).date, '2026-11-04');
});

test('chantier absent ou statut inconnu : rien ne casse', () => {
  assert.equal(bandeDeCarteChantier(null).repere, 'inconnue');
  assert.equal(bandeDeCarteChantier(chantier({ chantier_status: 'autre' })).date, '2026-10-01');
});

test('tri : à replanifier d\'abord, puis datées de la plus récente à la plus ancienne, puis sans date', () => {
  const planifie = (id, extra) => chantier({ id, chantier_status: 'planification', ...extra });
  const cartes = [
    planifie('decembre', { has_active_rdv: true, next_rdv_date: '2026-12-01' }),
    planifie('a-replanifier', { won_date: '2026-09-01' }),
    planifie('janvier', { has_active_rdv: true, next_rdv_date: '2027-01-11' }),
  ];
  assert.deepEqual(cartes.sort(comparerCartesChantier).map((c) => c.id), ['a-replanifier', 'janvier', 'decembre']);
});

test('tri : cartes sans date rangées par signature, la plus récente en haut, après les cartes datées', () => {
  const recu = (id, extra) => chantier({ id, chantier_status: 'realise', ...extra });
  const cartes = [
    recu('sans-date-ancien', { won_date: '2026-03-01' }),
    recu('date', { realized_date: '2026-06-01', won_date: '2026-01-01' }),
    recu('sans-date-recent', { won_date: '2026-09-01' }),
  ];
  assert.deepEqual(cartes.sort(comparerCartesChantier).map((c) => c.id), ['date', 'sans-date-recent', 'sans-date-ancien']);
});

test('tri : même date ⇒ départagé par la signature, sans casser sur une valeur absente', () => {
  const a = chantier({ id: 'a', won_date: '2026-10-01' });
  const b = chantier({ id: 'b', won_date: '2026-10-01' });
  assert.equal(comparerCartesChantier(a, b), 0);
  assert.equal(comparerCartesChantier(chantier({ won_date: null }), chantier({ won_date: null })), 0);
});

test('adresse : la voie puis « code postal ville », espaces nettoyés, lignes absentes vides', () => {
  assert.deepEqual(
    adresseDeCarte({ address: ' 12  chemin de la Borie ', postal_code: '81600', city: ' Gaillac ' }),
    { voie: '12 chemin de la Borie', commune: '81600 Gaillac' },
  );
  assert.deepEqual(adresseDeCarte({ address: null, postal_code: '81600', city: null }), { voie: '', commune: '81600' });
  assert.deepEqual(adresseDeCarte(null), { voie: '', commune: '' });
});

test('objet : type puis libellé, sans doublon', () => {
  assert.equal(objetDeCarte({ equipment_type_label: 'Poêle à bois ou Insert', label: 'Devis' }), 'Poêle à bois ou Insert · Devis');
  assert.equal(objetDeCarte({ equipment_type_label: null, label: 'Installation d\'une Borne V2C' }), 'Installation d\'une Borne V2C');
  assert.equal(objetDeCarte({ equipment_type_label: 'Climatisation', label: ' climatisation ' }), 'Climatisation');
  assert.equal(objetDeCarte({}), '');
});
