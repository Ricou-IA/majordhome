import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  natureDuMail, variablesProposees, libelleVariable, variablesManquantes, variablesInconnues, elementsPermis,
  variablesAccepteesDansLObjet, variablesInconnuesDeLObjet,
} from '../src/lib/mailVariables.js';
import { EMAILS_AUTOMATIQUES, VARIABLES_MARQUE, variablesDe } from '../src/lib/emailsAutomatiques.js';
import { SEQUENCES_EMAILS } from '../src/lib/sequencesEmails.js';
import {
  WEBSHOP_EMAIL_KEYS, WEBSHOP_EMAIL_DEFAULTS, WEBSHOP_EMAIL_PLACEHOLDERS, GABARITS_HABILLES_PAR_LE_SITE, VARIABLES_MARQUE_DU_SITE,
} from '../src/lib/webshop/emailTemplates.js';

const MANUELLE = { key: 'promo_automne', is_automated: false, is_transactional: false };
const AUTO = { key: 'relance_hiver', is_automated: true, is_transactional: false };
const noms = (c) => variablesProposees(c).map((v) => v.nom);

test('nature du mail', () => {
  assert.equal(natureDuMail({ key: 'sequence_accueil_lead' }), 'sequence');
  assert.equal(natureDuMail({ key: 'pv_reception' }), 'auto_registre');
  assert.equal(natureDuMail({ key: 'webshop_confirmation' }), 'boutique');
  assert.equal(natureDuMail(MANUELLE), 'manuelle');
  assert.equal(natureDuMail(AUTO), 'automatique');
  assert.equal(natureDuMail({ key: 'autre_message', is_transactional: true }), 'boutique');
  assert.equal(natureDuMail(null), 'manuelle');
});

test('GABARITS_HABILLES_PAR_LE_SITE : les deux e-mails du site, tous deux de la boutique', () => {
  assert.deepEqual([...GABARITS_HABILLES_PAR_LE_SITE], ['webshop_confirmation', 'webshop_feuille_route']);
  for (const k of GABARITS_HABILLES_PAR_LE_SITE) assert.ok(WEBSHOP_EMAIL_KEYS.includes(k));
});

test('elementsPermis : tout faux pour les deux gabarits du site, tout vrai ailleurs', () => {
  for (const key of GABARITS_HABILLES_PAR_LE_SITE) assert.deepEqual(elementsPermis({ key }), { titre: false, bouton: false, encadre: false });
  assert.deepEqual(elementsPermis(MANUELLE), { titre: true, bouton: true, encadre: true });
  assert.deepEqual(elementsPermis(null), { titre: true, bouton: true, encadre: true });
  assert.deepEqual(elementsPermis({ key: 'webshop_ordre_colis' }), { titre: true, bouton: true, encadre: true });
});

test('campagne manuelle : salutation, nom du client, lien pellets (casse exacte) et marque utile en phrase', () => {
  const n = noms(MANUELLE);
  for (const v of ['{{SALUTATION}}', '{{CLIENT_NAME}}', '{{lien_pellets}}', '{{BRAND_NAME}}', '{{ORG_PHONE}}', '{{ORG_EMAIL}}', '{{ORG_WEBSITE_URL}}']) assert.ok(n.includes(v), v);
  for (const v of ['{{ACCENT_COLOR}}', '{{SECONDARY_COLOR}}', '{{LOGO_URL}}', '{{EMAIL_TAGLINE}}']) assert.ok(!n.includes(v), `${v} posé par le programme`);
  assert.deepEqual(noms(AUTO), n);
  assert.equal(new Set(n).size, n.length);
  assert.equal(variablesProposees(MANUELLE).find((v) => v.nom === '{{lien_pellets}}').lien, true);
  assert.equal(variablesProposees(MANUELLE).find((v) => v.nom === '{{SALUTATION}}').lien, false);
  assert.equal(n.filter((v) => VARIABLES_MARQUE.includes(v)).length, 7);
});

test('séquence : mêmes variables qu’une campagne', () => {
  assert.deepEqual(noms({ key: 'sequence_relance_devis' }), noms(MANUELLE));
});

test('e-mail du registre : variables de son texte et de son exemple, jamais les couleurs', () => {
  const n = noms({ key: 'pv_reception' });
  for (const v of ['{{PRENOM}}', '{{OBJET}}', '{{LIEN_PV}}', '{{BRAND_NAME}}']) assert.ok(n.includes(v), v);
  assert.ok(!n.includes('{{ACCENT_COLOR}}'));
  assert.equal(variablesProposees({ key: 'pv_reception' }).find((v) => v.nom === '{{LIEN_PV}}').lien, true);
  assert.equal(libelleVariable('{{LIEN_PV}}'), 'Lien de signature du PV');
});

test('boutique : les variables de la clé ; un tableau seul à la racine est un bloc', () => {
  const v = variablesProposees({ key: 'webshop_confirmation' });
  assert.equal(v.find((x) => x.nom === '{{ITEMS}}').bloc, true);
  assert.equal(v.find((x) => x.nom === '{{LEGAL_INFO}}').bloc, true);
  assert.equal(v.find((x) => x.nom === '{{CLIENT_NAME}}').bloc, false);
  assert.equal(variablesProposees({ key: 'webshop_feuille_route' }).find((x) => x.nom === '{{ITINERAIRE_URL}}').lien, true);
  assert.ok(!noms({ key: 'webshop_confirmation' }).includes('{{ARRETS}}'));
});

test('texte : ce qui s’insère dans une phrase (le site de l’entreprise compris), jamais un lien d’action ni un bloc', () => {
  const v = (c, nom) => variablesProposees(c).find((x) => x.nom === nom);
  for (const nom of ['{{SALUTATION}}', '{{CLIENT_NAME}}', '{{BRAND_NAME}}', '{{ORG_PHONE}}']) assert.equal(v(MANUELLE, nom).texte, true, nom);
  // Le site se lit dans une phrase ET sert d'adresse de lien.
  assert.equal(v(MANUELLE, '{{ORG_WEBSITE_URL}}').texte, true);
  assert.equal(v(MANUELLE, '{{ORG_WEBSITE_URL}}').lien, true);
  assert.equal(v(MANUELLE, '{{lien_pellets}}').texte, false);
  assert.equal(v({ key: 'pv_reception' }, '{{LIEN_PV}}').texte, false);
  assert.equal(v({ key: 'webshop_feuille_route' }, '{{ITINERAIRE_URL}}').texte, false);
  assert.equal(v({ key: 'webshop_confirmation' }, '{{ITEMS}}').texte, false);
  assert.equal(v({ key: 'webshop_confirmation' }, '{{CLIENT_NAME}}').texte, true);
  // Tout `lien: true` autre que le site est un lien d'action ; tout bloc est hors du texte.
  const toutes = [MANUELLE, { key: 'pv_reception' }, { key: 'webshop_confirmation' }, { key: 'webshop_feuille_route' },
    ...EMAILS_AUTOMATIQUES.map((e) => ({ key: e.gabarit.key }))].flatMap((c) => variablesProposees(c));
  for (const x of toutes) {
    assert.equal(typeof x.texte, 'boolean', x.nom);
    if (x.bloc) assert.equal(x.texte, false, x.nom);
    else assert.equal(x.texte, !x.lien || x.nom === '{{ORG_WEBSITE_URL}}', x.nom);
  }
});

test('libelleVariable : libellé d’artisan, sinon nom brut sans accolades', () => {
  assert.equal(libelleVariable('{{SALUTATION}}'), 'Formule de politesse');
  assert.equal(libelleVariable('CLIENT_NAME'), 'Nom du client');
  assert.equal(libelleVariable('{{BRAND_NAME}}'), 'Nom de l’entreprise');
  assert.equal(libelleVariable('{{XYZ_INCONNU}}'), 'XYZ_INCONNU');
  assert.equal(libelleVariable(''), '');
});

test('chaque variable de chaque texte par défaut et de la boutique a un libellé d’artisan', () => {
  const tous = new Set(VARIABLES_MARQUE);
  for (const e of EMAILS_AUTOMATIQUES) {
    variablesDe(e.gabarit.subject + e.gabarit.html_body).forEach((v) => tous.add(v));
    Object.keys(e.exemple).forEach((v) => tous.add(v));
  }
  for (const s of SEQUENCES_EMAILS) variablesDe(s.gabarit.subject + s.gabarit.html_body).forEach((v) => tous.add(v));
  for (const g of Object.values(WEBSHOP_EMAIL_DEFAULTS)) variablesDe(g.subject + g.html_body).forEach((v) => tous.add(v));
  for (const l of Object.values(WEBSHOP_EMAIL_PLACEHOLDERS)) l.forEach((v) => tous.add(v));
  ['{{SALUTATION}}', '{{CLIENT_NAME}}', '{{lien_pellets}}'].forEach((v) => tous.add(v));
  for (const v of tous) {
    const l = libelleVariable(v);
    assert.notEqual(l, v.slice(2, -2), `${v} sans libellé`);
    assert.ok(!/variable|html|[{}]/i.test(l), l);
  }
});

test('variablesInconnues : {{PRENOM}} tapé dans une campagne est signalé ; SALUTATION, lien_pellets et marque non', () => {
  assert.deepEqual(variablesInconnues(MANUELLE, '<p>{{PRENOM}}</p>'), ['{{PRENOM}}']);
  assert.deepEqual(variablesInconnues(MANUELLE, '<p>{{SALUTATION}} {{lien_pellets}} {{BRAND_NAME}} {{ACCENT_COLOR}} {{CLIENT_NAME}}</p>'), []);
  assert.deepEqual(variablesInconnues(MANUELLE, '<p>{{prenom}} {{Salutation}}</p>'), ['{{prenom}}', '{{Salutation}}']);
  assert.deepEqual(variablesInconnues({ key: 'pv_reception' }, '<p>{{PRENOM}} {{ORDER_NUMBER}}</p>'), ['{{ORDER_NUMBER}}']);
  assert.deepEqual(variablesInconnues(MANUELLE, ''), []);
  assert.deepEqual(variablesInconnues(null, null), []);
});

test('variablesManquantes : libellés des variables du texte par défaut absentes du texte', () => {
  const defaut = WEBSHOP_EMAIL_DEFAULTS.webshop_confirmation.html_body;
  assert.deepEqual(variablesManquantes({ key: 'webshop_confirmation' }, defaut), []);
  assert.deepEqual(variablesManquantes({ key: 'webshop_confirmation' }, defaut.replace('{{LEGAL_INFO}}', '')), ['Mentions légales']);
  const m = variablesManquantes({ key: 'webshop_confirmation' }, '<p>Merci</p>');
  assert.ok(m.includes('Mentions légales') && m.includes('Récapitulatif de la commande'));
  assert.deepEqual(variablesManquantes(MANUELLE, '<p>x</p>'), []);
  assert.deepEqual(variablesManquantes({ key: 'pv_reception' }, ''), variablesManquantes({ key: 'pv_reception' }, null));
  assert.ok(!variablesManquantes({ key: 'pv_reception' }, '').includes('Couleur principale'));
});

test('mails habillés par le site : seules BRAND_NAME, ORG_EMAIL et ORG_PHONE sont des variables d’entreprise', () => {
  assert.deepEqual([...VARIABLES_MARQUE_DU_SITE], ['{{BRAND_NAME}}', '{{ORG_EMAIL}}', '{{ORG_PHONE}}']);
  for (const key of GABARITS_HABILLES_PAR_LE_SITE) {
    const n = noms({ key });
    assert.deepEqual(n.filter((v) => VARIABLES_MARQUE.includes(v)).sort(), [...VARIABLES_MARQUE_DU_SITE].sort(), key);
    assert.equal(n.filter((v) => VARIABLES_MARQUE.includes(v)).length, 3, key);
    assert.deepEqual(variablesInconnues({ key }, '<p>{{BRAND_NAME}} {{ORG_EMAIL}} {{ORG_PHONE}}</p>'), []);
    assert.deepEqual(variablesInconnues({ key }, '<p>{{ORG_WEBSITE_URL}} {{ACCENT_COLOR}}</p>'), ['{{ORG_WEBSITE_URL}}', '{{ACCENT_COLOR}}']);
  }
  assert.equal(noms(MANUELLE).filter((v) => VARIABLES_MARQUE.includes(v)).length, 7);
  assert.deepEqual(variablesInconnues(MANUELLE, '<p>{{ORG_WEBSITE_URL}} {{ACCENT_COLOR}}</p>'), []);
  assert.deepEqual(variablesInconnues({ key: 'webshop_ordre_colis' }, '<p>{{ACCENT_COLOR}}</p>'), []);
});

// ── Objet du mail ────────────────────────────────────────────────────────────

test('variablesAccepteesDansLObjet : campagne = ce que mailing-send remplace dans l’objet (nom du client et marque)', () => {
  for (const c of [MANUELLE, AUTO, { key: SEQUENCES_EMAILS[0].gabarit.key }]) {
    const ok = variablesAccepteesDansLObjet(c);
    assert.ok(ok.includes('{{CLIENT_NAME}}'), c.key);
    for (const v of VARIABLES_MARQUE) assert.ok(ok.includes(v), `${c.key} ${v}`);
    assert.ok(!ok.includes('{{SALUTATION}}'), c.key);
    assert.ok(!ok.includes('{{lien_pellets}}'), c.key);
  }
});

test('variablesAccepteesDansLObjet : e-mail de l’application et boutique = mêmes remplacements que le texte', () => {
  for (const e of EMAILS_AUTOMATIQUES) {
    const c = { key: e.gabarit.key };
    assert.deepEqual(variablesInconnuesDeLObjet(c, e.gabarit.subject), [], e.gabarit.key);
    // Les edges du registre appliquent à l'objet les remplacements du texte : même verdict, jeton par jeton.
    for (const v of variablesDe(`${e.gabarit.html_body}{{SALUTATION}}{{PRENOM}}{{INCONNUE_X}}${VARIABLES_MARQUE.join('')}`)) {
      assert.deepEqual(variablesInconnuesDeLObjet(c, v), variablesInconnues(c, v), `${e.gabarit.key} ${v}`);
    }
  }
  for (const k of WEBSHOP_EMAIL_KEYS) {
    assert.deepEqual(variablesInconnuesDeLObjet({ key: k }, WEBSHOP_EMAIL_DEFAULTS[k].subject), [], k);
  }
});

test('variablesInconnuesDeLObjet : formule de politesse et lien pellets arriveraient tels quels dans l’objet d’une campagne', () => {
  assert.deepEqual(
    variablesInconnuesDeLObjet(MANUELLE, '{{SALUTATION}} {{CLIENT_NAME}} chez {{BRAND_NAME}} {{PRENOM}} {{lien_pellets}}'),
    ['{{SALUTATION}}', '{{PRENOM}}', '{{lien_pellets}}'],
  );
  assert.deepEqual(variablesInconnuesDeLObjet(AUTO, 'Votre entretien, {{CLIENT_NAME}}'), []);
  assert.deepEqual(variablesInconnuesDeLObjet(MANUELLE, ''), []);
  assert.deepEqual(variablesInconnuesDeLObjet(MANUELLE, null), []);
});
