// scripts/attestation-entretien-model.test.mjs — attestation d'entretien et de ramonage
// node --test scripts/attestation-entretien-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAttestationEntretien, eligibiliteAttestation, formatDateLettre, listeFr, attestationPathFor, MOTIFS,
} from '../src/lib/attestationEntretienModel.js';

const company = {
  name: 'Mayer Énergie', legalName: 'MAYER ENERGIE', address: '26 Rue des Pyrénées', postalCode: '81600', city: 'Gaillac',
  rcs: '100 288 224 R.C.S. Albi', rgeCertifications: ['Qualibois module Eau QB/84566'],
  signatoryName: 'Eric Pudebat', signatoryRole: 'Président',
};
const client = { name: 'Brigitte GARDERES', address: '11 Clos de Cornillas', postal_code: '82400', city: 'Valence' };
const bois = { showRamonage: true };
const cert = (patch = {}) => ({
  statut: 'signe', bilan_conformite: 'conforme', date_intervention: '2026-09-14', equipement_marque: 'Edilkamin',
  donnees_ramonage: { methode: 'mecanique', conduits: [{ resultat: 'ramone' }] },
  donnees_entretien: {
    nettoyage: { chambre_combustion: 'conforme', ventilateurs: 'conforme', filtre_air: 'na' },
    controles_securite: { dispositifs_securite: 'conforme' },
  },
  ...patch,
});
const items = {
  nettoyageItems: [
    { key: 'chambre_combustion', label: 'Chambre de combustion' },
    { key: 'ventilateurs', label: 'Ventilateurs' },
    { key: 'filtre_air', label: 'Filtre à air' },
  ],
  controleItems: [{ key: 'dispositifs_securite', label: 'Dispositifs de sécurité' }],
};
const texte = (lettre) => lettre.paragraphes.map((p) => p.map((s) => s.text).join('')).join('\n');

test('dates et listes françaises', () => {
  assert.deepEqual(formatDateLettre('2026-09-14'), { long: '14 septembre 2026', court: '14-09-2026' });
  assert.equal(formatDateLettre('n/a'), null);
  assert.equal(listeFr(['a']), 'a');
  assert.equal(listeFr(['a', 'b', 'c']), 'a, b et c');
});

test('lettre complète sur le cas GARDERES', () => {
  const r = buildAttestationEntretien({ certificat: cert(), sections: bois, appareil: 'Poêle à granulés', client, company, invoiceDate: '2026-09-14', ...items });
  assert.equal(r.eligible, true);
  const t = texte(r.lettre);
  assert.match(t, /Je soussigné, Eric Pudebat agissant en qualité de Président de la société MAYER ENERGIE/);
  assert.match(t, /immatriculée sous le n° 100 288 224 R\.C\.S\. Albi, titulaire de la qualification RGE Qualibois module Eau QB\/84566/);
  assert.match(t, /intervenu le 14 septembre 2026 au domicile de : Brigitte GARDERES, 11 Clos de Cornillas, 82400 VALENCE/);
  assert.match(t, /poêle à granulés de marque EDILKAMIN et du ramonage mécanique du conduit de fumée raccordé/);
  assert.match(t, /nettoyage : chambre de combustion et ventilateurs, le contrôle : dispositifs de sécurité/);
  assert.doesNotMatch(t, /filtre/i);
  assert.match(t, /brossage mécanique/);
  assert.match(t, /le conduit est déclaré vacant sur toute sa longueur et apte/);
  assert.match(t, /Elle se rapporte à la facture du 14 septembre 2026\./);
  assert.doesNotMatch(t, /acquitt|F-?2026/i);
  assert.equal(r.lettre.lieuDate, 'Gaillac, le 14 septembre 2026');
  assert.equal(r.lettre.faitA, 'Fait à Gaillac, le 14-09-2026');
  assert.deepEqual(r.lettre.destinataire, ['Brigitte GARDERES', '11 Clos de Cornillas', '82400 VALENCE']);
});

test('plusieurs conduits : accord au pluriel', () => {
  const r = buildAttestationEntretien({
    certificat: cert({ donnees_ramonage: { methode: 'mecanique', conduits: [{ resultat: 'ramone' }, { resultat: 'ramone' }] } }),
    sections: bois, appareil: 'Chaudière fioul', client, company, invoiceDate: '2026-10-24', ...items,
  });
  assert.match(texte(r.lettre), /des conduits de fumée raccordés.*les conduits sont déclarés vacants sur toute leur longueur et aptes/s);
});

test('garde-fou : pas d’attestation sur conduit obstrué, arrêt d’urgence, non signé, sans signataire', () => {
  assert.deepEqual(eligibiliteAttestation(cert({ donnees_ramonage: { conduits: [{ resultat: 'ramone' }, { resultat: 'obstrue' }] } }), bois, company), { eligible: false, motif: 'conduit_obstrue' });
  assert.deepEqual(eligibiliteAttestation(cert({ bilan_conformite: 'arret_urgence' }), bois, company), { eligible: false, motif: 'arret_urgence' });
  assert.deepEqual(eligibiliteAttestation(cert({ statut: 'brouillon' }), bois, company), { eligible: false, motif: 'certificat_non_signe' });
  assert.deepEqual(eligibiliteAttestation(cert(), bois, { ...company, signatoryName: '' }), { eligible: false, motif: 'signataire_manquant' });
  assert.deepEqual(eligibiliteAttestation(cert({ date_intervention: null }), bois, company), { eligible: false, motif: 'date_manquante' });
});

test('pas de ramonage : motif silencieux (PAC, clim, conduits N/A)', () => {
  assert.equal(eligibiliteAttestation(cert(), { showRamonage: false }, company).motif, 'pas_de_ramonage');
  assert.equal(eligibiliteAttestation(cert({ donnees_ramonage: { conduits: [{ resultat: 'na' }] } }), bois, company).motif, 'pas_de_ramonage');
  assert.equal(MOTIFS.pas_de_ramonage.silencieux, true);
  assert.equal(MOTIFS.conduit_obstrue.silencieux, false);
});

test('chemin à côté du certificat', () => {
  assert.equal(attestationPathFor('org/cli/2026/abc.pdf'), 'org/cli/2026/abc-attestation.pdf');
  assert.equal(attestationPathFor(null), null);
});

test('textes PDF-safe : aucun caractère hors cp1252', () => {
  const r = buildAttestationEntretien({ certificat: cert(), sections: bois, appareil: 'Poêle à granulés', client, company, invoiceDate: '2026-09-14', ...items });
  const tout = [texte(r.lettre), r.lettre.objet, r.lettre.references, r.lettre.faitA, r.lettre.lieuDate].join('');
  for (const ch of tout) {
    const cp = ch.codePointAt(0);
    const ok = cp < 0x100 || '’‘“”«»…–—€'.includes(ch);
    assert.ok(ok, `caractère hors cp1252 : ${ch} (U+${cp.toString(16)})`);
  }
});
