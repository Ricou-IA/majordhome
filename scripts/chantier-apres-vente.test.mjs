// Tests du module pur src/lib/chantierApresVente.js — `node --test scripts/chantier-apres-vente.test.mjs`
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enApresVente, etatContrat, contratsParClient, reperePv, reperesApresVente, blocageAvis, CAMPAGNE_AVIS_POSE,
  messageAvisEnvoye, messageAvisRefuse, suiteDesReserves,
} from '../src/lib/chantierApresVente.js';
import { getSmsCampaign } from '../src/lib/smsCampaigns.js';

const chantier = (extra = {}) => ({
  id: 'c1', chantier_status: 'realise', client_id: 'cl1', phone: '06 12 34 56 78',
  pv_reception_path: null, pv_signed_at: null, pv_sent_at: null, pv_avec_reserves: false, is_invoiced: false,
  ...extra,
});
const etats = (reperes) => Object.fromEntries(reperes.map((r) => [r.cle, r.etat]));

test('la campagne d\'avis après pose existe dans le registre SMS', () => {
  assert.ok(getSmsCampaign(CAMPAGNE_AVIS_POSE), 'avis_pose absente du registre');
});

test('après-vente : réceptionné et facturé seulement', () => {
  assert.equal(enApresVente(chantier()), true);
  assert.equal(enApresVente(chantier({ chantier_status: 'facture' })), true);
  assert.equal(enApresVente(chantier({ chantier_status: 'planification' })), false);
  assert.equal(enApresVente(null), false);
});

test('contrat : actif prime sur proposé ; archivé ou annulé ne compte pas', () => {
  assert.equal(etatContrat(['pending', 'active']), 'actif');
  assert.equal(etatContrat(['pending']), 'propose');
  assert.equal(etatContrat(['archived', 'cancelled']), 'aucun');
  assert.equal(etatContrat(undefined), 'aucun');
});

test('contratsParClient : regroupe, ignore les lignes sans client', () => {
  const map = contratsParClient([
    { client_id: 'a', status: 'active' }, { client_id: 'a', status: 'archived' },
    { client_id: null, status: 'active' }, { client_id: 'b', status: 'pending' },
  ]);
  assert.deepEqual(map.get('a'), ['active', 'archived']);
  assert.deepEqual(map.get('b'), ['pending']);
  assert.equal(map.size, 2);
});

test('PV : archivé ou signé en ligne = fait ; envoyé = en cours ; réserves signalées', () => {
  assert.equal(reperePv(chantier()).etat, 'a_faire');
  assert.equal(reperePv(chantier({ pv_sent_at: '2026-11-17T09:00:00Z' })).etat, 'en_cours');
  assert.equal(reperePv(chantier({ pv_reception_path: 'pv-reception/c1/x.pdf' })).etat, 'fait');
  assert.equal(reperePv(chantier({ pv_signed_at: '2026-11-17T10:00:00Z' })).etat, 'fait');
  const reserves = reperePv(chantier({ pv_signed_at: '2026-11-17T10:00:00Z', pv_avec_reserves: true }));
  assert.equal(reserves.etat, 'attention');
  assert.equal(reserves.libelle, 'Réserves');
});

test('repères : listes inconnues ⇒ avis et contrat « inconnu », jamais « à faire »', () => {
  const e = etats(reperesApresVente(chantier()));
  assert.equal(e.avis, 'inconnu');
  assert.equal(e.contrat, 'inconnu');
  assert.equal(e.pv, 'a_faire');
  assert.equal(e.facture, 'a_faire');
});

test('repères : quatre pastilles dans l\'ordre, états lus sur le chantier et les listes', () => {
  const reperes = reperesApresVente(
    chantier({ pv_reception_path: 'p.pdf', is_invoiced: true }),
    { contrats: new Map([['cl1', ['pending']]]), avis: new Set(['cl1']) },
  );
  assert.deepEqual(reperes.map((r) => r.cle), ['pv', 'avis', 'contrat', 'facture']);
  assert.deepEqual(etats(reperes), { pv: 'fait', avis: 'fait', contrat: 'en_cours', facture: 'fait' });
  assert.ok(reperes.every((r) => r.titre && r.libelle));
});

test('repères : client sans contrat ni avis ⇒ à faire', () => {
  const e = etats(reperesApresVente(chantier(), { contrats: new Map(), avis: new Set() }));
  assert.equal(e.avis, 'a_faire');
  assert.equal(e.contrat, 'a_faire');
});

test('demande d\'avis : fermée tant que la liste est inconnue, et pour un client déjà sollicité', () => {
  assert.match(blocageAvis(chantier(), undefined), /Vérification/);
  assert.match(blocageAvis(chantier(), new Set(['cl1'])), /déjà demandé/);
  assert.equal(blocageAvis(chantier(), new Set()), null);
});

test('messages : gabarit absent = information, le reste = erreur dite telle quelle', () => {
  assert.equal(messageAvisEnvoye({ sentCount: 1 }), 'Demande d\'avis envoyée');
  assert.equal(messageAvisEnvoye({ sentCount: 2 }), '2 demandes d\'avis envoyées');
  assert.equal(messageAvisEnvoye(undefined), 'Demande d\'avis envoyée');
  assert.equal(messageAvisRefuse(new Error('campaign_template_missing')).info, true);
  assert.deepEqual(messageAvisRefuse(new Error('Aucun numéro mobile')), { texte: 'Aucun numéro mobile', info: false });
  assert.equal(messageAvisRefuse(null).info, false);
});

test('demande d\'avis : fermée hors après-vente, sans fiche client, sans téléphone', () => {
  assert.ok(blocageAvis(chantier({ chantier_status: 'planification' }), new Set()));
  assert.ok(blocageAvis(chantier({ client_id: null }), new Set()));
  assert.ok(blocageAvis(chantier({ phone: ' ' }), new Set()));
});

test('repère PV : réserves levées = fait, date en toutes lettres', () => {
  const r = reperePv(chantier({ pv_signed_at: '2026-11-17T10:00:00Z', pv_avec_reserves: true, pv_reserves_levees_at: '2026-12-01T10:00:00Z' }));
  assert.equal(r.etat, 'fait');
  assert.equal(r.libelle, 'PV');
  assert.equal(r.titre, 'Réserves levées le 1er décembre 2026');
});

test('repère PV : la levée prime sur « signé avec réserves »', () => {
  const sans = reperePv(chantier({ pv_signed_at: 'x', pv_avec_reserves: true }));
  assert.equal(sans.etat, 'attention');
  const levee = reperePv(chantier({ pv_signed_at: 'x', pv_avec_reserves: true, pv_reserves_levees_at: '2026-12-01T23:30:00Z' }));
  assert.equal(levee.etat, 'fait');
  assert.match(levee.titre, /^Réserves levées le /);
});

test('suite des réserves : rien pour un PV sur tablette, étapes pour un PV en ligne', () => {
  assert.equal(suiteDesReserves({ pv_reception_path: 'p', pv_avec_reserves: false }, null), 'aucune');
  const c = { pv_signed_at: 'x', pv_avec_reserves: true };
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves' }), 'a_repondre');
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves', reserves_repondu_at: 'x' }), 'a_lever');
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves', levee_demandee_at: 'x' }), 'levee_demandee');
  assert.equal(suiteDesReserves(c, { reception_type: 'avec_reserves', levee_signed_at: 'x' }), 'levee_signee');
  assert.equal(suiteDesReserves(c, undefined), 'aucune'); // détail pas encore chargé : on ne propose rien
});

test('suite des réserves : sans réserves, sans signature en ligne, ou PV tablette = aucune', () => {
  assert.equal(suiteDesReserves({ pv_signed_at: 'x', pv_avec_reserves: false }, { reception_type: 'sans_reserves' }), 'aucune');
  assert.equal(suiteDesReserves({ pv_avec_reserves: true, pv_reception_path: 'p' }, { reception_type: 'avec_reserves' }), 'aucune');
  assert.equal(suiteDesReserves(null, { reception_type: 'avec_reserves' }), 'aucune');
});
