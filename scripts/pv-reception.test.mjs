// Tests du module pur src/lib/pvReception.js — `node --test scripts/pv-reception.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validerReponsePv, normaliserReponsePv, messagePv, PV_CODES, objetDuPv, dateLongue, periodeDePose,
  jourDeParis, donneesPdfPv, DEFAULT_PV_RECEPTION_EMAIL, PV_RECEPTION_TEMPLATE_KEY, PV_SIGNATURE_MAX,
  validerReponseLevee, validerReponseReserves, donneesPdfLevee, DEFAULT_PV_LEVEE_EMAIL, PV_LEVEE_TEMPLATE_KEY,
} from '../src/lib/pvReception.js';

const SIGNATURE = `data:image/png;base64,${'A'.repeat(400)}`;
const reponse = (extra = {}) => ({
  reception_type: 'sans_reserves', signataire_nom: 'Marie DURAND', signature_png: SIGNATURE,
  reserves_nature: '', reserves_travaux: '', info_recues: true, notices_recues: true, entretien_recues: false,
  ...extra,
});

test('validation : une réponse complète passe', () => {
  assert.equal(validerReponsePv(reponse()), null);
  assert.equal(validerReponsePv(reponse({ reception_type: 'avec_reserves', reserves_nature: 'Joint à reprendre' })), null);
});

test('validation : chaque manque a son code, dans l\'ordre de la RPC', () => {
  assert.equal(validerReponsePv(null), 'choix_requis');
  assert.equal(validerReponsePv(reponse({ reception_type: 'autre' })), 'choix_requis');
  assert.equal(validerReponsePv(reponse({ signataire_nom: '   ' })), 'nom_requis');
  assert.equal(validerReponsePv(reponse({ signataire_nom: 'x'.repeat(121) })), 'nom_requis');
  assert.equal(validerReponsePv(reponse({ signature_png: '' })), 'signature_requise');
  assert.equal(validerReponsePv(reponse({ signature_png: 'data:image/jpeg;base64,AAAA' })), 'signature_requise');
  assert.equal(validerReponsePv(reponse({ signature_png: `data:image/png;base64,${'A'.repeat(PV_SIGNATURE_MAX)}` })), 'signature_requise');
  assert.equal(validerReponsePv(reponse({ reception_type: 'avec_reserves', reserves_nature: '  ' })), 'reserves_a_decrire');
  assert.equal(validerReponsePv(reponse({ reception_type: 'avec_reserves', reserves_nature: 'x'.repeat(2001) })), 'texte_trop_long');
});

test('chaque code de la validation a un message', () => {
  for (const code of ['choix_requis', 'nom_requis', 'signature_requise', 'reserves_a_decrire', 'texte_trop_long', 'deja_signe', 'token_expired', 'template_missing']) {
    assert.ok(PV_CODES.includes(code), `${code} sans message`);
    assert.notEqual(messagePv(code), messagePv('code_inconnu'));
  }
  assert.equal(messagePv('code_inconnu', 'repli'), 'repli');
});

test('normalisation : textes rognés, réserves vidées sans réserve, plus de cases booléennes', () => {
  const n = normaliserReponsePv(reponse({ signataire_nom: '  Marie DURAND ', reserves_nature: 'oubli', info_recues: 'oui', notices_recues: undefined }));
  assert.equal(n.signataire_nom, 'Marie DURAND');
  assert.equal(n.reserves_nature, '');
  for (const k of ['info_recues', 'notices_recues', 'entretien_recues']) assert.equal(k in n, false);
  const avec = normaliserReponsePv(reponse({ reception_type: 'avec_reserves', reserves_nature: ' Joint ', reserves_travaux: ' Le reprendre ' }));
  assert.equal(avec.reserves_nature, 'Joint');
  assert.equal(avec.reserves_travaux, 'Le reprendre');
});

test('objet : type puis libellé, sans doublon, jamais vide', () => {
  assert.equal(objetDuPv({ equipement: 'Poêle à bois', libelle: 'Pose salon' }), 'Poêle à bois · Pose salon');
  assert.equal(objetDuPv({ equipement: 'Climatisation', libelle: ' climatisation ' }), 'Climatisation');
  assert.equal(objetDuPv({}), 'Installation');
});

test('dates : en toutes lettres, « 1er », sans glissement de jour', () => {
  assert.equal(dateLongue('2026-11-04'), '4 novembre 2026');
  assert.equal(dateLongue('2026-12-01'), '1er décembre 2026');
  assert.equal(dateLongue('pas une date'), '');
  assert.equal(periodeDePose([]), '');
  assert.equal(periodeDePose(['2026-11-04']), 'le 4 novembre 2026');
  assert.equal(periodeDePose(['2026-11-05', '2026-11-03', '2026-11-05']), 'du 3 novembre 2026 au 5 novembre 2026');
});

test('jour de signature : à l\'heure de Paris', () => {
  assert.equal(jourDeParis('2026-11-17T23:30:00Z'), '2026-11-18');
  assert.equal(jourDeParis('2026-11-17T10:00:00Z'), '2026-11-17');
  assert.equal(jourDeParis('n\'importe quoi'), '');
});

test('PDF : les données viennent de l\'enregistrement, sans signature d\'entreprise', () => {
  const d = donneesPdfPv({
    chantierId: 'abcdef12-0000-0000-0000-000000000000',
    client: { prenom: 'Marie', nom: 'DURAND', adresse: '12 chemin des Vignes', code_postal: '81600', ville: 'Gaillac' },
    objet: 'Poêle à bois',
    entreprise: 'Mayer Énergie',
    signature: {
      signed_at: '2026-11-17T10:00:00Z', signataire_nom: 'Marie DURAND', signature_png: SIGNATURE,
      reception_type: 'avec_reserves', reserves_nature: 'Joint', reserves_travaux: null,
      info_recues: true, notices_recues: false, entretien_recues: true,
    },
  });
  assert.equal(d.pvNumber, 'PV-ABCDEF12');
  assert.equal(d.pvDate, '17 novembre 2026');
  assert.equal(d.clientName, 'DURAND Marie');
  assert.equal(d.receptionType, 'avec_reserves');
  assert.equal(d.reservesNature, 'Joint');
  assert.equal(d.reservesTravaux, null);
  assert.equal(d.noticesRecues, false);
  assert.equal(d.signatureClientBase64, SIGNATURE);
  assert.equal(d.signatureTechBase64, null);
  assert.equal(d.signatureTechNom, 'Mayer Énergie');
  assert.equal(d.orderAmountHT, null);
});

test('PDF : une réception sans réserve ne porte aucune réserve, même si le texte traîne', () => {
  const d = donneesPdfPv({ chantierId: 'x', client: {}, objet: '', entreprise: '', signature: { reception_type: 'sans_reserves', reserves_nature: 'reste' } });
  assert.equal(d.reservesNature, null);
  assert.equal(d.clientName, 'Client');
});

test('gabarit d\'e-mail : clé, lien et transactionnel', () => {
  assert.equal(DEFAULT_PV_RECEPTION_EMAIL.key, PV_RECEPTION_TEMPLATE_KEY);
  assert.equal(DEFAULT_PV_RECEPTION_EMAIL.is_transactional, true);
  assert.ok(DEFAULT_PV_RECEPTION_EMAIL.html_body.includes('{{LIEN_PV}}'));
  assert.ok(DEFAULT_PV_RECEPTION_EMAIL.html_body.includes('{{PRENOM}}'));
});

const complete = reponse();
const sig = SIGNATURE;
const base = {
  chantierId: 'abcdef12-0000-0000-0000-000000000000',
  client: { prenom: 'Marie', nom: 'DURAND', adresse: '12 chemin des Vignes', code_postal: '81600', ville: 'Gaillac' },
  objet: 'Poêle à bois',
  entreprise: 'Mayer Énergie',
};
const signee = {
  signed_at: '2026-11-17T10:00:00Z', signataire_nom: 'Marie DURAND', signature_png: sig,
  reception_type: 'sans_reserves',
};
const avecReserves = { ...signee, reception_type: 'avec_reserves', reserves_nature: 'Joint', reserves_travaux: 'Reprise du joint' };

test('normalisation : clés confirmées dédoublonnées, plus de booléens', () => {
  const r = normaliserReponsePv({ ...complete, points_confirmes: ['c_notice', 'c_notice', '', 7] });
  assert.deepEqual(r.points_confirmes, ['c_notice']);
  assert.equal('info_recues' in r, false);
  assert.equal(normaliserReponsePv({ ...complete, points_confirmes: [' a ', ...Array.from({ length: 40 }, (_, i) => `k${i}`)] }).points_confirmes.length, 30);
  assert.deepEqual(normaliserReponsePv(complete).points_confirmes, []);
});
test('réserves : au moins un des deux, date jamais avant la signature', () => {
  assert.equal(validerReponseReserves({ reponse: ' ', echeance: null }, '2026-11-20'), 'reponse_vide');
  assert.equal(validerReponseReserves({ reponse: '', echeance: '2026-11-19' }, '2026-11-20'), 'echeance_invalide');
  assert.equal(validerReponseReserves({ reponse: '', echeance: '2026-11-20' }, '2026-11-20'), null);
  assert.equal(validerReponseReserves({ reponse: 'Reprise du joint', echeance: null }, '2026-11-20'), null);
  assert.equal(validerReponseReserves({ reponse: 'x', echeance: '20/11/2026' }, '2026-11-20'), 'echeance_invalide');
  assert.equal(validerReponseReserves({ reponse: 'x', echeance: '2026-02-30' }, '2026-11-20'), 'echeance_invalide');
  assert.equal(validerReponseReserves({ reponse: 'x'.repeat(2001), echeance: null }, '2026-11-20'), 'texte_trop_long');
});
test('levée : nom et signature, mêmes bornes que le PV', () => {
  assert.equal(validerReponseLevee({ signataire_nom: '', signature_png: sig }), 'nom_requis');
  assert.equal(validerReponseLevee({ signataire_nom: 'Marie Durand', signature_png: 'x' }), 'signature_requise');
  assert.equal(validerReponseLevee({ signataire_nom: 'Marie Durand', signature_png: sig }), null);
});
test('PDF du PV : points et devis lus dans l’enregistrement', () => {
  const d = donneesPdfPv({ ...base, signature: { ...signee, devis: [{ libelle: 'D-2026-0412', date: '2026-09-03' }],
    points_entreprise: [{ cle: 'e_mise_en_service', texte: 'T1', reponse: 'sans_objet' }],
    points_client: [{ cle: 'c_notice', texte: 'T2', confirme: false }] } });
  assert.deepEqual(d.devis, [{ libelle: 'D-2026-0412', date: '3 septembre 2026' }]);
  assert.deepEqual(d.pointsEntreprise, [{ texte: 'T1', reponse: 'sans objet' }]);
  assert.deepEqual(d.pointsClient, [{ texte: 'T2', confirme: false }]);
  assert.equal(d.infoRecues, false);
});
test('PDF du PV : sans points_client (tablette), les trois cases restent lues', () => {
  const d = donneesPdfPv({ ...base, signature: { ...signee, info_recues: true, notices_recues: true, entretien_recues: false } });
  assert.equal(d.infoRecues, true);
  assert.equal(d.noticesRecues, true);
  assert.equal(d.entretienRecues, false);
  assert.deepEqual(d.pointsClient, []);
  assert.deepEqual(d.devis, []);
});
test('PDF de levée : réponse et échéance absentes restent nulles', () => {
  const d = donneesPdfLevee({ ...base, pv: { ...avecReserves, levee_signed_at: '2026-12-01T10:00:00Z', levee_signataire_nom: 'Marie Durand', levee_signature_png: sig } });
  assert.equal(d.numero, 'LR-' + base.chantierId.slice(0, 8).toUpperCase());
  assert.equal(d.reponse, null); assert.equal(d.echeance, null);
  assert.equal(d.date, '1er décembre 2026');
  assert.equal(d.pvNumber, 'PV-ABCDEF12');
  assert.equal(d.pvDate, '17 novembre 2026');
  assert.equal(d.reservesNature, 'Joint');
  assert.equal(d.signatureNom, 'Marie Durand');
  assert.equal(d.entreprise, 'Mayer Énergie');
  assert.equal(d.lieu, 'Gaillac');
});
test('PDF de levée : réponse et échéance présentes', () => {
  const d = donneesPdfLevee({ ...base, pv: { ...avecReserves, reserves_reponse: 'Joint repris', reserves_echeance: '2026-11-25',
    levee_signed_at: '2026-12-01T10:00:00Z', levee_signataire_nom: 'M', levee_signature_png: sig, devis: [{ libelle: 'D1', date: '2026-09-03' }] } });
  assert.equal(d.reponse, 'Joint repris');
  assert.equal(d.echeance, '25 novembre 2026');
  assert.deepEqual(d.devis, [{ libelle: 'D1', date: '3 septembre 2026' }]);
});
test('chaque code nouveau a un message', () => {
  for (const c of ['pv_non_prepare','declaration_incomplete','point_inconnu','gabarit_inconnu','pas_de_reserves','levee_non_demandee','levee_deja_signee','echeance_invalide','reponse_vide']) {
    assert.notEqual(messagePv(c, 'DEFAUT'), 'DEFAUT');
  }
});
test('gabarit d’e-mail de levée : clé, lien et transactionnel', () => {
  assert.equal(DEFAULT_PV_LEVEE_EMAIL.key, PV_LEVEE_TEMPLATE_KEY);
  assert.equal(PV_LEVEE_TEMPLATE_KEY, 'pv_levee_reserves');
  assert.equal(DEFAULT_PV_LEVEE_EMAIL.is_transactional, true);
  for (const v of ['{{LIEN_PV}}', '{{PRENOM}}', '{{OBJET}}', '{{ACCENT_COLOR}}', '{{ORG_PHONE}}', '{{BRAND_NAME}}']) assert.ok(DEFAULT_PV_LEVEE_EMAIL.html_body.includes(v), v);
});
