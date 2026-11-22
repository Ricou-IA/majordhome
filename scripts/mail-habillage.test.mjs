import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  habillerMail, valeursDeMarque, couleurValide, lireHabillage, choixDepuisReglages, aDejaDesabonnement,
  HABILLAGE_DEFAUT, DEFAUTS_MARQUE,
} from '../src/lib/mailHabillage.js';
import { VARIABLES_MARQUE } from '../src/lib/emailsAutomatiques.js';

const S = '<html><body>T{{LOGO_URL}}<div>{{EMAIL_BODY}}</div></body></html>';
const MAL_FORMEES = ['orange', '#12', 'red;}', '"><script>'];

test('page complète : rendue telle quelle', () => {
  const page = '<!DOCTYPE html><html><body>x</body></html>';
  assert.equal(habillerMail({ email_habillage: HABILLAGE_DEFAUT }, page), page);
});

test('ancien habillage sans email_habillage : identique à aujourd\'hui', () => {
  assert.equal(habillerMail({ email_skeleton_html: S }, '<p>a</p>'), S.replace('{{EMAIL_BODY}}', '<p>a</p>'));
});

test('email_habillage prime sur l\'ancien habillage ; null y revient', () => {
  assert.ok(!habillerMail({ email_skeleton_html: S, email_habillage: HABILLAGE_DEFAUT }, '<p>a</p>').startsWith('<html><body>T'));
  assert.equal(habillerMail({ email_skeleton_html: S, email_habillage: null }, '<p>a</p>'), S.replace('{{EMAIL_BODY}}', '<p>a</p>'));
});

test('habillage par défaut : un lien de désabonnement, un seul', () => {
  const r = { from_email: 'contact@ex.fr', brand_name: 'Cimaj' };
  assert.equal(habillerMail(r, '<p>a</p>').split('mailto:contact@ex.fr?subject=Désabonnement').length - 1, 1);
  const deja = '<p><a href="mailto:{{ORG_EMAIL}}?subject=Désabonnement">x</a></p>';
  assert.equal(habillerMail(r, deja).split('subject=Désabonnement').length - 1, 1);
});

test('aDejaDesabonnement : avec ou sans accent', () => {
  assert.equal(aDejaDesabonnement('<a href="mailto:a@b.fr?subject=Désabonnement">'), true);
  assert.equal(aDejaDesabonnement('<a href="mailto:a@b.fr?subject=Desabonnement">'), true);
  assert.equal(aDejaDesabonnement('<a href="mailto:a@b.fr?subject=Bonjour">'), false);
});

test('valeurs de marque : clés du registre, défauts neutres, couleur mal formée écartée', () => {
  assert.deepEqual(Object.keys(valeursDeMarque({})).sort(), [...VARIABLES_MARQUE].sort());
  assert.equal(valeursDeMarque({})['{{ACCENT_COLOR}}'], '#64748b');
  assert.equal(valeursDeMarque({})['{{SECONDARY_COLOR}}'], '#334155');
  assert.equal(valeursDeMarque({})['{{BRAND_NAME}}'], '');
  assert.deepEqual(valeursDeMarque(null), valeursDeMarque({}));
  for (const c of MAL_FORMEES) {
    assert.equal(valeursDeMarque({ accent_color: c })['{{ACCENT_COLOR}}'], '#64748b');
    assert.equal(valeursDeMarque({ secondary_color: c })['{{SECONDARY_COLOR}}'], '#334155');
  }
  assert.equal(valeursDeMarque({ accent_color: '#F97316', secondary_color: '#abc' })['{{ACCENT_COLOR}}'], '#F97316');
});

test('couleurValide : #rgb et #rrggbb seulement', () => {
  assert.equal(couleurValide('#abc', 'X'), '#abc');
  assert.equal(couleurValide('#A1b2C3', 'X'), '#A1b2C3');
  for (const c of [...MAL_FORMEES, '#abcd', '#12345g', '', null, undefined, 12]) assert.equal(couleurValide(c, 'X'), 'X');
});

test('une couleur mal formée n\'apparaît jamais dans l\'e-mail construit', () => {
  for (const c of MAL_FORMEES) {
    const r = { accent_color: c, secondary_color: c, email_tagline: 'S', email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: false, site: false } } };
    const h = habillerMail(r, '<p>a</p>');
    assert.ok(!h.includes(c), `couleur ${c} présente`);
    assert.ok(h.includes(DEFAUTS_MARQUE.bandeau));
  }
});

test('nom de l\'entreprise échappé, logo seulement en https, sans logo le nom', () => {
  const h = habillerMail({ brand_name: '<b>X</b>', logo_url: 'javascript:1' }, '<p>a</p>');
  assert.ok(h.includes('&lt;b&gt;X&lt;/b&gt;') && !h.includes('<img'));
  assert.ok(habillerMail({ brand_name: 'X', logo_url: 'https://ex.fr/l.png' }, '<p>a</p>').includes('<img'));
});

test('bandeau et certifications selon les choix', () => {
  const r = { email_tagline: 'Slogan', rge_certifications: ['QualiBois'], email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: true, site: false } } };
  const h = habillerMail(r, '<p>a</p>');
  assert.ok(h.includes('Slogan') && h.includes('QualiBois') && h.includes('#334155'));
  assert.ok(!habillerMail({ ...r, email_habillage: HABILLAGE_DEFAUT }, '<p>a</p>').includes('Slogan'));
});

test('le corps est inséré tel quel, variables comprises', () => {
  const corps = '<p>Bonjour {{CLIENT_NAME}} <b>&amp;</b></p>';
  assert.ok(habillerMail({}, corps).includes(corps));
});

test('lireHabillage : null hors objet, valeurs inconnues ramenées au défaut', () => {
  assert.equal(lireHabillage({}), null);
  assert.equal(lireHabillage({ email_habillage: null }), null);
  assert.equal(lireHabillage({ email_habillage: 'x' }), null);
  assert.deepEqual(lireHabillage({ email_habillage: { entete: 'zzz', pied: { coordonnees: 'oui', site: true } } }), {
    ...HABILLAGE_DEFAUT, pied: { ...HABILLAGE_DEFAUT.pied, coordonnees: true, certifications: false, site: true },
  });
});

test('choixDepuisReglages : réglages vides, ancien habillage seul, choix enregistré', () => {
  assert.deepEqual(choixDepuisReglages({}), HABILLAGE_DEFAUT);
  assert.deepEqual(choixDepuisReglages(null), HABILLAGE_DEFAUT);
  assert.deepEqual(choixDepuisReglages({ email_skeleton_html: S }), {
    ...HABILLAGE_DEFAUT, entete: 'logo_bandeau', pied: { ...HABILLAGE_DEFAUT.pied, coordonnees: true, certifications: false, site: true },
  });
  const enregistre = { entete: 'logo_bandeau', pied: { coordonnees: false, certifications: true, site: false } };
  assert.deepEqual(choixDepuisReglages({ email_skeleton_html: S, email_habillage: enregistre }), {
    ...HABILLAGE_DEFAUT, entete: 'logo_bandeau', pied: { ...HABILLAGE_DEFAUT.pied, ...enregistre.pied },
  });
});

test('ancien habillage : un corps portant $& ou $$ sort intact', () => {
  const corps = '<p>Prix : 5 $$ et $& et $1 et $`</p>';
  assert.equal(habillerMail({ email_skeleton_html: S }, corps), S.replace('{{EMAIL_BODY}}', () => corps));
  assert.ok(habillerMail({ email_skeleton_html: S }, corps).includes(corps));
});

test("habillage construit sans adresse d'entreprise : aucun lien de désabonnement", () => {
  const h = habillerMail({ brand_name: 'Cimaj' }, '<p>a</p>');
  assert.ok(!h.includes('mailto:'), 'lien mailto vide écrit');
  assert.ok(!h.includes('Se désabonner'));
  assert.ok(habillerMail({ brand_name: 'Cimaj', from_email: 'c@ex.fr' }, '<p>a</p>').includes('mailto:c@ex.fr?subject=Désabonnement'));
});

test('valeurs hostiles : rien de brut dans le HTML construit', () => {
  const hostile = `<script>x</script>"onmouseover="y'`;
  const r = {
    brand_name: hostile, email_tagline: hostile, rge_certifications: [hostile], address: hostile,
    phone: hostile, city: hostile, postal_code: hostile, from_email: hostile,
    website_url: `https://ex.fr/${hostile}`, logo_url: `https://ex.fr/l.png${hostile}`,
    email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: true, site: true } },
  };
  const h = habillerMail(r, '<p>a</p>');
  assert.ok(!h.includes('<script'), 'balise script brute');
  // Aucun attribut cassé : chaque guillemet doublé brut de l'attribut est échappé.
  for (const m of h.matchAll(/(?:href|src|alt)="([^"]*)"/g)) assert.ok(!/[<>'"]/.test(m[1]), `attribut non échappé : ${m[1]}`);
  assert.ok(!h.includes('onmouseover="y'), 'attribut injecté');
});

// ---------------------------------------------------------------------------
// Les edges délèguent : lecture des sources (tâche 2)
// ---------------------------------------------------------------------------
const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const lireEdge = (...chemin) => readFileSync(join(RACINE, 'supabase', 'functions', ...chemin), 'utf8').replace(/\r\n/g, '\n');

test("les edges d'habillage ne portent plus leur propre habillage ni leurs couleurs", () => {
  for (const chemin of [['_shared', 'mail.ts'], ['mailing-send', 'index.ts'], ['contract-signed-notify', 'index.ts']]) {
    const source = lireEdge(...chemin);
    const nom = chemin.join('/');
    assert.doesNotMatch(source, /email_skeleton_html/, `${nom} lit encore email_skeleton_html`);
    assert.doesNotMatch(source, /#f97316/i, `${nom} porte encore #f97316`);
    assert.doesNotMatch(source, /#1E4D8C/i, `${nom} porte encore #1E4D8C`);
    assert.doesNotMatch(source, /habillageNeutre/, `${nom} porte encore habillageNeutre`);
    assert.match(source, /mailHabillage\.js/, `${nom} n'importe pas mailHabillage.js`);
  }
});

test('mail.ts : wrapWithSkeleton rend habillerMail, brandingReplacements rend valeursDeMarque', () => {
  const source = lireEdge('_shared', 'mail.ts');
  assert.match(source, /export function wrapWithSkeleton[\s\S]*?habillerMail\(b\.reglages, body\)/);
  assert.match(source, /export function brandingReplacements[\s\S]*?valeursDeMarque\(b\.reglages\)/);
});

test('mailing-send et contract-signed-notify : habillage et marque viennent du module', () => {
  const envoi = lireEdge('mailing-send', 'index.ts');
  assert.match(envoi, /habillerMail\(branding\.reglages, htmlBody, \{ usage: 'campagne' \}\)/);
  assert.match(envoi, /valeursDeMarque\(/);
  assert.doesNotMatch(envoi, /function wrapInSkeleton/);
  const notif = lireEdge('contract-signed-notify', 'index.ts');
  assert.match(notif, /habillerMail\(/);
  assert.match(notif, /valeursDeMarque\(/);
});

// ---------------------------------------------------------------------------
// Habillage enrichi (spec 2026-11-22 § 2) : logo, bouton du bandeau, pied enrichi, blocs fixes
// ---------------------------------------------------------------------------
const AVANT = JSON.parse(readFileSync(join(RACINE, 'scripts', 'fixtures', 'mail-habillage-avant.json'), 'utf8'));
const COMPLET = {
  brand_name: 'Cimaj', from_email: 'c@cimaj.fr', accent_color: '#c2410c', secondary_color: '#1e3a8a',
  email_tagline: 'Chauffage', logo_url: 'https://ex.fr/l.png',
};
/** Réglages complets avec un habillage enrichi. @param {Record<string, any>} h */
const avec = (h) => ({ ...COMPLET, email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true }, ...h } });
/** @param {string} html @param {string} motif */
const compter = (html, motif) => html.split(motif).length - 1;

test('sans les nouvelles clés : sortie identique, octet pour octet, à celle d’avant', () => {
  assert.ok(AVANT.cas.length >= 3);
  for (const c of AVANT.cas) {
    assert.equal(habillerMail(c.reglages, AVANT.corps), c.html, c.nom);
    assert.equal(habillerMail(c.reglages, AVANT.corps, { usage: 'campagne' }), c.html, `${c.nom} (campagne)`);
  }
});

test('HABILLAGE_DEFAUT : défauts = comportement d’aujourd’hui', () => {
  assert.deepEqual(HABILLAGE_DEFAUT.logo, { position: 'gauche', taille: 'moyen' });
  assert.equal(HABILLAGE_DEFAUT.bouton_bandeau, null);
  assert.deepEqual(HABILLAGE_DEFAUT.blocs, []);
  assert.deepEqual(HABILLAGE_DEFAUT.pied, {
    coordonnees: true, certifications: false, site: false, horaires: '', texte: '', fond: 'clair',
    reseaux: { facebook: '', instagram: '', avis_google: '', linkedin: '' },
  });
  assert.deepEqual(lireHabillage({ email_habillage: {} }), HABILLAGE_DEFAUT);
});

test('logo : position et taille', () => {
  const centre = habillerMail(avec({ logo: { position: 'centre', taille: 'grand' } }), '<p>a</p>');
  assert.match(centre, /<td align="center"[^>]*><img [^>]*max-height:80px/);
  const petit = habillerMail(avec({ logo: { position: 'gauche', taille: 'petit' } }), '<p>a</p>');
  assert.match(petit, /max-height:40px/);
  assert.ok(!/<td align="center"[^>]*><img/.test(petit));
  // Sans logo : le nom, à la même position.
  const nom = habillerMail({ ...avec({ logo: { position: 'centre', taille: 'petit' } }), logo_url: '' }, '<p>a</p>');
  assert.match(nom, /<td align="center"[^>]*><span[^>]*>Cimaj<\/span>/);
  // Valeurs inconnues : défaut.
  assert.deepEqual(lireHabillage(avec({ logo: { position: 'haut', taille: 99 } })).logo, HABILLAGE_DEFAUT.logo);
  assert.deepEqual(lireHabillage(avec({ logo: 'centre' })).logo, HABILLAGE_DEFAUT.logo);
});

test('bouton du bandeau : seulement quand le bandeau est dessiné', () => {
  const b = { bouton_bandeau: { libelle: 'Prendre RDV', adresse: 'https://ex.fr/rdv' } };
  assert.equal(compter(habillerMail(avec(b), '<p>a</p>'), 'href="https://ex.fr/rdv"'), 1);
  assert.ok(!habillerMail(avec({ ...b, entete: 'logo' }), '<p>a</p>').includes('ex.fr/rdv'));
  assert.ok(!habillerMail({ ...avec(b), email_tagline: '' }, '<p>a</p>').includes('ex.fr/rdv'));
  // Un bouton sans libellé ou sans adresse valide n'existe pas.
  assert.equal(lireHabillage(avec({ bouton_bandeau: { libelle: '', adresse: 'https://ex.fr' } })).bouton_bandeau, null);
  assert.equal(lireHabillage(avec({ bouton_bandeau: { libelle: 'x', adresse: 'ex.fr' } })).bouton_bandeau, null);
  assert.equal(lireHabillage(avec({ bouton_bandeau: 'x' })).bouton_bandeau, null);
});

test('adresses : https, http, mailto, tel seulement ; une adresse invalide rend l’élément absent', () => {
  for (const ok of ['https://ex.fr', 'http://ex.fr/a?b=1', 'mailto:a@b.fr', 'tel:0563000000']) {
    assert.equal(lireHabillage(avec({ bouton_bandeau: { libelle: 'x', adresse: ok } })).bouton_bandeau?.adresse, ok, ok);
  }
  for (const ko of ['javascript:alert(1)', 'JaVaScRiPt:1', 'data:text/html,x', 'ex.fr', 'https://', 'https://a b', '', 42,
    'https://ex.fr/{{CLIENT_NAME}}', 'mailto:a@b.fr?subject=Désabonnement', 'tel:', ' https://ex.fr\n/x']) {
    assert.equal(lireHabillage(avec({ bouton_bandeau: { libelle: 'x', adresse: ko } })).bouton_bandeau, null, String(ko));
    assert.equal(lireHabillage(avec({ pied: { reseaux: { facebook: ko } } })).pied.reseaux.facebook, '', String(ko));
  }
});

test('pied : horaires, ligne libre, réseaux en toutes lettres', () => {
  const h = habillerMail(avec({ pied: {
    coordonnees: false, horaires: 'Lun–ven 8 h – 18 h', texte: 'Entreprise familiale',
    reseaux: { facebook: 'https://fb.com/x', instagram: '', avis_google: 'https://g.page/r/x', linkedin: 'https://linkedin.com/x' },
  } }), '<p>a</p>');
  assert.ok(h.includes('Lun–ven 8 h – 18 h') && h.includes('Entreprise familiale'));
  assert.match(h, />Facebook<\/a> · <a [^>]*>Nos avis Google<\/a> · <a [^>]*>LinkedIn<\/a>/);
  assert.ok(!h.includes('Instagram'));
  assert.ok(!habillerMail(avec({}), '<p>a</p>').includes('Facebook'));
});

test('pied à fond « bandeau » : texte blanc, liens blancs soulignés', () => {
  const h = habillerMail(avec({ pied: { coordonnees: true, site: true, fond: 'bandeau', reseaux: { facebook: 'https://fb.com/x' } } }),
    '<p>a</p>');
  const pied = h.slice(h.lastIndexOf('<tr><td style="padding:16px 28px;'));
  assert.match(pied, /^<tr><td style="padding:16px 28px;background:#1e3a8a;[^"]*color:#ffffff;/);
  for (const m of pied.matchAll(/<a [^>]*style="([^"]*)"/g)) {
    assert.match(m[1], /color:#ffffff;/, m[1]);
    assert.match(m[1], /text-decoration:underline;/, m[1]);
  }
  assert.ok(!pied.includes('#c2410c'), 'lien à la couleur des boutons sur le fond du bandeau');
});

const BLOC = { titre: 'Parrainez un proche', texte: 'Un mois offert', bouton: { libelle: 'Je parraine', adresse: 'https://ex.fr/p' } };

test('blocs : « campagnes » seulement sur une campagne, « tous » partout, après le texte et avant le pied', () => {
  const r = avec({ blocs: [BLOC, { ...BLOC, titre: 'Laissez-nous un avis', ou: 'tous', bouton: null }] });
  const camp = habillerMail(r, '<p>CORPS</p>', { usage: 'campagne' });
  const indiv = habillerMail(r, '<p>CORPS</p>');
  assert.ok(camp.includes('Parrainez un proche') && camp.includes('Laissez-nous un avis'));
  assert.ok(!indiv.includes('Parrainez un proche') && indiv.includes('Laissez-nous un avis'));
  assert.ok(!habillerMail(r, '<p>CORPS</p>', /** @type {any} */ ({ usage: 'zzz' })).includes('Parrainez'));
  assert.ok(camp.indexOf('CORPS') < camp.indexOf('Parrainez') && camp.indexOf('Laissez') < camp.indexOf('Se désabonner'));
  // Bouton du bloc : couleur des boutons, texte blanc.
  assert.match(camp, /<a href="https:\/\/ex\.fr\/p" style="[^"]*background:#c2410c;[^"]*color:#ffffff;/);
  // Texte sur plusieurs lignes : retours à la ligne gardés.
  assert.ok(habillerMail(avec({ blocs: [{ ...BLOC, texte: 'L1\nL2', ou: 'tous' }] }), 'x').includes('L1<br>L2'));
});

test('blocs : deux au plus, un bloc vide retiré, ou inconnu = campagnes', () => {
  const lu = lireHabillage(avec({ blocs: [BLOC, { titre: '', texte: '  ', bouton: { libelle: '', adresse: '' } }, { ...BLOC, titre: 'B' }, { ...BLOC, titre: 'C' }] }));
  assert.deepEqual(lu.blocs.map((b) => b.titre), ['Parrainez un proche', 'B']);
  assert.equal(lu.blocs[0].ou, 'campagnes');
  assert.deepEqual(lireHabillage(avec({ blocs: 'x' })).blocs, []);
  assert.deepEqual(lireHabillage(avec({ blocs: [null, 3, 'a', { titre: 12 }] })).blocs, []);
  // Bouton sans adresse valide : le bloc reste, sans bouton.
  assert.equal(lireHabillage(avec({ blocs: [{ ...BLOC, bouton: { libelle: 'x', adresse: 'javascript:1' } }] })).blocs[0].bouton, null);
});

test('bornes : textes tronqués à leur longueur', () => {
  const long = 'x'.repeat(1000);
  const lu = lireHabillage(avec({
    bouton_bandeau: { libelle: long, adresse: 'https://ex.fr' },
    pied: { horaires: long, texte: long },
    blocs: [{ titre: long, texte: long, bouton: { libelle: long, adresse: 'https://ex.fr' } }],
  }));
  assert.equal(lu.bouton_bandeau.libelle.length, 40);
  assert.equal(lu.pied.horaires.length, 200);
  assert.equal(lu.pied.texte.length, 300);
  assert.equal(lu.blocs[0].titre.length, 80);
  assert.equal(lu.blocs[0].texte.length, 300);
  assert.equal(lu.blocs[0].bouton.libelle.length, 40);
});

test('valeurs malformées : jamais d’exception, retour aux défauts', () => {
  for (const h of [{ logo: null, pied: 'x', blocs: {}, bouton_bandeau: [] }, { pied: { reseaux: 'x', fond: 3, horaires: {} } },
    { pied: { reseaux: [1, 2] } }, { blocs: [{ bouton: 'x', ou: {} }] }, []]) {
    assert.doesNotThrow(() => habillerMail({ email_habillage: h }, '<p>a</p>', { usage: 'campagne' }));
    assert.doesNotThrow(() => habillerMail({ email_habillage: h }, '<p>a</p>', /** @type {any} */ ('x')));
  }
  assert.equal(lireHabillage({ email_habillage: { pied: { fond: 3 } } }).pied.fond, 'clair');
  assert.deepEqual(lireHabillage({ email_habillage: { pied: { reseaux: 'x' } } }).pied.reseaux, HABILLAGE_DEFAUT.pied.reseaux);
});

test('valeurs hostiles dans les nouveaux textes et adresses : tout est échappé', () => {
  const hostile = '<script>x</script>"onmouseover="y\'';
  const r = avec({
    bouton_bandeau: { libelle: hostile, adresse: `https://ex.fr/${hostile}` },
    pied: { coordonnees: true, horaires: hostile, texte: hostile, fond: 'bandeau',
      reseaux: { facebook: `https://fb.com/${hostile}`, instagram: 'javascript:alert(1)', avis_google: `mailto:${hostile}`, linkedin: 'tel:"><b>' } },
    blocs: [{ titre: hostile, texte: hostile, bouton: { libelle: hostile, adresse: `https://ex.fr/${hostile}` }, ou: 'tous' }],
  });
  const h = habillerMail(r, '<p>a</p>', { usage: 'campagne' });
  assert.ok(!h.includes('<script'), 'balise script brute');
  assert.ok(!h.includes('<b>'), 'balise injectée');
  assert.ok(!/javascript:/i.test(h), 'adresse javascript');
  for (const m of h.matchAll(/(?:href|src|alt|style)="([^"]*)"/g)) assert.ok(!/[<>'"]/.test(m[1]), `attribut non échappé : ${m[1]}`);
  assert.ok(!h.includes('onmouseover="y'), 'attribut injecté');
  assert.equal(compter(h, 'Se désabonner'), 1);
});

test('toutes les options : HTML bien formé, un seul lien de désabonnement', () => {
  const r = avec({
    logo: { position: 'centre', taille: 'grand' },
    bouton_bandeau: { libelle: 'Prendre RDV', adresse: 'https://ex.fr/rdv' },
    pied: { coordonnees: true, certifications: true, site: true, horaires: 'Lun–ven', texte: 'Ligne', fond: 'bandeau',
      reseaux: { facebook: 'https://fb.com/x', instagram: 'https://ig.com/x', avis_google: 'https://g.page/x', linkedin: 'https://li.com/x' } },
    blocs: [BLOC, { ...BLOC, titre: 'Avis', ou: 'tous' }],
  });
  const h = habillerMail({ ...r, website_url: 'https://cimaj.fr', rge_certifications: ['QualiPAC'] }, '<p>a</p>', { usage: 'campagne' });
  for (const balise of ['table', 'tr', 'td', 'a', 'p']) {
    assert.equal(compter(h, `<${balise} `) + compter(h, `<${balise}>`), compter(h, `</${balise}>`), balise);
  }
  assert.equal(compter(h, 'subject=Désabonnement'), 1);
});
