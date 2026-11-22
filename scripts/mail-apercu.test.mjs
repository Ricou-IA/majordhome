import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rendreApercu } from '../src/lib/mailApercu.js';
import { habillerMail, valeursDeMarque } from '../src/lib/mailHabillage.js';
import { EMAILS_AUTOMATIQUES, VARIABLES_MARQUE } from '../src/lib/emailsAutomatiques.js';
import { SEQUENCES_EMAILS } from '../src/lib/sequencesEmails.js';
import { WEBSHOP_EMAIL_DEFAULTS, GABARITS_HABILLES_PAR_LE_SITE } from '../src/lib/webshop/emailTemplates.js';

const REGLAGES = {
  brand_name: 'Cimaj', from_email: 'contact@cimaj.fr', phone: '05 00 00 00 00', city: 'Albi', postal_code: '81000',
  address: '1 rue du Test', website_url: 'https://cimaj.fr', accent_color: '#ff6600',
};
const SANS_ACCOLADES = /\{\{/;

const defauts = [
  ...EMAILS_AUTOMATIQUES.map((e) => e.gabarit),
  ...SEQUENCES_EMAILS.map((s) => s.gabarit),
  ...Object.values(WEBSHOP_EMAIL_DEFAULTS),
];

test('aucun {{…}} ne reste, ni dans le HTML ni dans l’objet, pour chaque texte par défaut des trois registres', () => {
  assert.ok(defauts.length >= 20);
  for (const g of defauts) {
    for (const reglages of [REGLAGES, null, {}]) {
      const r = rendreApercu({ campagne: { key: g.key }, objet: g.subject, corps: g.html_body, reglages });
      assert.ok(!SANS_ACCOLADES.test(r.html), `${g.key} : ${r.html.match(/\{\{[^}]*\}\}/)}`);
      assert.ok(!SANS_ACCOLADES.test(r.objet), `${g.key} objet`);
      assert.equal(typeof r.html, 'string');
    }
  }
});

test('même mise en page que l’envoi : habillerMail, puis la marque', () => {
  const corps = '<p>{{SALUTATION}}</p><p>{{BRAND_NAME}}</p>';
  const r = rendreApercu({ campagne: { key: 'promo' }, objet: 'x', corps, reglages: REGLAGES });
  const attendu = habillerMail(REGLAGES, corps).replaceAll('{{SALUTATION}}', 'Bonjour Jean Dupont,').replaceAll('{{BRAND_NAME}}', 'Cimaj');
  assert.equal(r.html.replace(/mailto:[^"]*\?subject=Désabonnement/, '#'), attendu.replace(/mailto:[^"]*\?subject=Désabonnement/, '#'));
  assert.equal(r.habilleParLeSite, false);
  assert.ok(r.html.includes('Bonjour Jean Dupont,') && r.html.includes('#ff6600'));
});

test('lien de désabonnement : remplacé par #, avec ou sans accent', () => {
  const r = rendreApercu({ campagne: null, corps: '<p>a</p>', reglages: REGLAGES });
  assert.ok(r.html.includes('>Se désabonner</a>'));
  assert.ok(!/mailto:[^"]*subject=D/i.test(r.html));
  assert.ok(r.html.includes('href="#"'));
  const sans = rendreApercu({ campagne: null, corps: '<p><a href="mailto:{{ORG_EMAIL}}?subject=Desabonnement">x</a></p>', reglages: REGLAGES });
  assert.ok(!/mailto:/i.test(sans.html));
});

test('e-mails habillés par le site : le HTML est le corps seul, habilleParLeSite vrai', () => {
  for (const key of GABARITS_HABILLES_PAR_LE_SITE) {
    const g = WEBSHOP_EMAIL_DEFAULTS[key];
    const r = rendreApercu({ campagne: { key }, objet: g.subject, corps: g.html_body, reglages: REGLAGES });
    assert.equal(r.habilleParLeSite, true);
    assert.ok(!/<html|<table|Se désabonner/i.test(r.html), key);
    assert.ok(r.html.includes('Cimaj'));
  }
  assert.equal(rendreApercu({ campagne: { key: 'webshop_ordre_colis' }, corps: '<p>a</p>', reglages: REGLAGES }).habilleParLeSite, false);
});

test('valeurs d’exemple : registre, salutation, nom du client ; un lien devient #', () => {
  const r = rendreApercu({ campagne: { key: 'pv_reception' }, objet: 'Bonjour {{PRENOM}}',
    corps: '<p>{{PRENOM}} — {{OBJET}}</p><p><a href="{{LIEN_PV}}">Signer</a></p>', reglages: REGLAGES });
  assert.ok(r.html.includes('Jean — poêle à granulés'));
  assert.ok(r.html.includes('href="#"') && !r.html.includes('example.com'));
  assert.equal(r.objet, 'Bonjour Jean');
  const c = rendreApercu({ campagne: { key: 'x' }, corps: '<p>{{CLIENT_NAME}} / {{lien_pellets}}</p>', reglages: REGLAGES });
  assert.ok(c.html.includes('Jean Dupont / #'));
});

test('variable inconnue : son nom brut entre crochets, et l’aperçu ne ment pas', () => {
  const r = rendreApercu({ campagne: { key: 'promo' }, objet: '{{PRENOM}}', corps: '<p>{{PRENOM}}</p>', reglages: REGLAGES });
  assert.ok(r.html.includes('<p>[PRENOM]</p>'));
  assert.equal(r.objet, '[PRENOM]');
});

test('variable-bloc : un emplacement gris avec son libellé', () => {
  const r = rendreApercu({ campagne: { key: 'webshop_confirmation' }, corps: '<p>a</p>{{ITEMS}}{{LEGAL_INFO}}', reglages: REGLAGES });
  assert.ok(r.html.includes('Récapitulatif de la commande') && r.html.includes('Mentions légales'));
  assert.ok(r.html.includes('background:#f1f5f9'));
  assert.equal(rendreApercu({ campagne: { key: 'webshop_confirmation' }, objet: '{{ITEMS}}', corps: '' }).objet, '[Récapitulatif de la commande]');
});

test('les valeurs insérées sont échappées : un nom d’entreprise avec < ne casse rien', () => {
  const r = rendreApercu({ campagne: null, corps: '<p>{{BRAND_NAME}} {{ORG_PHONE}}</p>',
    reglages: { brand_name: 'A<b>&"\'B', phone: '{{PRENOM}}' } });
  assert.ok(!r.html.includes('A<b>'));
  assert.ok(r.html.includes('A&lt;b&gt;&amp;&quot;&#39;B'));
  assert.ok(!SANS_ACCOLADES.test(r.html));
});

test('une valeur n’est jamais relue comme une variable', () => {
  const r = rendreApercu({ campagne: null, corps: '{{BRAND_NAME}} {{CLIENT_NAME}}', reglages: { brand_name: '{{CLIENT_NAME}}' } });
  assert.ok(!SANS_ACCOLADES.test(r.html));
  assert.ok(!r.html.includes('Jean Dupont Jean Dupont'));
});

test('objet : texte brut, valeurs non échappées', () => {
  const r = rendreApercu({ campagne: { key: 'promo' }, objet: '{{BRAND_NAME}} & {{SALUTATION}}', corps: '', reglages: { brand_name: 'A<B' } });
  assert.equal(r.objet, 'A<B & Bonjour Jean Dupont,');
});

test('toutes les variables de marque sont remplacées, y compris dans un href', () => {
  const corps = VARIABLES_MARQUE.map((v) => `<a href="${v}">${v}</a>`).join('');
  const r = rendreApercu({ campagne: { key: 'promo' }, corps, reglages: REGLAGES });
  assert.ok(!SANS_ACCOLADES.test(r.html));
  for (const [j, v] of Object.entries(valeursDeMarque(REGLAGES))) if (v) assert.ok(r.html.includes(v.replace(/&/g, '&amp;')), j);
});

test('ne lève jamais : tout absent ou invalide donne un résultat valide', () => {
  for (const entree of [undefined, {}, { campagne: null, corps: null, reglages: null, objet: null },
    { campagne: { key: 'inconnu' }, corps: '', reglages: 'pas un objet' }, { corps: 42, objet: 42 }]) {
    const r = rendreApercu(entree);
    assert.equal(typeof r.html, 'string');
    assert.equal(typeof r.objet, 'string');
    assert.equal(typeof r.habilleParLeSite, 'boolean');
  }
  assert.ok(rendreApercu({ corps: '', reglages: null }).html.includes('<html'));
});

test('texte avec une variable inconnue et une salutation, sur chaque nature', () => {
  for (const campagne of [null, { key: 'x', is_automated: true }, { key: 'sequence_accueil_lead' }, { key: 'pv_reception' }, { key: 'webshop_feuille_route' }]) {
    const r = rendreApercu({ campagne, objet: '{{SALUTATION}} {{PRENOM}}', corps: '<p>{{SALUTATION}} {{PRENOM}} {{INCONNUE_X}}</p>', reglages: REGLAGES });
    assert.ok(!SANS_ACCOLADES.test(r.html) && !SANS_ACCOLADES.test(r.objet));
  }
});

test('mails habillés par le site : seules ses trois variables d’entreprise sont remplacées, les autres se voient', () => {
  for (const key of GABARITS_HABILLES_PAR_LE_SITE) {
    const r = rendreApercu({ campagne: { key }, objet: '{{ORG_CITY}} {{BRAND_NAME}}',
      corps: '<p>{{BRAND_NAME}} {{ORG_EMAIL}} {{ORG_PHONE}} {{ORG_WEBSITE_URL}} {{ACCENT_COLOR}}</p>', reglages: REGLAGES });
    assert.ok(r.html.includes('Cimaj contact@cimaj.fr 05 00 00 00 00'), key);
    assert.ok(r.html.includes('[ORG_WEBSITE_URL] [ACCENT_COLOR]') || r.html.includes('[Site de l’entreprise] [Couleur principale]'), r.html);
    assert.ok(!r.html.includes('#ff6600') && !r.html.includes('https://cimaj.fr'));
    assert.equal(r.objet, '[ORG_CITY] Cimaj');
    assert.ok(!SANS_ACCOLADES.test(r.html));
  }
  const manuelle = rendreApercu({ campagne: { key: 'promo' }, corps: '<p>{{ORG_CITY}} {{ACCENT_COLOR}}</p>', reglages: REGLAGES });
  assert.ok(manuelle.html.includes('Albi #ff6600'));
});

test('variable de lien inconnue : [NOM], pas #', () => {
  const r = rendreApercu({ campagne: { key: 'promo' }, corps: '<p>{{LIEN_PELLETS}} {{FOO_URL}} {{lien_pellets}}</p>', reglages: REGLAGES });
  assert.ok(r.html.includes('[LIEN_PELLETS] [FOO_URL] #'), r.html);
});
