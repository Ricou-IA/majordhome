import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEQUENCES_EMAILS, sequenceEmail, estSequence, nomDuSegment, lireSaisieDelai, delaiDuSegment,
  filtresDuSegment, filtresAvecDelai, etatSequence, phraseDelai, DUREE_FENETRE_JOURS,
} from '../src/lib/sequencesEmails.js';
import { EMAILS_AUTOMATIQUES, VARIABLES_MARQUE, texteEffectif, emailOuSequence, variablesDe } from '../src/lib/emailsAutomatiques.js';

const lire = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const accueil = sequenceEmail('sequence_accueil_lead');
const relanceContact = sequenceEmail('sequence_relance_contact');
const relanceDevis = sequenceEmail('sequence_relance_devis');

test('chaque séquence a une clé unique, un texte, un statut et une cadence', () => {
  const cles = SEQUENCES_EMAILS.map((s) => s.gabarit.key);
  assert.equal(new Set(cles).size, cles.length);
  assert.equal(new Set(SEQUENCES_EMAILS.map((s) => s.gabarit.label)).size, cles.length, 'le journal des envois est tenu par le nom');
  const autres = new Set(EMAILS_AUTOMATIQUES.map((e) => e.gabarit.key));
  for (const s of SEQUENCES_EMAILS) {
    assert.match(s.gabarit.key, /^sequence_[a-z_]+$/);
    assert.ok(!autres.has(s.gabarit.key), 'pas de clé partagée avec un e-mail du registre');
    assert.ok(s.gabarit.subject.trim() && s.gabarit.html_body.trim() && s.titre.trim() && s.description.trim());
    assert.ok(['Nouveau', 'Contacté', 'Devis envoyé', 'Perdu'].includes(s.statut));
    assert.ok(s.cadence.auto_cadence_days || s.cadence.auto_cadence_minutes, 'sans cadence la campagne ne repart jamais');
    assert.equal(s.repere === null, s.delaiDefaut === null);
  }
});

test('un texte par défaut ne cite aucune entreprise et seulement des variables remplies par mailing-send', () => {
  const connues = new Set([...VARIABLES_MARQUE, '{{SALUTATION}}', '{{CLIENT_NAME}}']);
  for (const s of SEQUENCES_EMAILS) {
    const texte = `${s.gabarit.subject} ${s.gabarit.html_body}`;
    for (const v of variablesDe(texte)) assert.ok(connues.has(v), `${s.gabarit.key} : ${v}`);
    assert.doesNotMatch(texte, /mayer|cimaj/i);
    assert.doesNotMatch(texte, /\{\{ORG_PHONE\}\}/, 'une entreprise sans téléphone laisserait une phrase trouée');
    assert.match(s.gabarit.html_body, /mailto:\{\{ORG_EMAIL\}\}\?subject=Désabonnement/, 'lien de désinscription');
  }
});

test('l’accueil ne part jamais vers un prospect arrivé avant l’allumage', () => {
  const f = filtresDuSegment(accueil, { statutId: 'st-nouveau', depuis: '2026-11-21T10:00:00.000Z' });
  assert.deepEqual(f, {
    audience: 'leads',
    base: { kind: 'lead_status', status_ids: ['st-nouveau'] },
    attributes: { created_between: { from: '2026-11-21T10:00:00.000Z' } },
    mailing_history: { exclude_current_campaign: true },
  });
  assert.throws(() => filtresDuSegment(accueil, { statutId: 'st-nouveau' }), /date_d_allumage_requise/);
  assert.throws(() => filtresDuSegment(accueil, { statutId: '', depuis: '2026-11-21' }), /statut_inconnu/);
});

test('une relance vise une fenêtre de jours : après le statut, ou après le devis', () => {
  const c = filtresDuSegment(relanceContact, { statutId: 'st-contacte', depuis: 'x' });
  assert.deepEqual(c.base, { kind: 'lead_status', status_ids: ['st-contacte'], days_in_status_min: 7, days_in_status_max: 7 + DUREE_FENETRE_JOURS });
  assert.deepEqual(c.attributes, {});
  const d = filtresDuSegment(relanceDevis, { statutId: 'st-devis', delai: 10, depuis: 'x' });
  assert.equal(d.base.days_since_quote_min, 10);
  assert.equal(d.base.days_since_quote_max, 17);
  assert.equal(d.mailing_history.exclude_current_campaign, true, 'une seule fois par prospect');
  assert.throws(() => filtresDuSegment(relanceDevis, { statutId: 'st', delai: 0, depuis: 'x' }), /delai_invalide/);
});

test('changer le délai garde l’écart et les autres filtres du segment', () => {
  const mayer = {
    audience: 'leads', attributes: { zones: ['gaillac'] },
    base: { kind: 'lead_status', status_ids: ['s'], days_since_quote_min: 10, days_since_quote_max: 21 },
    mailing_history: { exclude_within_days: 30, exclude_current_campaign: true },
  };
  const f = filtresAvecDelai(relanceDevis, mayer, 5);
  assert.equal(f.base.days_since_quote_min, 5);
  assert.equal(f.base.days_since_quote_max, 16);
  assert.deepEqual(f.attributes, mayer.attributes);
  assert.deepEqual(f.mailing_history, mayer.mailing_history);
  assert.equal(mayer.base.days_since_quote_min, 10, 'l’original n’est pas modifié');
  assert.throws(() => filtresAvecDelai(accueil, mayer, 5), /sequence_sans_delai/);
  assert.throws(() => filtresAvecDelai(relanceDevis, mayer, 400), /delai_invalide/);
});

test('saisie d’un délai', () => {
  assert.equal(lireSaisieDelai('7'), 7);
  assert.equal(lireSaisieDelai(' 12 '), 12);
  assert.equal(lireSaisieDelai('7,5'), null);
  assert.equal(lireSaisieDelai(''), null);
  assert.equal(lireSaisieDelai(0), null);
  assert.equal(lireSaisieDelai(91), null);
});

test('état d’une séquence : allumée seulement avec une campagne automatique et son segment', () => {
  const segment = { filters: { base: { days_in_status_min: 9, days_in_status_max: 16 } }, is_archived: false };
  assert.deepEqual(etatSequence(relanceContact, { is_automated: true, auto_segment_id: 'x' }, segment), { allumee: true, delai: 9 });
  assert.deepEqual(etatSequence(relanceContact, { is_automated: false, auto_segment_id: 'x' }, segment), { allumee: false, delai: 9 });
  assert.deepEqual(etatSequence(relanceContact, { is_automated: true, auto_segment_id: 'x' }, null), { allumee: false, delai: 7 });
  assert.deepEqual(etatSequence(relanceContact, { is_automated: true, auto_segment_id: 'x' }, { ...segment, is_archived: true }).allumee, false);
  assert.deepEqual(etatSequence(relanceContact, null, null), { allumee: false, delai: 7 });
  assert.equal(delaiDuSegment(accueil, segment.filters), null);
});

test('phrases et noms', () => {
  assert.equal(phraseDelai(accueil, null), 'Dans les minutes qui suivent la demande.');
  assert.equal(phraseDelai(relanceDevis, 1), '1 jour après l’envoi du devis, une seule fois.');
  assert.equal(phraseDelai(relanceContact, 7), '7 jours après le passage en « Contacté », une seule fois.');
  assert.equal(nomDuSegment(accueil), 'Séquence — Accueil d’un nouveau prospect');
});

test('le texte d’une séquence a son défaut, comme un e-mail du registre', () => {
  assert.equal(estSequence('sequence_relance_devis'), true);
  assert.equal(estSequence('facture_entretien'), false);
  assert.equal(estSequence(null), false);
  assert.equal(emailOuSequence('sequence_relance_devis'), relanceDevis);
  assert.equal(emailOuSequence('pv_reception')?.gabarit.key, 'pv_reception');
  assert.equal(texteEffectif(null, 'sequence_relance_devis').source, 'defaut');
  assert.equal(texteEffectif({ subject: 'A', html_body: '<p>B</p>' }, 'sequence_relance_devis').source, 'entreprise');
});

test('les edges : une séquence part de l’adresse commune, seulement quand c’est le planificateur qui le dit', () => {
  const envoi = lire('supabase/functions/mailing-send/index.ts');
  assert.match(envoi, /auth\.isServiceRole && estSequence\(/, 'un appel d’utilisateur ne peut pas se dire séquence');
  assert.match(lire('supabase/functions/mailing-scheduler/index.ts'), /campaign_key: c\.campaign_key/);
  assert.match(lire('supabase/functions/email-essai/index.ts'), /emailOuSequence\(/);
});
