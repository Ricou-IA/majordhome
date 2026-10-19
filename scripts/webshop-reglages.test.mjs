// node --test scripts/webshop-reglages.test.mjs — réglages webshop (livraison / process), module pur
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEBSHOP_REGLAGES_DEFAUT, buildWebshopConfig, validerWebshopReglages, depotParCode,
} from '../src/lib/webshop/reglages.js';

const pal = (palette) => buildWebshopConfig({ webshop: { palette } }).palette;

test('défauts quand settings vide, et le défaut est figé', () => {
  assert.deepEqual(buildWebshopConfig(null), WEBSHOP_REGLAGES_DEFAUT);
  assert.deepEqual(buildWebshopConfig({}), WEBSHOP_REGLAGES_DEFAUT);
  assert.deepEqual(buildWebshopConfig({ webshop: {} }), WEBSHOP_REGLAGES_DEFAUT);
  assert.ok(Object.isFrozen(WEBSHOP_REGLAGES_DEFAUT));
  assert.ok(Object.isFrozen(WEBSHOP_REGLAGES_DEFAUT.palette.transporteur));
  assert.ok(Object.isFrozen(WEBSHOP_REGLAGES_DEFAUT.depots[0]));
  assert.ok(Object.isFrozen(WEBSHOP_REGLAGES_DEFAUT.emails.interne));
});

test('valeurs par défaut = comportement actuel', () => {
  const c = buildWebshopConfig(null);
  assert.equal(c.palette.delai_fermeture_jours, 2);
  assert.equal(c.palette.horizon_semaines, 12);
  assert.equal(c.palette.ancre_cycle, '2026-01-05');
  assert.equal(c.palette.capacite_emplacements, 10);
  assert.equal(c.palette.prix_emplacement_defaut_cents, 5500);
  assert.equal(c.palette.tva_pct, 10);
  assert.equal(c.palette.max_emplacements_panier, 10);
  assert.equal(c.palette.heure_envoi, 18);
  assert.equal(c.palette.envoi_auto, true);
  assert.equal(c.colis.tva_pct, 20);
  assert.equal(c.colis.max_qty_ligne, 20);
});

test('buildWebshopConfig renvoie un objet neuf, modifiable, sans toucher au défaut', () => {
  const a = buildWebshopConfig(null);
  assert.notEqual(a, WEBSHOP_REGLAGES_DEFAUT);
  a.palette.horizon_semaines = 3;
  a.depots.push({ code: 'x', libelle: 'X', adresse: 'X' });
  a.emails.interne.push('a@b.fr');
  assert.equal(WEBSHOP_REGLAGES_DEFAUT.palette.horizon_semaines, 12);
  assert.equal(WEBSHOP_REGLAGES_DEFAUT.depots.length, 1);
  assert.equal(buildWebshopConfig(null).palette.horizon_semaines, 12);
  assert.equal(buildWebshopConfig(null).emails.interne.length, 0);
});

test('fusion partielle : le reste garde son défaut', () => {
  const c = buildWebshopConfig({ webshop: { palette: { delai_fermeture_jours: 3 } } });
  assert.equal(c.palette.delai_fermeture_jours, 3);
  assert.equal(c.palette.horizon_semaines, 12);
  assert.equal(c.colis.tva_pct, 20);
  assert.equal(c.palette.transporteur.nom, '');
});

test('fusion profonde : un sous-objet partiel garde ses voisins', () => {
  const c = buildWebshopConfig({ webshop: { palette: { transporteur: { nom: 'Trans' } }, colis: { prestataire: { note: 'n' } } } });
  assert.equal(c.palette.transporteur.nom, 'Trans');
  assert.deepEqual(c.palette.transporteur.emails, []);
  assert.equal(c.colis.prestataire.mode, 'email');
  assert.equal(c.colis.prestataire.note, 'n');
});

test('settings aberrants ne cassent rien', () => {
  assert.deepEqual(buildWebshopConfig({ webshop: 'oups' }), WEBSHOP_REGLAGES_DEFAUT);
  assert.deepEqual(buildWebshopConfig({ webshop: { palette: 12, colis: [], emails: null } }), WEBSHOP_REGLAGES_DEFAUT);
});

test('coercition des nombres', () => {
  assert.equal(pal({ delai_fermeture_jours: '4' }).delai_fermeture_jours, 4);
  for (const v of ['abc', -1, null, '', true, NaN, 2.5, 15]) {
    assert.equal(pal({ delai_fermeture_jours: v }).delai_fermeture_jours, 2, String(v));
  }
  assert.equal(pal({ heure_envoi: 24 }).heure_envoi, 18);
  assert.equal(pal({ heure_envoi: 0 }).heure_envoi, 0);
  assert.equal(pal({ heure_envoi: 23 }).heure_envoi, 23);
  assert.equal(pal({ delai_fermeture_jours: 0 }).delai_fermeture_jours, 0);
});

test('bornes', () => {
  assert.equal(pal({ delai_fermeture_jours: 14 }).delai_fermeture_jours, 14);
  assert.equal(pal({ delai_fermeture_jours: 15 }).delai_fermeture_jours, 2);
  assert.equal(pal({ horizon_semaines: 0 }).horizon_semaines, 12);
  assert.equal(pal({ horizon_semaines: 1 }).horizon_semaines, 1);
  assert.equal(pal({ horizon_semaines: 26 }).horizon_semaines, 26);
  assert.equal(pal({ horizon_semaines: 27 }).horizon_semaines, 12);
  assert.equal(pal({ capacite_emplacements: 0 }).capacite_emplacements, 10);
  assert.equal(pal({ capacite_emplacements: 40 }).capacite_emplacements, 40);
  assert.equal(pal({ capacite_emplacements: 41 }).capacite_emplacements, 10);
  assert.equal(pal({ prix_emplacement_defaut_cents: -5 }).prix_emplacement_defaut_cents, 5500);
  assert.equal(pal({ prix_emplacement_defaut_cents: 6000 }).prix_emplacement_defaut_cents, 6000);
  const c = buildWebshopConfig({ webshop: { colis: { max_qty_ligne: 100 } } });
  assert.equal(c.colis.max_qty_ligne, 100);
  assert.equal(buildWebshopConfig({ webshop: { colis: { max_qty_ligne: 101 } } }).colis.max_qty_ligne, 20);
  assert.equal(buildWebshopConfig({ webshop: { colis: { max_qty_ligne: 0 } } }).colis.max_qty_ligne, 20);
});

test('tva_pct dans {0, 5.5, 10, 20}', () => {
  for (const v of [0, 5.5, 10, 20, '5.5']) assert.equal(pal({ tva_pct: v }).tva_pct, Number(v));
  assert.equal(pal({ tva_pct: 7 }).tva_pct, 10);
  assert.equal(buildWebshopConfig({ webshop: { colis: { tva_pct: 7 } } }).colis.tva_pct, 20);
  assert.equal(buildWebshopConfig({ webshop: { colis: { tva_pct: 5.5 } } }).colis.tva_pct, 5.5);
});

test('max_emplacements_panier borné par la capacité effective', () => {
  assert.equal(pal({ capacite_emplacements: 6, max_emplacements_panier: 6 }).max_emplacements_panier, 6);
  assert.equal(pal({ capacite_emplacements: 6, max_emplacements_panier: 7 }).max_emplacements_panier, 6); // défaut 10 plafonné à 6
  assert.equal(pal({ capacite_emplacements: 6 }).max_emplacements_panier, 6);
  assert.equal(pal({ capacite_emplacements: 20, max_emplacements_panier: 15 }).max_emplacements_panier, 15);
  assert.equal(pal({ capacite_emplacements: 20, max_emplacements_panier: 0 }).max_emplacements_panier, 10);
  assert.equal(pal({ capacite_emplacements: 20, max_emplacements_panier: 21 }).max_emplacements_panier, 10);
  assert.equal(pal({ capacite_emplacements: 99, max_emplacements_panier: 3 }).max_emplacements_panier, 3); // capacité invalide → 10
  assert.equal(pal({ capacite_emplacements: 99, max_emplacements_panier: 11 }).max_emplacements_panier, 10);
});

test('ancre_cycle : date ISO valide, sinon défaut', () => {
  assert.equal(pal({ ancre_cycle: '2026-03-02' }).ancre_cycle, '2026-03-02');
  for (const v of ['2026-02-30', '02/03/2026', '', 20260302, null, '2026-13-01']) {
    assert.equal(pal({ ancre_cycle: v }).ancre_cycle, '2026-01-05', String(v));
  }
});

test('envoi_auto booléen', () => {
  assert.equal(pal({ envoi_auto: false }).envoi_auto, false);
  assert.equal(pal({ envoi_auto: 'false' }).envoi_auto, false);
  assert.equal(pal({ envoi_auto: 'n’importe quoi' }).envoi_auto, true);
});

test('listes e-mails : filtrées, trim, minuscules', () => {
  const c = buildWebshopConfig({ webshop: { emails: { interne: [' Eric@Mayer.FR ', 42, null, '', '  ', 'b@c.fr'] } } });
  assert.deepEqual(c.emails.interne, ['eric@mayer.fr', 'b@c.fr']);
  assert.deepEqual(buildWebshopConfig({ webshop: { emails: { interne: 'a@b.fr' } } }).emails.interne, []);
  const t = buildWebshopConfig({ webshop: { palette: { transporteur: { emails: ['T@X.fr'] } } } });
  assert.deepEqual(t.palette.transporteur.emails, ['t@x.fr']);
});

test('dépôts : vide → défaut, sans code écarté, libellé et adresse par repli', () => {
  assert.deepEqual(buildWebshopConfig({ webshop: { depots: [] } }).depots, WEBSHOP_REGLAGES_DEFAUT.depots);
  assert.deepEqual(buildWebshopConfig({ webshop: { depots: [{ libelle: 'x' }, null, 'a', { code: '  ' }] } }).depots, WEBSHOP_REGLAGES_DEFAUT.depots);
  const d = buildWebshopConfig({ webshop: { depots: [{ code: 'albi', libelle: 'Albi', adresse: 'Albi 81' }, { libelle: 'sans code' }, { code: ' gaillac ' }] } }).depots;
  assert.deepEqual(d, [
    { code: 'albi', libelle: 'Albi', adresse: 'Albi 81' },
    { code: 'gaillac', libelle: 'Dépôt gaillac', adresse: 'gaillac' },
  ]);
});

test('validerWebshopReglages : config par défaut valide', () => {
  assert.deepEqual(validerWebshopReglages(buildWebshopConfig(null)), []);
});

test('validerWebshopReglages : e-mail mal formé', () => {
  const cfg = buildWebshopConfig({ webshop: { palette: { transporteur: { emails: ['pas-un-mail'] } } } });
  const errs = validerWebshopReglages(cfg);
  assert.ok(errs.some((e) => e.champ === 'palette.transporteur.emails' && e.message));
  const cfg2 = buildWebshopConfig({ webshop: { emails: { interne: ['x@y'] }, colis: { prestataire: { emails: ['a b@c.fr'] } } } });
  const champs = validerWebshopReglages(cfg2).map((e) => e.champ);
  assert.ok(champs.includes('emails.interne'));
  assert.ok(champs.includes('colis.prestataire.emails'));
});

test('validerWebshopReglages : site_url en https obligatoire (vide toléré)', () => {
  assert.ok(validerWebshopReglages(buildWebshopConfig({ webshop: { site_url: 'http://mayer.fr' } })).some((e) => e.champ === 'site_url'));
  assert.ok(validerWebshopReglages(buildWebshopConfig({ webshop: { site_url: 'mayer.fr' } })).some((e) => e.champ === 'site_url'));
  assert.deepEqual(validerWebshopReglages(buildWebshopConfig({ webshop: { site_url: 'https://mayer.fr' } })), []);
  assert.deepEqual(validerWebshopReglages(buildWebshopConfig({ webshop: { site_url: '' } })), []);
});

test('validerWebshopReglages : deux dépôts de même code', () => {
  const cfg = buildWebshopConfig({ webshop: { depots: [{ code: 'a' }, { code: 'a' }] } });
  assert.ok(validerWebshopReglages(cfg).some((e) => e.champ === 'depots'));
});

test('validerWebshopReglages : tolère une config incomplète', () => {
  assert.doesNotThrow(() => validerWebshopReglages({}));
  assert.doesNotThrow(() => validerWebshopReglages(null));
});

test('depotParCode', () => {
  const cfg = buildWebshopConfig(null);
  assert.deepEqual(depotParCode(cfg, 'castanet'), { code: 'castanet', libelle: 'Dépôt Castanet-Tolosan', adresse: 'Castanet-Tolosan' });
  const x = depotParCode(cfg, 'xyz');
  assert.deepEqual(x, { code: 'xyz', libelle: 'Dépôt xyz', adresse: 'xyz' });
  assert.equal(cfg.depots.length, 1);
  assert.equal(depotParCode(null, 'xyz').adresse, 'xyz');
});

test('process : défaut intact (colis par transition, palette par tournée, aucun ordre colis)', () => {
  const p = buildWebshopConfig(null).process;
  assert.deepEqual(p, {
    transitions: {
      confirmee: { email_client: null, ordre_colis: false },
      transmise_fournisseur: { email_client: null, ordre_colis: false },
      expediee: { email_client: 'webshop_expedition_colis', ordre_colis: false },
      livree: { email_client: 'webshop_livraison_colis', ordre_colis: false },
    },
    tournee: {
      partie: { email_client: 'webshop_expedition_palette' },
      livree: { email_client: 'webshop_livraison_palette' },
    },
  });
  assert.ok(Object.isFrozen(WEBSHOP_REGLAGES_DEFAUT.process.transitions.expediee));
});

test('process : gabarit inconnu → null, gabarit connu conservé, absent → défaut', () => {
  const p = buildWebshopConfig({ webshop: { process: {
    transitions: {
      expediee: { email_client: 'texte_en_dur' },
      confirmee: { email_client: 'webshop_confirmation' },
      livree: { email_client: null },
    },
    tournee: { partie: { email_client: 42 } },
  } } }).process;
  assert.equal(p.transitions.expediee.email_client, null);
  assert.equal(p.transitions.confirmee.email_client, 'webshop_confirmation');
  assert.equal(p.transitions.livree.email_client, null);
  assert.equal(p.transitions.transmise_fournisseur.email_client, null);
  assert.equal(p.tournee.partie.email_client, null);
  assert.equal(p.tournee.livree.email_client, 'webshop_livraison_palette');
});

test('process : ordre_colis non booléen → false', () => {
  const t = (v) => buildWebshopConfig({ webshop: { process: { transitions: { transmise_fournisseur: { ordre_colis: v } } } } })
    .process.transitions.transmise_fournisseur.ordre_colis;
  assert.equal(t('oui'), false);
  assert.equal(t(1), false);
  assert.equal(t(true), true);
  assert.equal(t(undefined), false);
});

test('process : transition hors périmètre ignorée, process aberrant → défaut', () => {
  const p = buildWebshopConfig({ webshop: { process: { transitions: { annulee: { email_client: 'webshop_confirmation' } } } } }).process;
  assert.equal(p.transitions.annulee, undefined);
  assert.deepEqual(buildWebshopConfig({ webshop: { process: 'oups' } }).process, WEBSHOP_REGLAGES_DEFAUT.process);
});
