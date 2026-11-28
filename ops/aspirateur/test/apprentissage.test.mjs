// ops/aspirateur/test/apprentissage.test.mjs — agent d'apprentissage d'un site, modèle factice scénarisé.
// Run : cd ops/aspirateur && node --test test/apprentissage.test.mjs
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { ouvrirNavigateur } from '../navigateur.mjs';
import { creerJournal } from '../journal.mjs';
import { apprendre, OUTILS } from '../apprentissage.mjs';
import { validerRecette } from '../lib/recette.js';
import { demarrerSite, IDENTIFIANT, MOT_DE_PASSE } from './fixtures/site-exemple.mjs';

let site;
before(async () => { site = await demarrerSite(); });
after(async () => { await site.fermer(); });

const champs = [{ key: 'etas_pct', label: 'Etas', unit: '%', type: 'number' }];
const secrets = [IDENTIFIANT, MOT_DE_PASSE, 'CLIENT-0042'];
// Le site factice est en http sur 127.0.0.1 : la validation réelle (https) est rejouée sur une copie dont l'adresse
// du site factice est remplacée par un domaine https fictif.
const valider = (r) => validerRecette(JSON.parse(JSON.stringify(r).replaceAll(site.url, 'https://pro.exemple-test.fr').replaceAll(site.hote, 'pro.exemple-test.fr')));

const recetteBonne = () => ({
  schema: 1, domaine: site.hote,
  connexion: { url: `${site.url}/login`, champ_identifiant: '#email', champ_mot_de_passe: '#password', bouton: 'button[type=submit]', preuve: '.mon-compte' },
  listes: { departs: [`${site.url}/liste?page=1`], lien_produit: 'a.p', suivant: 'a.suivant' },
  produit: { nom: 'h1', reference: '.ref', prix: '.prix', documents: [{ type: 'fiche_technique', selecteur: 'a.fiche' }] },
});
const outil = (id, name, input) => ({ type: 'tool_use', id, name, input });

/** Modèle factice : rejoue une suite de réponses ; lit pour « lire » le texte « Etas NN ». */
function modeleScenario(etapes) {
  const recu = [];
  let i = 0;
  return {
    recu,
    async appeler(d) {
      recu.push(JSON.stringify(d));
      if (d.usage === 'lire') {
        const m = String(d.messages[0].content).match(/Etas (\d+)/);
        return { content: [{ type: 'text', text: JSON.stringify({ valeurs: { etas_pct: m ? Number(m[1]) : null } }) }], stop_reason: 'end_turn' };
      }
      const e = etapes[Math.min(i, etapes.length - 1)];
      i += 1;
      return typeof e === 'function' ? e(d) : e;
    },
  };
}
const tour = (...blocs) => ({ content: blocs, stop_reason: 'tool_use' });

async function lancer(modele, opts = {}) {
  const navigateur = await ouvrirNavigateur({ hoteSite: site.hote, delaiMs: 20, modeTest: true, secrets });
  try {
    return await apprendre({ hoteSite: site.hote, urlDepart: `${site.url}/login`, acces: { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE },
      compteClient: 'CLIENT-0042', champs, marques: ['Invicta'], modele, navigateur, valider,
      journal: creerJournal(secrets, { log() {}, error() {} }), plafonds: { pages: 60, minutes: 15 }, ...opts });
  } finally { await navigateur.fermer(); }
}

test('outils déclarés : les six de l’agent, sans type', () => {
  assert.deepEqual(OUTILS.map((o) => o.name), ['aller', 'lire_page', 'cliquer', 'se_connecter', 'essayer_recette', 'proposer_recette']);
  assert.ok(OUTILS.every((o) => !('type' in o) && o.input_schema));
});

test('scénario nominal : connexion, essai, proposition ⇒ recette valide et 5 produits au plus', async () => {
  const modele = modeleScenario([
    tour(outil('t1', 'aller', { url: `${site.url}/login` })),
    tour(outil('t2', 'se_connecter', { champ_identifiant: '#email', champ_mot_de_passe: '#password', bouton: 'button[type=submit]', preuve: '.mon-compte' })),
    tour(outil('t3', 'essayer_recette', { recette: recetteBonne() })),
    tour(outil('t4', 'proposer_recette', { recette: recetteBonne() })),
  ]);
  const { recette, essai } = await lancer(modele);
  assert.equal(recette.domaine, site.hote);
  assert.ok(essai.length >= 1 && essai.length <= 5);
  assert.ok(essai.every((p) => p.reference_fabricant));
  // le résultat de se_connecter ne dit que l'état
  const apresConnexion = modele.recu.find((r) => r.includes('"tool_use_id":"t2"'));
  assert.match(apresConnexion, /connecte/);
  // jamais un accès dans ce qui part vers le modèle
  for (const r of modele.recu) {
    assert.ok(!r.includes(MOT_DE_PASSE), 'mot de passe envoyé au modèle');
    assert.ok(!r.toLowerCase().includes(IDENTIFIANT), 'identifiant envoyé au modèle');
    assert.ok(!r.includes('CLIENT-0042'), 'compte client envoyé au modèle');
  }
});

test('les prix lus à l’essai ne sont pas montrés au modèle', async () => {
  const modele = modeleScenario([
    tour(outil('t1', 'essayer_recette', { recette: recetteBonne() })),
    tour(outil('t2', 'proposer_recette', { recette: recetteBonne() })),
  ]);
  await lancer(modele);
  const resultatEssai = modele.recu.find((r) => r.includes('"tool_use_id":"t1"'));
  assert.ok(!resultatEssai.includes('1200'), 'prix montré au modèle');
});

test('une recette qui contient un secret est refusée ; au troisième refus : recette_refusee', async () => {
  const fautive = { ...recetteBonne(), produit: { ...recetteBonne().produit, nom: `h1[data-u="${MOT_DE_PASSE}"]` } };
  const modele = modeleScenario([tour(outil('t', 'proposer_recette', { recette: fautive }))]);
  await assert.rejects(lancer(modele), (e) => e.code === 'recette_refusee');
});

test('aller hors du site : erreur rendue à l’agent, pas d’arrêt', async () => {
  const modele = modeleScenario([
    tour(outil('t1', 'aller', { url: 'https://evil.example/' })),
    tour(outil('t2', 'proposer_recette', { recette: recetteBonne() })),
  ]);
  const r = await lancer(modele);
  assert.ok(r.recette);
  const res = modele.recu.find((x) => x.includes('"tool_use_id":"t1"'));
  assert.match(res, /hors du site/);
  assert.match(res, /"is_error":true/);
});

test('captcha : site_protege', async () => {
  const modele = modeleScenario([tour(outil('t1', 'aller', { url: `${site.url}/captcha` }))]);
  await assert.rejects(lancer(modele), (e) => e.code === 'site_protege');
});

test('plafond de pages : plafond_atteint', async () => {
  const modele = modeleScenario([tour(outil('t', 'aller', { url: `${site.url}/produit/1` }))]);
  await assert.rejects(lancer(modele, { plafonds: { pages: 3, minutes: 15 } }), (e) => e.code === 'plafond_atteint');
});

test('le modèle s’arrête sans proposer : relancé deux fois, puis recette_refusee', async () => {
  const modele = modeleScenario([{ content: [{ type: 'text', text: 'Je ne sais pas.' }], stop_reason: 'end_turn' }]);
  await assert.rejects(lancer(modele), (e) => e.code === 'recette_refusee');
});
