// ops/aspirateur/test/rejeu.test.mjs — rejeu d'une recette sur le site factice, avec un modèle factice.
// Run : cd ops/aspirateur && node --test test/rejeu.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirNavigateur } from '../navigateur.mjs';
import { creerJournal } from '../journal.mjs';
import { rejouer, prixDepuisTexte } from '../rejeu.mjs';
import { demarrerSite, IDENTIFIANT, MOT_DE_PASSE } from './fixtures/site-exemple.mjs';

let site;
before(async () => { site = await demarrerSite(); });
after(async () => { await site.fermer(); });

const champs = [{ key: 'etas_pct', label: 'Etas', unit: '%', type: 'number' }];
/** Modèle factice : lit « Etas NN » dans le texte reçu. */
const modele = {
  appels: [],
  async appeler({ messages }) {
    const texte = String(messages[0].content);
    this.appels.push(texte);
    const m = texte.match(/Etas (\d+)/);
    return { content: [{ type: 'text', text: JSON.stringify({ valeurs: { etas_pct: m ? Number(m[1]) : null } }) }], stop_reason: 'end_turn' };
  },
};
const recette = (over = {}) => ({
  schema: 1, domaine: site.hote,
  connexion: { url: `${site.url}/login`, champ_identifiant: '#email', champ_mot_de_passe: '#password', bouton: 'button[type=submit]', preuve: '.mon-compte' },
  listes: { departs: [`${site.url}/liste?page=1`], lien_produit: 'a.p', suivant: 'a.suivant' },
  produit: { nom: 'h1', reference: '.ref', marque: '.marque', prix: '.prix', photo: 'img.photo', zone_caracteristiques: '.caracs', documents: [{ type: 'fiche_technique', selecteur: 'a.fiche' }] },
  ...over,
});
const secrets = [IDENTIFIANT, MOT_DE_PASSE];
async function lancer(opts) {
  const navigateur = await ouvrirNavigateur({ hoteSite: site.hote, delaiMs: 50, modeTest: true, secrets });
  const lots = [];
  try {
    const r = await rejouer({ recette: recette(), acces: { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE }, champs, modele, navigateur,
      journal: creerJournal(secrets, { log() {}, error() {} }), surLot: async (p) => { lots.push(p); }, ...opts });
    return { r, lots, produits: lots.flat() };
  } finally { await navigateur.fermer(); }
}

test('prixDepuisTexte : formats français', () => {
  assert.equal(prixDepuisTexte('1 200,00 €'), 1200);
  assert.equal(prixDepuisTexte('1.200,50 € HT'), 1200.5);
  assert.equal(prixDepuisTexte('980.5'), 980.5);
  assert.equal(prixDepuisTexte('Sur devis'), null);
  assert.equal(prixDepuisTexte(null), null);
});

test('rejeu complet : connexion, pagination arrêtée sur page répétée, provenance mesurée, PDF prioritaire', async () => {
  const { r, produits } = await lancer({});
  assert.deepEqual(r.compteurs, { trouves: 3, lus: 3, echecs: 0, documents: 3 });
  const parRef = Object.fromEntries(produits.map((p) => [p.reference_fabricant, p]));
  assert.equal(parRef.P613744.provenance, 'public');
  assert.equal(parRef.P700100.provenance, 'public');
  assert.equal(parRef['C07768-06'].provenance, 'compte');
  assert.equal(parRef.P613744.prix, 1200);
  assert.equal(parRef.P613744.marque, 'Invicta');
  assert.equal(parRef.P613744.valeurs.etas_pct, 67, 'la valeur du PDF (67) prime sur la page (66)');
  assert.equal(parRef.P613744.documents[0].type, 'fiche_technique');
  assert.match(parRef.P613744.documents[0].empreinte, /^[0-9a-f]{64}$/);
  assert.ok(parRef.P613744.documents[0].contenu_base64.length > 0);
  assert.match(parRef.P613744.photo_url, /\/img\/1\.jpg$/);
  assert.ok(!site.demandes.some((d) => d.includes('page=4')), 'la pagination s’arrête sur la page répétée');
});

test('aucun lot ni appel au modèle ne contient le mot de passe ou l’identifiant', async () => {
  modele.appels = [];
  const { lots } = await lancer({});
  const tout = JSON.stringify(lots) + JSON.stringify(modele.appels);
  assert.ok(!tout.includes(MOT_DE_PASSE));
  assert.ok(!tout.toLowerCase().includes(IDENTIFIANT));
});

test('essai : s’arrête au nombre demandé', async () => {
  const { r, produits } = await lancer({ essai: 2 });
  assert.equal(produits.length, 2);
  assert.equal(r.compteurs.lus, 2);
});

test('mauvais mot de passe : acces_refuses', async () => {
  await assert.rejects(lancer({ acces: { identifiant: IDENTIFIANT, motDePasse: 'faux' } }), (e) => e.code === 'acces_refuses');
});

test('captcha : site_protege', async () => {
  await assert.rejects(lancer({ recette: recette({ listes: { departs: [`${site.url}/captcha`], lien_produit: 'a.p' } }) }), (e) => e.code === 'site_protege');
});

test('plus de la moitié des produits sans référence : recette_obsolete', async () => {
  await assert.rejects(lancer({ recette: recette({ listes: { departs: [`${site.url}/liste-sans-ref`], lien_produit: 'a.p' } }) }), (e) => e.code === 'recette_obsolete');
});

test('aucun produit trouvé : recette_obsolete', async () => {
  await assert.rejects(lancer({ recette: recette({ listes: { departs: [`${site.url}/compte`], lien_produit: 'a.p' } }) }), (e) => e.code === 'recette_obsolete');
});
