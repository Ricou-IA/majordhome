import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formulaireInitial, situationHabillage, erreursFormulaire, estModifie, patchAEnregistrer,
  reglagesApresEnregistrement, piedDisponible, lisibiliteBoutons, logoAffiche, bandeauVisible,
  couleurPourSelecteur, TEXTE_EXEMPLE, OBJET_EXEMPLE,
} from '../src/lib/mailHabillageEcran.js';
import { habillerMail, valeursDeMarque, DEFAUTS_MARQUE } from '../src/lib/mailHabillage.js';
import { contraste } from '../src/lib/pagePublique.js';

const ANCIEN = '<html><body>{{SECONDARY_COLOR}}<div>{{EMAIL_BODY}}</div></body></html>';
const MAYER = {
  brand_name: 'Mayer', address: '1 rue', postal_code: '81600', city: 'Gaillac', phone: '05 00 00 00 00',
  from_email: 'contact@mayer.fr', accent_color: '#f97316', secondary_color: '#1e3a8a', email_tagline: 'Chauffage',
  email_skeleton_html: ANCIEN, rge_certifications: ['QualiPAC'], website_url: 'https://mayer.fr',
};

test('formulaire initial : rien de réglé ⇒ défaut, couleurs vides (= par défaut)', () => {
  assert.deepEqual(formulaireInitial({}), {
    entete: 'logo', phrase: '', couleurBandeau: '', couleurBoutons: '',
    pied: { coordonnees: true, certifications: false, site: false },
  });
  assert.deepEqual(formulaireInitial(null), formulaireInitial({}));
});

test('formulaire initial : ancien habillage sans choix ⇒ bandeau, coordonnées, site, valeurs de marque reprises', () => {
  assert.deepEqual(formulaireInitial(MAYER), {
    entete: 'logo_bandeau', phrase: 'Chauffage', couleurBandeau: '#1e3a8a', couleurBoutons: '#f97316',
    pied: { coordonnees: true, certifications: false, site: true },
  });
});

test('situation : les quatre cas', () => {
  assert.deepEqual(situationHabillage({}), { ancien: false, choixEnregistre: false, remplacementAConfirmer: false, retourPossible: false });
  assert.deepEqual(situationHabillage(MAYER), { ancien: true, choixEnregistre: false, remplacementAConfirmer: true, retourPossible: false });
  const enregistre = { ...MAYER, email_habillage: { entete: 'logo', pied: {} } };
  assert.deepEqual(situationHabillage(enregistre), { ancien: true, choixEnregistre: true, remplacementAConfirmer: false, retourPossible: true });
  assert.deepEqual(situationHabillage({ email_habillage: { entete: 'logo' } }), { ancien: false, choixEnregistre: true, remplacementAConfirmer: false, retourPossible: false });
  // Un ancien habillage sans emplacement du texte n'est pas utilisé à l'envoi : il n'est pas un « ancien habillage ».
  assert.equal(situationHabillage({ email_skeleton_html: '<p>rien</p>' }).ancien, false);
  // Après « Revenir à l'ancien habillage » (email_habillage: null) : retour au premier cas.
  assert.equal(situationHabillage({ ...MAYER, email_habillage: null }).remplacementAConfirmer, true);
});

test('rien changé ⇒ pas modifié ; une couleur changée ⇒ modifié ; espaces ignorés', () => {
  const init = formulaireInitial(MAYER);
  assert.equal(estModifie(init, init), false);
  assert.equal(estModifie({ ...init, phrase: ' Chauffage ' }, init), false);
  assert.equal(estModifie({ ...init, couleurBoutons: '#c2410c' }, init), true);
  assert.equal(estModifie({ ...init, pied: { ...init.pied, site: false } }, init), true);
});

test('couleurs : vide accepté, mal formée refusée avec sa raison', () => {
  assert.deepEqual(erreursFormulaire(formulaireInitial({})), {});
  const e = erreursFormulaire({ ...formulaireInitial({}), couleurBoutons: 'orange', couleurBandeau: '#12' });
  assert.ok(e.couleurBoutons && e.couleurBandeau);
  assert.deepEqual(erreursFormulaire({ ...formulaireInitial({}), couleurBoutons: '#abc' }), {});
  assert.throws(() => patchAEnregistrer({ ...formulaireInitial({}), couleurBoutons: 'red;}' }));
});

test('enregistrement : exactement les quatre clés, habillage entier, vide = null (donc défaut)', () => {
  const patch = patchAEnregistrer({ ...formulaireInitial({}), phrase: '  ', couleurBoutons: ' #C2410C ' });
  assert.deepEqual(Object.keys(patch).sort(), ['accent_color', 'email_habillage', 'email_tagline', 'secondary_color']);
  assert.deepEqual(patch.email_habillage, { entete: 'logo', pied: { coordonnees: true, certifications: false, site: false } });
  assert.equal(patch.accent_color, '#C2410C');
  assert.equal(patch.secondary_color, null);
  assert.equal(patch.email_tagline, null);
  // null est lu comme « par défaut » par la règle de l'envoi.
  const v = valeursDeMarque({ ...patch });
  assert.equal(v['{{SECONDARY_COLOR}}'], DEFAUTS_MARQUE.bandeau);
  assert.equal(v['{{EMAIL_TAGLINE}}'], '');
  assert.ok(!('email_skeleton_html' in patch));
});

test('aperçu = envoi : les réglages après enregistrement donnent le même habillage que l\'envoi', () => {
  const form = { ...formulaireInitial(MAYER), couleurBoutons: '#c2410c' };
  const apres = reglagesApresEnregistrement(MAYER, form);
  const enBase = { ...MAYER, ...patchAEnregistrer(form) };
  assert.equal(habillerMail(apres, TEXTE_EXEMPLE), habillerMail(enBase, TEXTE_EXEMPLE));
  // L'ancien habillage n'est plus celui qui part, mais il est conservé.
  assert.equal(apres.email_skeleton_html, ANCIEN);
  assert.ok(!habillerMail(apres, 'x').includes('{{SECONDARY_COLOR}}'));
});

test('texte d\'exemple : au format enregistré (titre, encadré, bouton) ; objet d\'exemple', () => {
  assert.match(TEXTE_EXEMPLE, /<h2 /);
  assert.match(TEXTE_EXEMPLE, /data-encadre/);
  assert.match(TEXTE_EXEMPLE, /data-bouton/);
  assert.ok(OBJET_EXEMPLE.length > 0);
});

test('pied de page : chaque choix fermé avec sa raison quand il n\'y a rien à montrer', () => {
  const vide = piedDisponible({});
  for (const cle of ['coordonnees', 'certifications', 'site']) {
    assert.equal(vide[cle].disponible, false);
    assert.ok(vide[cle].raison && vide[cle].lien.vers.startsWith('/settings/organization'));
  }
  const plein = piedDisponible(MAYER);
  for (const cle of ['coordonnees', 'certifications', 'site']) assert.equal(plein[cle].disponible, true);
  assert.equal(piedDisponible({ rge_certifications: ['  '] }).certifications.disponible, false);
  assert.equal(piedDisponible({ website_url: 'mayer.fr' }).site.disponible, false);
  assert.equal(piedDisponible({ phone: '05' }).coordonnees.disponible, true);
});

test('lisibilité des boutons : seuil 4,5, suggestion plus foncée lisible', () => {
  assert.equal(lisibiliteBoutons('#1e3a8a').lisible, true);
  assert.equal(lisibiliteBoutons('#1e3a8a').suggestion, null);
  const clair = lisibiliteBoutons('#f97316');
  assert.equal(clair.lisible, false);
  assert.ok(clair.ratio < 4.5);
  assert.match(clair.suggestion, /^#[0-9a-f]{6}$/);
  assert.ok(contraste(clair.suggestion, '#ffffff') >= 4.5);
  // Vide ou mal formée : jugée sur la couleur qui partira (le défaut).
  assert.equal(lisibiliteBoutons('').couleur, DEFAUTS_MARQUE.accent);
  assert.equal(lisibiliteBoutons('orange').couleur, DEFAUTS_MARQUE.accent);
});

test('logo : seulement une adresse https, sinon le nom de l\'entreprise', () => {
  assert.deepEqual(logoAffiche({ logo_url: 'https://x/l.png', brand_name: 'M' }), { url: 'https://x/l.png', nom: 'M' });
  assert.deepEqual(logoAffiche({ logo_url: 'http://x/l.png', brand_name: 'M' }), { url: null, nom: 'M' });
  assert.deepEqual(logoAffiche({}), { url: null, nom: '' });
});

test('bandeau : dessiné seulement avec « Logo et bandeau » ET une phrase', () => {
  assert.equal(bandeauVisible({ entete: 'logo_bandeau', phrase: 'x' }), true);
  assert.equal(bandeauVisible({ entete: 'logo_bandeau', phrase: '  ' }), false);
  assert.equal(bandeauVisible({ entete: 'logo', phrase: 'x' }), false);
  // Même verdict que la règle de l'envoi.
  const html = habillerMail(reglagesApresEnregistrement({}, { ...formulaireInitial({}), entete: 'logo_bandeau', phrase: 'Bonjour' }), 'x');
  assert.match(html, /Bonjour/);
});

test('sélecteur de couleur : toujours #rrggbb, la couleur qui partira', () => {
  assert.equal(couleurPourSelecteur('#abc', '#000000'), '#aabbcc');
  assert.equal(couleurPourSelecteur('', '#64748b'), '#64748b');
  assert.equal(couleurPourSelecteur('orange', '#334155'), '#334155');
});
