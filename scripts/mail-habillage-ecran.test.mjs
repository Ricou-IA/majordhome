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
const PIED_VIDE = {
  coordonnees: true, certifications: false, site: false, horaires: '', texte: '', fond: 'clair',
  reseaux: { facebook: '', instagram: '', avis_google: '', linkedin: '' },
};
const MAYER = {
  brand_name: 'Mayer', address: '1 rue', postal_code: '81600', city: 'Gaillac', phone: '05 00 00 00 00',
  from_email: 'contact@mayer.fr', accent_color: '#f97316', secondary_color: '#1e3a8a', email_tagline: 'Chauffage',
  email_skeleton_html: ANCIEN, rge_certifications: ['QualiPAC'], website_url: 'https://mayer.fr',
};

test('formulaire initial : rien de réglé ⇒ défaut, couleurs vides (= par défaut)', () => {
  assert.deepEqual(formulaireInitial({}), {
    entete: 'logo', phrase: '', couleurBandeau: '', couleurBoutons: '',
    logo: { position: 'gauche', taille: 'moyen' }, boutonBandeau: { libelle: '', adresse: '' },
    pied: { ...PIED_VIDE }, blocs: [],
  });
  assert.deepEqual(formulaireInitial(null), formulaireInitial({}));
});

test('formulaire initial : ancien habillage sans choix ⇒ bandeau, coordonnées, site, valeurs de marque reprises', () => {
  assert.deepEqual(formulaireInitial(MAYER), {
    entete: 'logo_bandeau', phrase: 'Chauffage', couleurBandeau: '#1e3a8a', couleurBoutons: '#f97316',
    logo: { position: 'gauche', taille: 'moyen' }, boutonBandeau: { libelle: '', adresse: '' },
    pied: { ...PIED_VIDE, site: true }, blocs: [],
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
  const e = erreursFormulaire({ ...formulaireInitial({}), entete: 'logo_bandeau', couleurBoutons: 'orange', couleurBandeau: '#12' });
  assert.ok(e.couleurBoutons && e.couleurBandeau);
  assert.deepEqual(erreursFormulaire({ ...formulaireInitial({}), couleurBoutons: '#abc' }), {});
  assert.throws(() => patchAEnregistrer({ ...formulaireInitial({}), couleurBoutons: 'red;}' }));
});

test('enregistrement : exactement les quatre clés, habillage entier, vide = null (donc défaut)', () => {
  const patch = patchAEnregistrer({ ...formulaireInitial({}), phrase: '  ', couleurBoutons: ' #C2410C ' });
  assert.deepEqual(Object.keys(patch).sort(), ['accent_color', 'email_habillage', 'email_tagline', 'secondary_color']);
  assert.deepEqual(patch.email_habillage, {
    entete: 'logo', logo: { position: 'gauche', taille: 'moyen' }, bouton_bandeau: null, pied: { ...PIED_VIDE }, blocs: [],
  });
  assert.equal(patch.accent_color, '#c2410c'); // écrite en minuscules (correctif d)
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

// ── Correctifs, tour 1 ────────────────────────────────────────────────────────
import {
  peutEnregistrer, raisonFermeture, libelleEnregistrer, empreinteHabillage, PASTILLES_BOUTONS, PASTILLES_BANDEAU,
  reglagesDeLApercu, ligneLogo,
} from '../src/lib/mailHabillageEcran.js';

test('ancien habillage sans choix : l\'habillage proposé s\'adopte tel quel', () => {
  const init = formulaireInitial(MAYER);
  assert.equal(peutEnregistrer(init, init, MAYER), true);
  assert.equal(raisonFermeture(init, init, MAYER), null);
  assert.equal(libelleEnregistrer(MAYER), 'Adopter cet habillage');
  // Couleur mal formée : jamais.
  assert.equal(peutEnregistrer({ ...init, couleurBoutons: 'orange' }, init, MAYER), false);
  assert.ok(raisonFermeture({ ...init, couleurBoutons: 'orange' }, init, MAYER));
});

test('choix enregistré : « Enregistrer » fermé sans changement, ouvert avec', () => {
  const r = { ...MAYER, email_habillage: { entete: 'logo', pied: {} } };
  const init = formulaireInitial(r);
  assert.equal(libelleEnregistrer(r), 'Enregistrer');
  assert.equal(peutEnregistrer(init, init, r), false);
  assert.equal(raisonFermeture(init, init, r), 'Aucune modification.');
  assert.equal(peutEnregistrer({ ...init, phrase: 'Autre' }, init, r), true);
  assert.equal(libelleEnregistrer({}), 'Enregistrer');
  assert.equal(peutEnregistrer(formulaireInitial({}), formulaireInitial({}), {}), false);
});

test('empreinte : ne bouge pas pour un réglage sans rapport, bouge pour l\'habillage', () => {
  const e = empreinteHabillage(MAYER);
  assert.equal(empreinteHabillage({ ...MAYER, from_email: 'autre@x.fr', reply_to: 'b@x.fr' }), e);
  for (const [cle, val] of [['email_habillage', { entete: 'logo' }], ['accent_color', '#000000'], ['secondary_color', '#111111'],
    ['email_tagline', 'Autre'], ['email_skeleton_html', '<p>{{EMAIL_BODY}}</p>'], ['logo_url', 'https://x/y.png']]) {
    assert.notEqual(empreinteHabillage({ ...MAYER, [cle]: val }), e, cle);
  }
});

test('pastilles : boutons lisibles en blanc, bandeau de la même famille, noms français', () => {
  assert.ok(PASTILLES_BOUTONS.length >= 6 && PASTILLES_BOUTONS.length <= 8);
  assert.equal(PASTILLES_BANDEAU.length, PASTILLES_BOUTONS.length);
  for (const p of [...PASTILLES_BOUTONS, ...PASTILLES_BANDEAU]) {
    assert.match(p.couleur, /^#[0-9a-f]{6}$/);
    assert.ok(p.nom.length > 0);
    assert.ok(contraste(p.couleur, '#ffffff') >= 4.5, p.nom);
  }
  PASTILLES_BOUTONS.forEach((p, i) => assert.ok(contraste(PASTILLES_BANDEAU[i].couleur, '#ffffff') >= contraste(p.couleur, '#ffffff'), p.nom));
});

test('« Logo seul » : la couleur du bandeau n\'est pas utilisée, son erreur ne bloque rien et rien de faux n\'est écrit', () => {
  const form = { ...formulaireInitial(MAYER), entete: 'logo', couleurBandeau: 'orange' };
  assert.deepEqual(erreursFormulaire(form), {});
  assert.equal(patchAEnregistrer(form, MAYER).secondary_color, '#1e3a8a');
  assert.equal(patchAEnregistrer(form, {}).secondary_color, null);
  assert.equal(reglagesApresEnregistrement(MAYER, form).secondary_color, '#1e3a8a');
  // Avec bandeau, l'erreur reste.
  assert.ok(erreursFormulaire({ ...form, entete: 'logo_bandeau' }).couleurBandeau);
});

test('ancien habillage sans emplacement du texte : traité partout comme « pas d\'ancien habillage »', () => {
  const r = { email_skeleton_html: '<p>sans emplacement</p>' };
  assert.deepEqual(formulaireInitial(r), formulaireInitial({}));
  assert.equal(situationHabillage(r).ancien, false);
  assert.equal(libelleEnregistrer(r), 'Enregistrer');
});

test('couleurs : comparées sans tenir compte des majuscules, écrites en minuscules', () => {
  const r = { ...MAYER, accent_color: '#1E4D8C', email_habillage: { entete: 'logo', pied: {} } };
  const init = formulaireInitial(r);
  assert.equal(estModifie({ ...init, couleurBoutons: '#1e4d8c' }, init), false);
  assert.equal(patchAEnregistrer({ ...init, phrase: 'x' }, r).accent_color, '#1e4d8c');
});

test('aperçu : « Voir l\'habillage actuel » montre les réglages en base, sinon ceux après enregistrement', () => {
  const form = { ...formulaireInitial(MAYER), couleurBoutons: '#000000' };
  assert.equal(reglagesDeLApercu(MAYER, form, true), MAYER);
  assert.equal(reglagesDeLApercu(MAYER, form, false).accent_color, '#000000');
  // Hors ancien habillage, la bascule n'a pas de sens : réglages après enregistrement.
  const r = { ...MAYER, email_habillage: { entete: 'logo', pied: {} } };
  assert.equal(reglagesDeLApercu(r, form, true).accent_color, '#000000');
});

test('ligne du logo : absent, non sûr, ou rien à dire', () => {
  assert.equal(ligneLogo({}), 'absent');
  assert.equal(ligneLogo({ logo_url: 'http://x/l.png' }), 'non_sur');
  assert.equal(ligneLogo({ logo_url: 'https://x/l.png' }), null);
});

// ── Habillage enrichi (spec 2026-11-22 § 3) ─────────────────────────────────────
import {
  suggestionsFormulaire, blocVide, ajouterBloc, retirerBloc, monterBloc, modifierBloc, peutAjouterBloc,
  BLOCS_MAX, USAGES_APERCU, OU_BLOC, couleurBandeauUtilisee,
} from '../src/lib/mailHabillageEcran.js';
import { lireHabillage } from '../src/lib/mailHabillage.js';

const ENRICHI = {
  entete: 'logo_bandeau',
  logo: { position: 'centre', taille: 'grand' },
  bouton_bandeau: { libelle: 'Prendre RDV', adresse: 'https://ex.fr/rdv' },
  pied: { coordonnees: true, certifications: false, site: false, horaires: 'Lun–ven', texte: 'Ligne', fond: 'bandeau',
    reseaux: { facebook: 'https://fb.com/x', instagram: '', avis_google: '', linkedin: '' } },
  blocs: [{ titre: 'Parrainez un proche', texte: 'Un mois offert', bouton: { libelle: 'Je parraine', adresse: 'https://ex.fr/p' }, ou: 'tous' }],
};

test('formulaire initial d’un habillage enrichi : tout est repris ; enregistré tel quel, rien ne change', () => {
  const r = { ...MAYER, email_habillage: ENRICHI };
  const init = formulaireInitial(r);
  assert.deepEqual(init.logo, ENRICHI.logo);
  assert.deepEqual(init.boutonBandeau, ENRICHI.bouton_bandeau);
  assert.deepEqual(init.pied, ENRICHI.pied);
  assert.deepEqual(init.blocs, ENRICHI.blocs);
  assert.equal(peutEnregistrer(init, init, r), false);
  assert.deepEqual(patchAEnregistrer({ ...init, phrase: 'Autre' }, r).email_habillage, ENRICHI);
  // Un bloc sans bouton s'ouvre avec un bouton vide, et s'enregistre sans bouton.
  const sansBouton = { ...MAYER, email_habillage: { ...ENRICHI, blocs: [{ titre: 'T', texte: '', bouton: null, ou: 'campagnes' }] } };
  const f = formulaireInitial(sansBouton);
  assert.deepEqual(f.blocs[0].bouton, { libelle: '', adresse: '' });
  assert.equal(patchAEnregistrer({ ...f, phrase: 'x' }, sansBouton).email_habillage.blocs[0].bouton, null);
});

test('habillage enregistré AVANT les nouvelles options, ouvert puis rien touché : « Enregistrer » fermé', () => {
  const r = { ...MAYER, email_habillage: { entete: 'logo_bandeau', pied: { coordonnees: true, certifications: true, site: false } } };
  const init = formulaireInitial(r);
  assert.equal(peutEnregistrer(init, init, r), false);
  assert.equal(raisonFermeture(init, init, r), 'Aucune modification.');
  // Enregistré après un changement : les nouvelles clés valent leurs défauts — même HTML qu'avant.
  const patch = patchAEnregistrer({ ...init, phrase: 'Chauffage' }, r);
  assert.equal(habillerMail({ ...r, ...patch }, 'x', { usage: 'campagne' }), habillerMail(r, 'x', { usage: 'campagne' }));
});

test('adresses : refusées avec leur raison, suggestion pour un domaine nu, vide accepté', () => {
  const base = formulaireInitial({});
  const f = { ...base, pied: { ...base.pied, reseaux: { ...base.pied.reseaux, facebook: 'facebook.com/mayer', instagram: 'javascript:alert(1)' } } };
  const e = erreursFormulaire(f);
  assert.ok(e['reseaux.facebook'] && e['reseaux.instagram']);
  assert.equal(e['reseaux.linkedin'], undefined);
  assert.equal(suggestionsFormulaire(f)['reseaux.facebook'], 'https://facebook.com/mayer');
  assert.equal(suggestionsFormulaire(f)['reseaux.instagram'], undefined);
  assert.throws(() => patchAEnregistrer(f));
  assert.equal(peutEnregistrer(f, base, {}), false);
  assert.equal(raisonFermeture(f, base, {}), 'Corrigez les champs signalés avant d’enregistrer.');
  // Le lien pour se désabonner ne se pose pas une seconde fois.
  const des = { ...base, pied: { ...base.pied, reseaux: { ...base.pied.reseaux, facebook: 'mailto:a@b.fr?subject=Désabonnement' } } };
  assert.match(erreursFormulaire(des)['reseaux.facebook'], /désabonner/);
  for (const ok of ['https://fb.com/x', 'http://x.fr', 'mailto:a@b.fr', 'tel:0563000000']) {
    assert.deepEqual(erreursFormulaire({ ...base, pied: { ...base.pied, reseaux: { ...base.pied.reseaux, linkedin: ok } } }), {}, ok);
  }
});

test('bouton : texte ET adresse, ou ni l’un ni l’autre ; longueurs', () => {
  const base = { ...formulaireInitial({}), entete: 'logo_bandeau', phrase: 'P' };
  assert.deepEqual(erreursFormulaire(base), {});
  assert.match(erreursFormulaire({ ...base, boutonBandeau: { libelle: 'RDV', adresse: '' } }).boutonBandeau, /adresse/);
  assert.match(erreursFormulaire({ ...base, boutonBandeau: { libelle: '', adresse: 'https://x.fr' } }).boutonBandeau, /texte/);
  assert.ok(erreursFormulaire({ ...base, boutonBandeau: { libelle: 'x'.repeat(41), adresse: 'https://x.fr' } }).boutonBandeau);
  assert.equal(suggestionsFormulaire({ ...base, boutonBandeau: { libelle: 'RDV', adresse: 'mayer.fr' } }).boutonBandeau, 'https://mayer.fr');
  const bloc = { ...blocVide(), titre: 'T', bouton: { libelle: 'Go', adresse: 'pas une adresse' } };
  assert.ok(erreursFormulaire({ ...base, blocs: [bloc] })['bloc.0.bouton']);
  assert.ok(erreursFormulaire({ ...base, blocs: [{ ...blocVide(), titre: 'x'.repeat(81) }] })['bloc.0.titre']);
  assert.ok(erreursFormulaire({ ...base, blocs: [{ ...blocVide(), texte: 'x'.repeat(301) }] })['bloc.0.texte']);
  assert.ok(erreursFormulaire({ ...base, pied: { ...base.pied, horaires: 'x'.repeat(201) } })['pied.horaires']);
  assert.ok(erreursFormulaire({ ...base, pied: { ...base.pied, texte: 'x'.repeat(301) } })['pied.texte']);
});

test('couleur du bandeau : sert aussi au pied de page sur sa couleur, alors elle se vérifie', () => {
  const f = { ...formulaireInitial({}), entete: 'logo', couleurBandeau: 'orange' };
  assert.equal(couleurBandeauUtilisee(f), false);
  assert.deepEqual(erreursFormulaire(f), {});
  const surBandeau = { ...f, pied: { ...f.pied, fond: 'bandeau' } };
  assert.equal(couleurBandeauUtilisee(surBandeau), true);
  assert.ok(erreursFormulaire(surBandeau).couleurBandeau);
});

test('« Logo seul » : le bouton du bandeau ne sert pas, son erreur ne bloque rien, l’enregistré est gardé', () => {
  const r = { ...MAYER, email_habillage: ENRICHI };
  const f = { ...formulaireInitial(r), entete: 'logo', boutonBandeau: { libelle: 'RDV', adresse: '' } };
  assert.deepEqual(erreursFormulaire(f), {});
  assert.deepEqual(patchAEnregistrer(f, r).email_habillage.bouton_bandeau, ENRICHI.bouton_bandeau);
  assert.equal(patchAEnregistrer(f, {}).email_habillage.bouton_bandeau, null);
});

test('blocs : ajouter (deux au plus), retirer, monter, modifier ; un bloc vide ne compte pas', () => {
  let f = formulaireInitial({});
  assert.equal(peutAjouterBloc(f), true);
  f = ajouterBloc(f);
  assert.equal(estModifie(f, formulaireInitial({})), false, 'bloc vide = rien à enregistrer');
  f = modifierBloc(f, 0, { titre: 'A' });
  f = ajouterBloc(f);
  f = modifierBloc(f, 1, { titre: 'B', ou: 'tous', bouton: { libelle: 'Go', adresse: 'https://x.fr' } });
  assert.equal(f.blocs.length, BLOCS_MAX);
  assert.equal(peutAjouterBloc(f), false);
  assert.equal(ajouterBloc(f).blocs.length, BLOCS_MAX);
  f = monterBloc(f, 1);
  assert.deepEqual(f.blocs.map((b) => b.titre), ['B', 'A']);
  assert.equal(monterBloc(f, 0), f);
  const patch = patchAEnregistrer(f);
  assert.deepEqual(patch.email_habillage.blocs, [
    { titre: 'B', texte: '', bouton: { libelle: 'Go', adresse: 'https://x.fr' }, ou: 'tous' },
    { titre: 'A', texte: '', bouton: null, ou: 'campagnes' },
  ]);
  assert.deepEqual(lireHabillage({ email_habillage: patch.email_habillage }).blocs, patch.email_habillage.blocs);
  f = retirerBloc(f, 0);
  assert.deepEqual(f.blocs.map((b) => b.titre), ['A']);
  assert.equal(blocVide().ou, 'campagnes');
});

test('aperçu : une adresse invalide en cours de saisie ne dessine aucun lien', () => {
  const base = { ...formulaireInitial({}), entete: 'logo_bandeau', phrase: 'P' };
  const f = { ...base, boutonBandeau: { libelle: 'RDV', adresse: 'javascript:alert(1)' } };
  const html = habillerMail(reglagesApresEnregistrement({}, f), 'x');
  assert.ok(!/javascript:/i.test(html) && !html.includes('RDV'));
});

test('choix de l’aperçu et du bloc : libellés en français, défaut en premier', () => {
  assert.deepEqual(USAGES_APERCU.map((u) => u.cle), ['campagne', 'individuel']);
  assert.deepEqual(OU_BLOC.map((o) => o.cle), ['campagnes', 'tous']);
  for (const o of [...USAGES_APERCU, ...OU_BLOC]) assert.ok(!/html|cta|template|\{/i.test(o.libelle), o.libelle);
});

// ── Reprise 1 ───────────────────────────────────────────────────────────────────
import { lisibiliteBandeau } from '../src/lib/mailHabillageEcran.js';

test('couleur du bandeau : lisibilité du texte blanc, suggestion plus foncée', () => {
  const jaune = lisibiliteBandeau('#ffff00');
  assert.equal(jaune.lisible, false);
  assert.match(jaune.suggestion, /^#[0-9a-f]{6}$/);
  assert.ok(contraste(jaune.suggestion, '#ffffff') >= 4.5);
  assert.equal(lisibiliteBandeau('#1e3a8a').lisible, true);
  assert.equal(lisibiliteBandeau('').couleur, DEFAUTS_MARQUE.bandeau);
  assert.equal(lisibiliteBandeau('orange').couleur, DEFAUTS_MARQUE.bandeau);
});

test('téléphone saisi naturellement : suggestion sans espaces', () => {
  const base = formulaireInitial({});
  const avecTel = (v) => ({ ...base, pied: { ...base.pied, reseaux: { ...base.pied.reseaux, facebook: v } } });
  const f = avecTel('tel:+33 6 12 34 56 78');
  assert.ok(erreursFormulaire(f)['reseaux.facebook']);
  assert.equal(suggestionsFormulaire(f)['reseaux.facebook'], 'tel:+33612345678');
  assert.equal(suggestionsFormulaire(avecTel('06 12 34 56 78'))['reseaux.facebook'], 'tel:0612345678');
  // Points et tirets sont des séparateurs admis dans un lien téléphone : acceptés tels quels.
  assert.deepEqual(erreursFormulaire(avecTel('tel:06.12.34.56.78')), {});
  // La suggestion est elle-même acceptée.
  assert.deepEqual(erreursFormulaire(avecTel('tel:+33612345678')), {});
  const bouton = { ...base, entete: 'logo_bandeau', phrase: 'P', boutonBandeau: { libelle: 'Appeler', adresse: 'tel:05 63 00 00 00' } };
  assert.equal(suggestionsFormulaire(bouton).boutonBandeau, 'tel:0563000000');
});
