// Tests du registre des campagnes SMS + helpers purs (Settings → Organisation → SMS,
// confirmation de RDV depuis ContractModal).
// Lancer : node --test scripts/sms-campaigns.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SMS_CAMPAIGNS,
  getSmsCampaign,
  formatSmsDate,
  formatSmsHour,
  buildConfirmationRdvVars,
  smsNameForMember,
  normalizeSmsTemplates,
  listSmsCampaignsForEditor,
  estimateSmsSegments,
  findUnknownVariables,
  deburrSms,
} from '../src/lib/smsCampaigns.js';

const VAR_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

test('registre — les 3 campagnes appelées par le code, variables de confirmation_rdv', () => {
  assert.deepEqual(
    SMS_CAMPAIGNS.map((c) => c.key),
    ['avis_j1', 'rappel_entretien', 'confirmation_rdv'],
  );
  const conf = getSmsCampaign('confirmation_rdv');
  assert.deepEqual(conf.variables.map((v) => v.name), ['prenom', 'date', 'heure', 'technicien']);
  assert.equal(getSmsCampaign('inconnue'), null);
});

test('registre — chaque texte suggéré n’utilise que les variables de sa campagne', () => {
  for (const campaign of SMS_CAMPAIGNS) {
    const allowed = new Set([...campaign.variables.map((v) => v.name), 'short_link', 'short_code']);
    const texts = Object.values(campaign.suggested || {}).filter((v) => typeof v === 'string');
    assert.ok(texts.length > 0, `${campaign.key} : aucun texte suggéré`);
    for (const txt of texts) {
      for (const m of txt.matchAll(VAR_RE)) {
        assert.ok(allowed.has(m[1]), `${campaign.key} : variable {{${m[1]}}} hors registre`);
      }
    }
  }
  const conf = getSmsCampaign('confirmation_rdv');
  const used = new Set([...conf.suggested.sms.matchAll(VAR_RE)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), ['date', 'heure', 'prenom', 'technicien']);
});

test('formatSmsDate — jour de semaine + jour + mois, sans année, « 1er »', () => {
  assert.equal(formatSmsDate('2026-10-13'), 'mardi 13 octobre');
  assert.equal(formatSmsDate('2026-10-01'), 'jeudi 1er octobre');
  assert.equal(formatSmsDate('2026-12-25'), 'vendredi 25 décembre');
  assert.equal(formatSmsDate(''), '');
  assert.equal(formatSmsDate(null), '');
  assert.equal(formatSmsDate('n/a'), '');
});

test('formatSmsHour — 9h30 / 14h, tolère les secondes', () => {
  assert.equal(formatSmsHour('09:30'), '9h30');
  assert.equal(formatSmsHour('14:00'), '14h');
  assert.equal(formatSmsHour('14:00:00'), '14h');
  assert.equal(formatSmsHour('08:05'), '8h05');
  assert.equal(formatSmsHour(null), '');
  assert.equal(formatSmsHour('abc'), '');
});

test('buildConfirmationRdvVars — exactement les 4 variables, toujours des chaînes', () => {
  const vars = buildConfirmationRdvVars({
    clientFirstName: ' Jean ',
    date: '2026-10-13',
    startTime: '09:30',
    technicianName: 'Philippe',
  });
  assert.deepEqual(vars, { prenom: 'Jean', date: 'mardi 13 octobre', heure: '9h30', technicien: 'Philippe' });
  assert.deepEqual(buildConfirmationRdvVars({}), { prenom: '', date: '', heure: '', technicien: '' });
});

test('smsNameForMember — prénom du technicien, repli nom complet', () => {
  assert.equal(smsNameForMember({ first_name: 'Philippe', display_name: 'Philippe Mayer' }), 'Philippe');
  assert.equal(smsNameForMember({ first_name: '', display_name: 'Philippe Mayer' }), 'Philippe Mayer');
  assert.equal(smsNameForMember(null), '');
});

test('normalizeSmsTemplates — retire les textes vides et les campagnes sans texte, deburr seulement si vrai', () => {
  const out = normalizeSmsTemplates({
    avis_j1: { whatsapp: '  Bonjour  ', sms: '', deburr: false },
    rappel_entretien: { whatsapp: '', sms: '   ', deburr: true },
    confirmation_rdv: { sms: 'RDV {{date}}', deburr: true },
  });
  assert.deepEqual(out, {
    avis_j1: { whatsapp: 'Bonjour' },
    confirmation_rdv: { sms: 'RDV {{date}}', deburr: true },
  });
  assert.deepEqual(normalizeSmsTemplates(undefined), {});
});

test('listSmsCampaignsForEditor — registre d’abord, clés inconnues en base préservées et signalées', () => {
  const rows = listSmsCampaignsForEditor({ confirmation_rdv: { sms: 'x' }, legacy_promo: { sms: 'y' } });
  assert.deepEqual(rows.map((r) => r.key), ['avis_j1', 'rappel_entretien', 'confirmation_rdv', 'legacy_promo']);
  assert.equal(rows[2].unknown, false);
  assert.equal(rows[3].unknown, true);
  assert.deepEqual(rows[3].variables, []);
  assert.deepEqual(listSmsCampaignsForEditor(undefined).map((r) => r.key), SMS_CAMPAIGNS.map((c) => c.key));
});

test('estimateSmsSegments — GSM-7 160/segment, UCS-2 70/segment dès un caractère hors GSM', () => {
  assert.deepEqual(estimateSmsSegments('Bonjour, RDV confirme.'), { chars: 22, segments: 1, encoding: 'gsm7' });
  assert.deepEqual(estimateSmsSegments('a'.repeat(160)), { chars: 160, segments: 1, encoding: 'gsm7' });
  assert.deepEqual(estimateSmsSegments('a'.repeat(161)), { chars: 161, segments: 2, encoding: 'gsm7' });
  // « é » appartient à l'alphabet GSM-7, « ê » non ; « € » est un caractère d'extension (compte double).
  assert.equal(estimateSmsSegments('café').encoding, 'gsm7');
  assert.equal(estimateSmsSegments('fête').encoding, 'ucs2');
  assert.deepEqual(estimateSmsSegments('10€'), { chars: 4, segments: 1, encoding: 'gsm7' });
  assert.deepEqual(estimateSmsSegments('ê'.repeat(70)), { chars: 70, segments: 1, encoding: 'ucs2' });
  assert.deepEqual(estimateSmsSegments('ê'.repeat(71)), { chars: 71, segments: 2, encoding: 'ucs2' });
  assert.deepEqual(estimateSmsSegments(''), { chars: 0, segments: 0, encoding: 'gsm7' });
});

test('findUnknownVariables — signale les {{…}} hors registre, accents et fautes de frappe compris', () => {
  const conf = getSmsCampaign('confirmation_rdv');
  assert.deepEqual(findUnknownVariables('Bonjour {{prenom}}, le {{date}} à {{heure}}', conf), []);
  assert.deepEqual(findUnknownVariables('Bonjour {{prénom}}, le {{ date }} avec {{tech}}', conf), ['prénom', 'tech']);
  // short_link / short_code sont injectés par l'edge pour toute campagne
  assert.deepEqual(findUnknownVariables('Avis : {{short_link}} {{short_code}}', conf), []);
  // campagne inconnue du code : rien à valider
  assert.deepEqual(findUnknownVariables('{{nimporte}}', { key: 'x', variables: [], unknown: true }), []);
  assert.deepEqual(findUnknownVariables('', conf), []);
});

test('deburrSms — même règle que l’edge : accents retirés, apostrophes et ponctuation intactes', () => {
  assert.equal(deburrSms('Fête à Noël, empêchement, ça marche !'), 'Fete a Noel, empechement, ca marche !');
  assert.equal(deburrSms("l'entretien d’été"), "l'entretien d’ete");
  assert.equal(deburrSms(''), '');
});
