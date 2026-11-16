// scripts/certificat-conforme-model.test.mjs — certificat « Conforme » allégé, posé par le bureau
// node --test scripts/certificat-conforme-model.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MODE_ALLEGE, estAllege, dateDePassage, blocageConforme, brouillonRemplace, certificatAllegePayload,
  buildCertificatConforme, peutAnnulerConforme,
} from '../src/lib/certificatConformeModel.js';
import { eligibiliteAttestation } from '../src/lib/attestationEntretienModel.js';

const company = {
  name: 'Mayer Énergie', legalName: 'MAYER ENERGIE', city: 'Gaillac',
  signatoryName: 'Eric Pudebat', signatoryRole: 'Président',
};
const client = { name: 'AMAR JEANNE', address: '1 Impasse Emilien Natoly', postal_code: '81370', city: 'Saint-Sulpice-la-Pointe' };
const entree = (patch = {}) => ({
  interventionId: 'child-1', clientId: 'cli-1', equipmentId: 'eq-1', contractId: 'ctr-1', orgId: 'org-1', userId: 'user-1',
  equipement: { code: 'poele_granules', marque: 'PALAZZETTI', modele: 'eco fire beatrice 6', numeroSerie: '' },
  tvaTaux: 5.5, technicien: { id: 'tm-1', nom: 'Mohammed ' }, date: '2026-11-13', ramonage: false,
  ...patch,
});
const texte = (lettre) => lettre.paragraphes.map((p) => p.map((s) => s.text).join('')).join('\n');

test('estAllege : seul le mode « allege » compte', () => {
  assert.equal(MODE_ALLEGE, 'allege');
  assert.equal(estAllege({ mode: 'allege' }), true);
  assert.equal(estAllege({ mode: 'complet' }), false);
  assert.equal(estAllege({}), false);
  assert.equal(estAllege(null), false);
});

test('dateDePassage : date du RDV, jamais dans le futur, aujourd’hui à défaut', () => {
  assert.equal(dateDePassage('2026-11-13', '2026-11-16'), '2026-11-13');
  assert.equal(dateDePassage('2026-11-13T00:00:00+00:00', '2026-11-16'), '2026-11-13');
  assert.equal(dateDePassage('2026-11-20', '2026-11-16'), '2026-11-16');
  assert.equal(dateDePassage(null, '2026-11-16'), '2026-11-16');
  assert.equal(dateDePassage('n’importe quoi', '2026-11-16'), '2026-11-16');
});

test('blocageConforme : rien, brouillon conforme ou certificat déjà allégé ⇒ libre', () => {
  assert.equal(blocageConforme(null), null);
  assert.equal(blocageConforme({ statut: 'brouillon', bilan_conformite: 'conforme', mode: 'complet' }), null);
  assert.equal(blocageConforme({ statut: 'signe', bilan_conformite: 'conforme', mode: 'allege' }), null);
});

test('blocageConforme : un certificat complet signé ne se remplace pas', () => {
  assert.match(blocageConforme({ statut: 'signe', bilan_conformite: 'conforme', mode: 'complet' }), /déjà signé/);
  assert.match(blocageConforme({ statut: 'envoye', bilan_conformite: 'conforme' }), /déjà signé/);
});

test('blocageConforme : un brouillon qui porte une anomalie ne se remplace pas', () => {
  assert.match(blocageConforme({ statut: 'brouillon', bilan_conformite: 'anomalie', mode: 'complet' }), /anomalie/);
  assert.match(blocageConforme({ statut: 'brouillon', bilan_conformite: 'arret_urgence' }), /anomalie/);
  assert.match(blocageConforme({ statut: 'brouillon', bilan_conformite: 'conforme', anomalies_detail: ' joint de porte HS ' }), /anomalie/);
  assert.equal(blocageConforme({ statut: 'brouillon', bilan_conformite: 'conforme', anomalies_detail: '   ' }), null);
});

test('brouillonRemplace : vrai seulement pour un brouillon complet qui sera écrasé', () => {
  assert.equal(brouillonRemplace({ statut: 'brouillon', mode: 'complet', bilan_conformite: 'conforme' }), true);
  assert.equal(brouillonRemplace({ statut: 'signe', mode: 'allege' }), false);
  assert.equal(brouillonRemplace(null), false);
});

test('certificatAllegePayload : allégé, finalisé, conforme, sans signature', () => {
  const p = certificatAllegePayload(entree());
  assert.equal(p.mode, 'allege');
  assert.equal(p.statut, 'signe');
  assert.equal(p.bilan_conformite, 'conforme');
  assert.equal(p.type_document, 'entretien');
  assert.equal(p.donnees_ramonage, null);
  assert.equal(p.signature_client_base64, null);
  assert.equal(p.signature_client_nom, null);
  assert.equal(p.signed_at, null);
  assert.equal(p.anomalies_detail, null);
  assert.equal(p.action_corrective, null);
  assert.equal(p.pdf_storage_path, null);
  assert.equal(p.pdf_generated_at, null);
  assert.deepEqual(p.donnees_entretien, {});
  assert.deepEqual(p.mesures, {});
  assert.deepEqual(p.pieces_remplacees, []);
  assert.equal(p.intervention_id, 'child-1');
  assert.equal(p.client_id, 'cli-1');
  assert.equal(p.equipment_id, 'eq-1');
  assert.equal(p.contract_id, 'ctr-1');
  assert.equal(p.org_id, 'org-1');
  assert.equal(p.created_by, 'user-1');
  assert.equal(p.equipement_type, 'poele_granules');
  assert.equal(p.equipement_marque, 'PALAZZETTI');
  assert.equal(p.equipement_numero_serie, null);
  assert.equal(p.technicien_id, 'tm-1');
  assert.equal(p.technicien_nom, 'Mohammed');
  assert.equal(p.date_intervention, '2026-11-13');
  assert.equal(p.tva_taux, 5.5);
});

test('certificatAllegePayload : ramonage coché ⇒ un conduit ramoné, sans méthode affirmée', () => {
  const p = certificatAllegePayload(entree({ ramonage: true }));
  assert.equal(p.type_document, 'entretien_ramonage');
  assert.deepEqual(p.donnees_ramonage, { conduits: [{ label: 'Conduit principal', resultat: 'ramone' }] });
  assert.equal('methode' in p.donnees_ramonage, false);
});

test('certificatAllegePayload : ce certificat ouvre droit à l’attestation de ramonage', () => {
  const p = certificatAllegePayload(entree({ ramonage: true }));
  assert.deepEqual(eligibiliteAttestation(p, { showRamonage: true }, company), { eligible: true });
  const sans = certificatAllegePayload(entree());
  assert.deepEqual(eligibiliteAttestation(sans, { showRamonage: true }, company), { eligible: false, motif: 'pas_de_ramonage' });
});

test('certificatAllegePayload : TVA inconnue ⇒ laissée au défaut de la base', () => {
  assert.equal('tva_taux' in certificatAllegePayload(entree({ tvaTaux: null })), false);
});

test('buildCertificatConforme : la lettre dit le passage, l’absence d’anomalie et qui est intervenu', () => {
  const certificat = { ...certificatAllegePayload(entree()), reference: 'CERT-2026-01617' };
  const { lettre } = buildCertificatConforme({
    certificat, appareil: 'Poêle à granulés', contractNumber: 'CTR-00881', client, company, dateEdition: '2026-11-16',
  });
  assert.equal(lettre.objet, 'CERTIFICAT D’ENTRETIEN');
  assert.equal(lettre.lieuDate, 'Gaillac, le 16 novembre 2026');
  assert.equal(lettre.faitA, 'Fait à Gaillac, le 16-11-2026');
  assert.equal(lettre.references, 'Référence CERT-2026-01617 - Contrat CTR-00881');
  assert.deepEqual(lettre.destinataire, ['AMAR JEANNE', '1 Impasse Emilien Natoly', '81370 SAINT-SULPICE-LA-POINTE']);
  assert.deepEqual(lettre.signataire, { entreprise: 'MAYER ENERGIE', nom: 'Eric Pudebat', fonction: 'Président' });
  const t = texte(lettre);
  assert.match(t, /intervenus le 13 novembre 2026/);
  assert.match(t, /AMAR JEANNE, 1 Impasse Emilien Natoly, 81370 SAINT-SULPICE-LA-POINTE/);
  assert.match(t, /poêle à granulés de marque PALAZZETTI eco fire beatrice 6/);
  assert.match(t, /réalisée par Mohammed\./);
  assert.match(t, /Aucune anomalie n’a été relevée/);
  assert.match(t, /conforme et apte à un usage normal/);
  assert.doesNotMatch(t, /ramon/i);
});

test('buildCertificatConforme : la phrase de ramonage n’apparaît que si un conduit est noté ramoné', () => {
  const certificat = { ...certificatAllegePayload(entree({ ramonage: true })), reference: 'CERT-2026-01617' };
  const { lettre } = buildCertificatConforme({ certificat, appareil: 'Poêle à granulés', client, company, dateEdition: '2026-11-16' });
  assert.match(texte(lettre), /Le conduit de fumée raccordé à l’appareil a été ramoné\./);
});

test('buildCertificatConforme : organisation et fiches incomplètes ⇒ ni « undefined » ni séparateur orphelin', () => {
  const certificat = {
    ...certificatAllegePayload(entree({ equipement: { code: 'autre' }, technicien: { id: null, nom: '' } })),
    reference: 'CERT-2026-01618',
  };
  const { lettre } = buildCertificatConforme({
    certificat, appareil: null, contractNumber: null, client: { name: 'DUPONT' }, company: { name: 'Votre entreprise' }, dateEdition: '2026-11-16',
  });
  const tout = JSON.stringify(lettre);
  assert.doesNotMatch(tout, /undefined|null/);
  assert.equal(lettre.lieuDate, 'Le 16 novembre 2026');
  assert.equal(lettre.references, 'Référence CERT-2026-01618');
  assert.deepEqual(lettre.destinataire, ['DUPONT']);
  assert.deepEqual(lettre.signataire, { entreprise: 'VOTRE ENTREPRISE', nom: '', fonction: '' });
  const t = texte(lettre);
  assert.match(t, /au domicile de DUPONT pour l’entretien annuel de son appareil de chauffage\./);
  assert.doesNotMatch(t, /réalisée par/);
  assert.doesNotMatch(t, / {2}|, ,|,\./);
});

test('buildCertificatConforme : aucun caractère hors cp1252 (police PDF Helvetica)', () => {
  // Espace fine insécable, espace insécable, moins typographique, flèches : absents de cp1252.
  // Écrits par leur code pour que le fichier ne porte aucun caractère invisible.
  const horsCp1252 = [0x202f, 0x00a0, 0x2212, 0x2192, 0x2190].map((code) => String.fromCharCode(code));
  const certificat = { ...certificatAllegePayload(entree({ ramonage: true })), reference: 'CERT-2026-01617' };
  const { lettre } = buildCertificatConforme({
    certificat, appareil: 'Poêle à granulés', contractNumber: 'CTR-00881',
    client: { ...client, name: `AMAR${horsCp1252[0]}JEANNE`, address: `1 Impasse${horsCp1252[1]}Natoly` }, company, dateEdition: '2026-11-16',
  });
  const tout = JSON.stringify(lettre);
  horsCp1252.forEach((caractere) => assert.equal(tout.includes(caractere), false));
  assert.equal(lettre.destinataire[0], 'AMAR JEANNE');
});

test('peutAnnulerConforme : tant que la carte n’est pas facturée', () => {
  assert.equal(peutAnnulerConforme({ workflow_status: 'realise', invoice_id: null, invoiced_at: null }), true);
  assert.equal(peutAnnulerConforme({ workflow_status: 'planifie' }), true);
  assert.equal(peutAnnulerConforme({ workflow_status: 'facture' }), false);
  assert.equal(peutAnnulerConforme({ workflow_status: 'realise', invoice_id: 'F-1' }), false);
  assert.equal(peutAnnulerConforme({ workflow_status: 'realise', invoiced_at: '2026-11-16T10:00:00Z' }), false);
  assert.equal(peutAnnulerConforme(null), false);
});
