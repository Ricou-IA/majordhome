// scripts/tournee/etat.test.mjs — état d'une journée et secteur déduit (src/lib/tournee/etat.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deduireSecteur, etatJournee, LIBELLES_ETAT } from '../../src/lib/tournee/etat.js';

const rdv = (type, secteur, status = 'scheduled') => ({ appointment_type: type, grand_secteur: secteur, status });

test('deduireSecteur : un entretien/SAV localisé donne le secteur, null sans entretien', () => {
  assert.equal(deduireSecteur([]), null);
  assert.equal(deduireSecteur(null), null);
  assert.equal(deduireSecteur([rdv('installation', 'Castres')]), null);
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres')]), 'Castres');
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres', 'cancelled')]), null);
  assert.equal(deduireSecteur([rdv('maintenance', null)]), null);
  assert.equal(deduireSecteur([rdv('maintenance', '  ')]), null);
});

test('deduireSecteur : le premier entretien posé sur la journée vierge fixe le secteur (Eric, 2026-09-30)', () => {
  const pose = (secteur, created_at, extra = {}) => ({ ...rdv('maintenance', secteur), created_at, ...extra });
  // Vendredi 16/10 d'Antoine : DEVAUD (Lavaur) posé le 25/08, MARTIN sans secteur, SANTINON (L'Union) le 21/09.
  const vendredi = [pose("L'UNION", '2026-09-21T17:07:16Z'), pose(null, '2026-09-11T09:45:58Z'), pose('LAVAUR', '2026-08-25T09:53:22Z')];
  assert.equal(deduireSecteur(vendredi), 'LAVAUR');
  // Deux entretiens ajoutés ensuite dans un autre secteur ne le changent pas (plus de « majoritaire »).
  assert.equal(deduireSecteur([pose('Gaillac', '2026-09-01'), pose('Castres', '2026-09-02'), pose('Castres', '2026-09-03')]), 'Gaillac');
  // Le premier posé est annulé, ou n'est pas un entretien : le suivant fait foi.
  assert.equal(deduireSecteur([pose('Gaillac', '2026-09-01', { status: 'cancelled' }), pose('Castres', '2026-09-02')]), 'Castres');
  assert.equal(deduireSecteur([{ ...rdv('installation', 'Gaillac'), created_at: '2026-09-01' }, pose('Castres', '2026-09-02')]), 'Castres');
});

test('deduireSecteur : sans date de création, l heure du RDV puis le nom départagent (déterministe)', () => {
  // Un RDV daté fait foi sur un RDV sans date.
  assert.equal(deduireSecteur([rdv('maintenance', 'Castres'), { ...rdv('maintenance', 'Gaillac'), created_at: '2026-09-02' }]), 'Gaillac');
  assert.equal(deduireSecteur([
    { ...rdv('maintenance', 'Gaillac'), scheduled_start: '14:00' }, { ...rdv('maintenance', 'Lavaur'), scheduled_start: '08:30' },
  ]), 'Lavaur');
  assert.equal(deduireSecteur([rdv('maintenance', 'Gaillac'), rdv('maintenance', 'Castres')]), 'Castres');
});

test('etatJournee : figée prime sur tout', () => {
  assert.equal(etatJournee({ rdvs: [rdv('maintenance', 'C')], verdict: 'non_pleine', figeeAt: '2026-09-28T06:20:00Z', etiquette: null }), 'figee');
  assert.equal(etatJournee({ rdvs: [], verdict: null, figeeAt: '2026-09-28T06:20:00Z', etiquette: null }), 'figee');
});

test('etatJournee : sans RDV ni étiquette = vide ; étiquetée sans RDV = ouverte', () => {
  assert.equal(etatJournee({ rdvs: [], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'vide');
  assert.equal(etatJournee({ rdvs: [rdv('maintenance', 'C', 'cancelled')], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'vide');
  assert.equal(etatJournee({ rdvs: [], verdict: 'sans_adaptable', figeeAt: null, etiquette: 'Castres' }), 'ouverte');
});

test('etatJournee : verdicts du moteur', () => {
  const rdvs = [rdv('maintenance', 'C')];
  assert.equal(etatJournee({ rdvs, verdict: 'non_pleine', figeeAt: null, etiquette: null }), 'ouverte');
  assert.equal(etatJournee({ rdvs, verdict: 'figeable', figeeAt: null, etiquette: null }), 'pleine');
  assert.equal(etatJournee({ rdvs, verdict: 'a_arbitrer', figeeAt: null, etiquette: null }), 'a_arbitrer');
  // une journée d'installations seules (aucun adaptable) avec de la place reste « ouverte » : on peut y glisser un entretien
  assert.equal(etatJournee({ rdvs: [rdv('installation', null)], verdict: 'sans_adaptable', figeeAt: null, etiquette: null }), 'ouverte');
  assert.equal(etatJournee({ rdvs: [rdv('installation', null)], verdict: 'sans_adaptable', figeeAt: null, etiquette: null, pleine: false }), 'ouverte');
  // verdict inconnu (dépôt non configuré) → ouverte, jamais un état alarmant deviné
  assert.equal(etatJournee({ rdvs, verdict: null, figeeAt: null, etiquette: null }), 'ouverte');
});

test('etatJournee : journée sans adaptable — pleine et heures toutes communiquées = figée, pleine sinon, jamais « ouverte »', () => {
  const fige = (extra = {}) => ({ ...rdv('maintenance', 'Lavaur'), hour_confirmed_at: '2026-09-21T17:20:03Z', ...extra });
  const base = { verdict: 'sans_adaptable', figeeAt: null, etiquette: 'Lavaur' };
  // Figée avant que la trace de journée existe (vendredi 16/10 d'Antoine) : trois entretiens à l'heure communiquée, plus de place.
  assert.equal(etatJournee({ ...base, rdvs: [fige(), fige(), fige()], pleine: true }), 'figee');
  // Une visite technique ce jour-là n'empêche rien : seuls les entretiens / SAV ont une heure à communiquer.
  assert.equal(etatJournee({ ...base, rdvs: [fige(), rdv('rdv_technical', null)], pleine: true }), 'figee');
  // Un RDV annulé non confirmé ne compte pas.
  assert.equal(etatJournee({ ...base, rdvs: [fige(), rdv('maintenance', 'Lavaur', 'cancelled')], pleine: true }), 'figee');
  // Un seul RDV à l'heure imposée, journée loin d'être pleine : elle reste ouverte, la machine peut la remplir.
  assert.equal(etatJournee({ ...base, rdvs: [fige()], pleine: false }), 'ouverte');
  // Pleine sans être figée : une installation qui occupe le jour, ou un entretien ponctuel jamais confirmé.
  assert.equal(etatJournee({ ...base, rdvs: [rdv('installation', null)], pleine: true }), 'pleine');
  assert.equal(etatJournee({ ...base, rdvs: [fige(), { ...rdv('maintenance', 'Lavaur'), time_flex_minutes: 0 }], pleine: true }), 'pleine');
  // `pleine` ne joue que sans adaptable : avec des adaptables, c'est le verdict du moteur qui parle.
  assert.equal(etatJournee({ rdvs: [fige()], verdict: 'non_pleine', figeeAt: null, etiquette: null, pleine: true }), 'ouverte');
});

test('LIBELLES_ETAT couvre exactement les cinq états', () => {
  assert.deepEqual(Object.keys(LIBELLES_ETAT).sort(), ['a_arbitrer', 'figee', 'ouverte', 'pleine', 'vide']);
});
