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
  buildRappelRdvVars,
  buildRappelRdvConfig,
  planifierRappelRdv,
  decrireRappelRdv,
  jourSemaineIso,
  ajouterJours,
  JOURS_SEMAINE,
  smsNameForMember,
  normalizeSmsTemplates,
  listSmsCampaignsForEditor,
  estimateSmsSegments,
  findUnknownVariables,
  deburrSms,
  renderSmsTemplate,
  sampleVarsFor,
  coutSmsMessage,
} from '../src/lib/smsCampaigns.js';

const VAR_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

test('registre — les 4 campagnes appelées par le code, variables de rappel_rdv et heure_de_passage', () => {
  assert.deepEqual(
    SMS_CAMPAIGNS.map((c) => c.key),
    ['avis_j1', 'rappel_entretien', 'rappel_rdv', 'heure_de_passage'],
  );
  // « Figer la journée » (savService.sendHeureDePassage) envoie exactement ces variables
  assert.deepEqual(
    getSmsCampaign('heure_de_passage').variables.map((v) => v.name),
    ['first_name', 'name', 'date', 'heure', 'technicien'],
  );
  const conf = getSmsCampaign('rappel_rdv');
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
  const conf = getSmsCampaign('rappel_rdv');
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

test('buildRappelRdvVars — exactement les 4 variables, toujours des chaînes', () => {
  const vars = buildRappelRdvVars({
    clientFirstName: ' Jean ',
    date: '2026-10-13',
    startTime: '09:30',
    technicianName: 'Philippe',
  });
  assert.deepEqual(vars, { prenom: 'Jean', date: 'mardi 13 octobre', heure: '9h30', technicien: 'Philippe' });
  assert.deepEqual(buildRappelRdvVars({}), { prenom: '', date: '', heure: '', technicien: '' });
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
    rappel_rdv: { sms: 'RDV {{date}}', deburr: true },
  });
  assert.deepEqual(out, {
    avis_j1: { whatsapp: 'Bonjour' },
    rappel_rdv: { sms: 'RDV {{date}}', deburr: true },
  });
  assert.deepEqual(normalizeSmsTemplates(undefined), {});
});

test('listSmsCampaignsForEditor — registre d’abord, clés inconnues en base préservées et signalées', () => {
  const rows = listSmsCampaignsForEditor({ rappel_rdv: { sms: 'x' }, legacy_promo: { sms: 'y' } });
  assert.deepEqual(rows.map((r) => r.key), ['avis_j1', 'rappel_entretien', 'rappel_rdv', 'heure_de_passage', 'legacy_promo']);
  assert.equal(rows[2].unknown, false);
  assert.equal(rows[4].unknown, true);
  assert.deepEqual(rows[4].variables, []);
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
  const conf = getSmsCampaign('rappel_rdv');
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

test('jourSemaineIso / ajouterJours — lundi = 1, dimanche = 7, arithmétique de dates sans fuseau', () => {
  assert.equal(jourSemaineIso('2026-09-14'), 1); // lundi
  assert.equal(jourSemaineIso('2026-09-20'), 7); // dimanche
  assert.equal(ajouterJours('2026-09-14', 6), '2026-09-20');
  assert.equal(ajouterJours('2026-12-31', 1), '2027-01-01');
  assert.equal(ajouterJours('2026-03-28', 2), '2026-03-30'); // passage à l'heure d'été sans glissement
});

test('buildRappelRdvConfig — défauts off / lundi / 8h, valeurs hors bornes ramenées aux défauts', () => {
  assert.deepEqual(buildRappelRdvConfig(undefined), { mode: 'off', jour: 1, heure: 8 });
  assert.deepEqual(buildRappelRdvConfig({ rappel_rdv: { mode: 'veille', heure: 18 } }), { mode: 'veille', jour: 1, heure: 18 });
  assert.deepEqual(buildRappelRdvConfig({ rappel_rdv: { mode: 'hebdo', jour: 5, heure: 9 } }), { mode: 'hebdo', jour: 5, heure: 9 });
  assert.deepEqual(buildRappelRdvConfig({ rappel_rdv: { mode: 'demain', jour: 9, heure: 3 } }), { mode: 'off', jour: 1, heure: 8 });
});

test('planifierRappelRdv — veille : chaque jour à H (tolérance H+1), fenêtre = lendemain', () => {
  const cfg = { mode: 'veille', jour: 1, heure: 8 };
  assert.deepEqual(planifierRappelRdv(cfg, { date: '2026-09-15', heure: 8 }), { debut: '2026-09-16', fin: '2026-09-16' });
  assert.deepEqual(planifierRappelRdv(cfg, { date: '2026-09-15', heure: 9 }), { debut: '2026-09-16', fin: '2026-09-16' });
  assert.equal(planifierRappelRdv(cfg, { date: '2026-09-15', heure: 7 }), null);
  assert.equal(planifierRappelRdv(cfg, { date: '2026-09-15', heure: 10 }), null);
});

test('planifierRappelRdv — hebdo : le jour choisi à H, fenêtre = 7 jours à partir du jour même', () => {
  const lundi = { mode: 'hebdo', jour: 1, heure: 8 };
  assert.deepEqual(planifierRappelRdv(lundi, { date: '2026-09-14', heure: 8 }), { debut: '2026-09-14', fin: '2026-09-20' });
  assert.equal(planifierRappelRdv(lundi, { date: '2026-09-15', heure: 8 }), null); // mardi
  const vendredi = { mode: 'hebdo', jour: 5, heure: 17 };
  assert.deepEqual(planifierRappelRdv(vendredi, { date: '2026-09-18', heure: 18 }), { debut: '2026-09-18', fin: '2026-09-24' });
});

test('planifierRappelRdv — off ou config invalide : jamais rien', () => {
  assert.equal(planifierRappelRdv({ mode: 'off', jour: 1, heure: 8 }, { date: '2026-09-14', heure: 8 }), null);
  assert.equal(planifierRappelRdv(undefined, { date: '2026-09-14', heure: 8 }), null);
});

test('decrireRappelRdv — phrase lisible pour l’onglet Settings', () => {
  assert.equal(decrireRappelRdv({ mode: 'off', jour: 1, heure: 8 }), 'Désactivé : aucun rappel automatique.');
  assert.equal(decrireRappelRdv({ mode: 'veille', jour: 1, heure: 18 }), 'Chaque jour à 18h, pour les rendez-vous du lendemain.');
  assert.equal(decrireRappelRdv({ mode: 'hebdo', jour: 1, heure: 8 }), 'Chaque lundi à 8h, pour les rendez-vous des 7 jours suivants.');
  assert.equal(JOURS_SEMAINE[0].label, 'lundi');
  assert.equal(JOURS_SEMAINE.length, 7);
});


test('buildRappelRdvVars — prénom stocké en MAJUSCULES rendu en capitale initiale (composés, accents, apostrophe)', () => {
  assert.equal(buildRappelRdvVars({ clientFirstName: 'LUCILLE' }).prenom, 'Lucille');
  assert.equal(buildRappelRdvVars({ clientFirstName: 'JEAN-PIERRE' }).prenom, 'Jean-Pierre');
  assert.equal(buildRappelRdvVars({ clientFirstName: 'marie claire' }).prenom, 'Marie Claire');
  assert.equal(buildRappelRdvVars({ clientFirstName: 'VÉRONIQUE' }).prenom, 'Véronique');
  assert.equal(buildRappelRdvVars({ clientFirstName: "D'ANGELO" }).prenom, "D'Angelo");
  assert.equal(buildRappelRdvVars({ clientFirstName: '' }).prenom, '');
});

test('renderSmsTemplate — substitution {{…}}, variable absente effacée, ponctuation recollée (virgule/point seulement)', () => {
  assert.equal(renderSmsTemplate('Bonjour {{prenom}}, RDV le {{ date }} !', { prenom: 'Jean', date: 'mardi' }), 'Bonjour Jean, RDV le mardi !');
  assert.equal(renderSmsTemplate('Bonjour {{prenom}}, à bientôt.', {}), 'Bonjour, à bientôt.');
  assert.equal(renderSmsTemplate('Merci {{prenom}} !', {}), 'Merci !'); // l espace avant « ! » reste (typographie FR)
  assert.equal(renderSmsTemplate('A  {{x}}  B', { x: '' }), 'A B');
});

test('sampleVarsFor — exemple rendu réaliste par campagne, lien court sur le domaine de l’org', () => {
  const rappel = sampleVarsFor(getSmsCampaign('rappel_rdv'), {});
  assert.deepEqual(Object.keys(rappel).sort(), ['date', 'heure', 'prenom', 'short_code', 'short_link', 'technicien']);
  assert.equal(rappel.date, 'mercredi 16 septembre');
  const avis = sampleVarsFor(getSmsCampaign('avis_j1'), { short_link_base: 'www.mayer-energie.fr/a' });
  assert.equal(avis.short_link, 'www.mayer-energie.fr/a/Ab3Kx9');
  assert.equal(sampleVarsFor(getSmsCampaign('avis_j1'), {}).short_link, 'votre-site.fr/a/Ab3Kx9');
  assert.deepEqual(sampleVarsFor({ key: 'x', variables: [], unknown: true }, {}), { short_link: 'votre-site.fr/a/Ab3Kx9', short_code: 'Ab3Kx9' });
});

test('coutSmsMessage — coût en SMS d’un gabarit sur son exemple rendu, accents retirés si demandé', () => {
  const tpl = getSmsCampaign('rappel_rdv').suggested.sms;
  const avecAccents = coutSmsMessage(tpl, { campaign: getSmsCampaign('rappel_rdv'), sms: {}, deburr: false });
  const sansAccents = coutSmsMessage(tpl, { campaign: getSmsCampaign('rappel_rdv'), sms: {}, deburr: true });
  assert.equal(avecAccents.sms, 3);
  assert.equal(avecAccents.encoding, 'ucs2');
  assert.equal(sansAccents.sms, 1);
  assert.equal(sansAccents.encoding, 'gsm7');
  assert.match(sansAccents.apercu, /^Bonjour Veronique, rappel : votre entretien est prevu le mercredi 16 septembre a 12h30 avec Antoine\./);
  assert.deepEqual(coutSmsMessage('', { campaign: getSmsCampaign('rappel_rdv'), sms: {}, deburr: false }), { sms: 0, encoding: 'gsm7', apercu: '' });
});
