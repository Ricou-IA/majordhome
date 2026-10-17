// node --test scripts/webshop-settings-form.test.mjs — écran Settings → Webshop, logique de saisie pure
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWebshopConfig, WEBSHOP_REGLAGES_DEFAUT } from '../src/lib/webshop/reglages.js';
import {
  formDepuisConfig, validerSaisie, webshopAEnregistrer, eurosVersCents, centsVersEuros, texteVersEmails,
  messageErreurWebshop, basculerPassage, normaliserRecurrence, parserPostcodes, postcodesVersTexte,
  formSecteur, validerSecteur, payloadSecteur, trancheEnConflit, validerTarif, validerPoint,
} from '../src/lib/webshop/settingsForm.js';

const formDefaut = () => formDepuisConfig(buildWebshopConfig(null));

test('formulaire par défaut : aucune erreur, aller-retour identique au défaut', () => {
  const f = formDefaut();
  assert.deepEqual(validerSaisie(f), {});
  const w = webshopAEnregistrer(f, {});
  assert.deepEqual({ ...w }, { ...WEBSHOP_REGLAGES_DEFAUT, depots: WEBSHOP_REGLAGES_DEFAUT.depots.map((d) => ({ ...d })) });
});

test('hors bornes : erreur sous le champ, jamais remplacé par le défaut', () => {
  const f = { ...formDefaut(), delai_fermeture_jours: '20', heure_envoi: '24', horizon_semaines: '0', max_qty_ligne: 'abc' };
  const e = validerSaisie(f);
  assert.match(e.delai_fermeture_jours, /entre 0 et 14/);
  assert.match(e.heure_envoi, /entre 0 et 23/);
  assert.match(e.horizon_semaines, /entre 1 et 26/);
  assert.ok(e.max_qty_ligne);
});

test('max panier ≤ capacité, TVA admise, ancre = lundi valide', () => {
  const e = validerSaisie({ ...formDefaut(), capacite_emplacements: '8', max_emplacements_panier: '9', palette_tva_pct: '7', ancre_cycle: '2026-01-06' });
  assert.match(e.max_emplacements_panier, /capacité/);
  assert.ok(e.palette_tva_pct);
  assert.match(e.ancre_cycle, /lundi/);
  assert.equal(validerSaisie({ ...formDefaut(), ancre_cycle: '2026-02-30' }).ancre_cycle, 'Date invalide');
});

test('prix en euros → centimes', () => {
  assert.equal(eurosVersCents('55'), 5500);
  assert.equal(eurosVersCents('55,5'), 5550);
  assert.equal(eurosVersCents('12.34'), 1234);
  assert.ok(Number.isNaN(eurosVersCents('1,234')));
  assert.ok(Number.isNaN(eurosVersCents('-3')));
  assert.equal(centsVersEuros(5550), '55,5');
  const w = webshopAEnregistrer({ ...formDefaut(), prix_emplacement_defaut_euros: '61' }, {});
  assert.equal(w.palette.prix_emplacement_defaut_cents, 6100);
});

test('site_url : / final retiré, https exigé', () => {
  const w = webshopAEnregistrer({ ...formDefaut(), site_url: ' https://www.exemple.fr/// ' }, {});
  assert.equal(w.site_url, 'https://www.exemple.fr');
  assert.ok(validerSaisie({ ...formDefaut(), site_url: 'http://x.fr' }).site_url);
});

test('e-mails : saisie libre séparée, faute signalée', () => {
  assert.deepEqual(texteVersEmails('A@b.fr, c@d.fr; e@f.fr\ng@h.fr'), ['a@b.fr', 'c@d.fr', 'e@f.fr', 'g@h.fr']);
  assert.match(validerSaisie({ ...formDefaut(), transporteur_emails: 'pas-un-mail' }).transporteur_emails, /invalide/);
});

test('dépôts : ligne incomplète, doublon, dépôt utilisé par un secteur', () => {
  const base = formDefaut();
  assert.ok(validerSaisie({ ...base, depots: [{ code: 'x', libelle: '', adresse: 'a' }] }).depots);
  assert.match(validerSaisie({ ...base, depots: [base.depots[0], base.depots[0]] }).depots, /double/);
  const autre = [{ code: 'gaillac', libelle: 'Dépôt Gaillac', adresse: 'Gaillac' }];
  assert.match(validerSaisie({ ...base, depots: autre }, { depotsUtilises: ['castanet'] }).depots, /castanet/);
  // liste vide : le défaut castanet couvre les secteurs castanet
  assert.deepEqual(validerSaisie({ ...base, depots: [] }, { depotsUtilises: ['castanet'] }), {});
  assert.ok(validerSaisie({ ...base, depots: [] }, { depotsUtilises: ['gaillac'] }).depots);
  assert.deepEqual(webshopAEnregistrer({ ...base, depots: [] }, {}).depots, []);
});

test('clés inconnues de settings.webshop conservées', () => {
  const w = webshopAEnregistrer(formDefaut(), { process: { x: 1 }, site_url: 'https://old.fr' });
  assert.deepEqual(w.process, { x: 1 });
  assert.equal(w.site_url, '');
});

test('messages d’erreur des RPC', () => {
  assert.equal(messageErreurWebshop({ message: 'postcode_taken', details: 'castanet-S2' }), 'Ce code postal appartient déjà au secteur castanet-S2');
  assert.equal(messageErreurWebshop({ message: 'org_admin_required' }), 'Élément introuvable ou droits insuffisants (administrateur requis)');
  assert.match(messageErreurWebshop({ message: 'depot_unknown', details: 'zz' }), /zz/);
  assert.match(messageErreurWebshop({ message: 'invalid_recurrence' }), /Jours de passage/);
  assert.equal(messageErreurWebshop({ message: 'autre chose' }), 'autre chose');
});

test('récurrence : bascule triée, sans doublon', () => {
  let r = basculerPassage([], 2, 3);
  r = basculerPassage(r, 1, 5);
  assert.deepEqual(r, [{ week: 1, weekday: 5 }, { week: 2, weekday: 3 }]);
  assert.deepEqual(basculerPassage(r, 2, 3), [{ week: 1, weekday: 5 }]);
  assert.deepEqual(normaliserRecurrence([{ week: 1, weekday: 1 }, { week: 1, weekday: 1 }]), [{ week: 1, weekday: 1 }]);
});

test('codes postaux : parse + erreurs explicites + aller-retour', () => {
  const { rows, erreurs } = parserPostcodes('31320 31113 Castanet-Tolosan\n\n81600 Gaillac\n20000 2A004 Ajaccio\n3132 x');
  assert.deepEqual(rows, [
    { postal_code: '31320', insee_code: '31113', commune: 'Castanet-Tolosan' },
    { postal_code: '81600', insee_code: '', commune: 'Gaillac' },
    { postal_code: '20000', insee_code: '2A004', commune: 'Ajaccio' },
  ]);
  assert.equal(erreurs.length, 1);
  assert.match(erreurs[0], /Ligne 5/);
  assert.deepEqual(parserPostcodes(postcodesVersTexte(rows)).rows, rows);
});

test('secteur : formulaire, validation, payload en centimes, code seulement à la création', () => {
  const cfg = buildWebshopConfig(null);
  const neuf = formSecteur(null, cfg);
  assert.equal(neuf.prix_euros, '55');
  assert.equal(neuf.depot, 'castanet');
  const e = validerSecteur(neuf, { codesDepots: ['castanet'] });
  assert.ok(e.code && e.label && e.max_stops);
  const ok = { ...neuf, code: 'castanet-S9', label: 'S9', max_stops: '12', prix_euros: '49,5', recurrence: [{ week: 1, weekday: 2 }] };
  assert.deepEqual(validerSecteur(ok, { codesDepots: ['castanet'] }), {});
  const p = payloadSecteur(ok);
  assert.equal(p.code, 'castanet-S9');
  assert.equal(p.slot_price_ttc_cents, 4950);
  assert.equal(p.max_stops, 12);
  const existant = formSecteur({ id: 'u1', code: 'S1', label: 'L', depot: 'castanet', max_stops: 10, max_minutes: 540, max_km: 350, slot_price_ttc_cents: 4500, slots_per_cycle: 2, recurrence: [{ week: 2, weekday: 1 }], is_active: true }, cfg);
  assert.equal(existant.prix_euros, '45');
  const pe = payloadSecteur(existant);
  assert.equal(pe.id, 'u1');
  assert.equal('code' in pe, false);
  assert.ok(validerSecteur({ ...existant, depot: 'inconnu' }, { codesDepots: ['castanet'] }).depot);
});

test('tarifs colis : chevauchement [min, max[ refusé, contigu accepté', () => {
  const tarifs = [
    { id: 'a', min_weight_kg: '0', max_weight_kg: '2', is_active: true },
    { id: 'b', min_weight_kg: '2', max_weight_kg: '5', is_active: true },
    { id: 'c', min_weight_kg: '5', max_weight_kg: '50', is_active: false },
  ];
  assert.equal(trancheEnConflit(tarifs, { min_weight_kg: 5, max_weight_kg: 10, is_active: true }), null);
  assert.equal(trancheEnConflit(tarifs, { min_weight_kg: 4, max_weight_kg: 10, is_active: true }).id, 'b');
  assert.equal(trancheEnConflit(tarifs, { min_weight_kg: 1, max_weight_kg: null, is_active: true }).id, 'a');
  assert.equal(trancheEnConflit(tarifs, { id: 'b', min_weight_kg: 2, max_weight_kg: 6, is_active: true }), null);
  assert.equal(trancheEnConflit(tarifs, { min_weight_kg: 0, max_weight_kg: 1, is_active: false }), null);
  const v = validerTarif({ label: 'X', min: '10', max: '5', prix: '9,9' });
  assert.ok(v.erreurs.max);
  const ok = validerTarif({ label: 'X', min: '10', max: '', prix: '24,90' });
  assert.deepEqual(ok.erreurs, {});
  assert.deepEqual(ok.valeur, { label: 'X', min_weight_kg: 10, max_weight_kg: null, price_ttc: 24.9 });
});

test('point de retrait : slug à la création seulement', () => {
  assert.ok(validerPoint({ slug: 'Gaillac', name: 'n', address: 'a', accepts: 'both' }).slug);
  assert.deepEqual(validerPoint({ id: 'x', slug: '', name: 'n', address: 'a', accepts: 'pallet' }), {});
});
