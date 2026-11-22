import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cartesDuMail, cleDepuisLibelle, cleDeCopie, libelleDeCopie, nomVerrouille, etatDuNom,
  formulaireDepuisCampagne, champsAEnregistrer, estModifie, raisonsEnregistrement, raisonsDeBlocage,
  raisonsRedaction, demandeRedaction, appliquerRedaction, refaireAvecNouvelEditeur, revenirALAncien,
  rappelObjet, avertissementsTexte, ligneExpediteur, etatEnregistrement, corpsVide,
  LIMITES_REDACTION, champsDeCopie, objetsSuggeres, sansElementsDe, miseEnFormeSimplifiee, cleReservee,
  segmentsRanges, etatSegment, segmentSurLaCampagne, modesEnvoi, raisonsAutomatisation, cadenceEnMots,
  prochainEnvoiEnMots, basculerAutomatisation, texteConfirmationLancement, peutOuvrirMail, raisonsEnvoiPage,
  dejaServis, metEnRoute, texteConfirmationActivation, raisonsReglageAutomatique, raisonsSauvegardePage,
  cleEnvoi, etatEnvoiCampagne, reglageAutomatiqueModifie, texteConfirmationReglage, phraseNombreInconnu,
  messageErreurEnvoi, formulaireApresEnregistrement, ENVOIS_PAR_PASSAGE, heureDeReprise, avertissementsObjet,
  objetSansFormuleInconnue,
} from '../src/lib/mailPage.js';
import { texteParDefaut } from '../src/lib/mailVariables.js';
import { EMAILS_AUTOMATIQUES } from '../src/lib/emailsAutomatiques.js';
import { SEQUENCES_EMAILS } from '../src/lib/sequencesEmails.js';
import { WEBSHOP_EMAIL_KEYS } from '../src/lib/webshop/emailTemplates.js';

const MANUELLE = {
  id: 'c1', key: 'promo_automne', label: 'Promo automne', subject: 'Votre poêle avant l’hiver',
  html_body: '<p>{{SALUTATION}}</p><p>Bonjour.</p>', blocks: { brief: 'Promo poêle' },
  is_automated: false, is_transactional: false, auto_segment_id: null, auto_cadence_days: null,
  auto_time_of_day: '09:00', next_run_at: null, tracking_type_value: 'promo_automne',
  purpose: 'Vendre', audience: 'Clients', tone: 'Chaleureux', notes: 'Rien',
};

// ── Cartes ────────────────────────────────────────────────────────────────────

test('cartesDuMail : la table de la conception § 5.4 (administrateur)', () => {
  const a = { isOrgAdmin: true };
  assert.deepEqual(cartesDuMail('manuelle', a), { destinataires: 'oui', message: 'oui', envoi: 'complet' });
  assert.deepEqual(cartesDuMail('automatique', a), { destinataires: 'oui', message: 'oui', envoi: 'complet' });
  assert.deepEqual(cartesDuMail('sequence', a), { destinataires: 'lecture', message: 'oui', envoi: 'lecture' });
  assert.deepEqual(cartesDuMail('auto_registre', a), { destinataires: 'non', message: 'oui', envoi: 'essai' });
  assert.deepEqual(cartesDuMail('boutique', a), { destinataires: 'non', message: 'oui', envoi: 'non' });
});

test('cartesDuMail : un autre rôle lit le message et n’a que les campagnes manuelles en envoi', () => {
  const r = { isOrgAdmin: false };
  assert.deepEqual(cartesDuMail('manuelle', r), { destinataires: 'oui', message: 'lecture', envoi: 'complet' });
  assert.deepEqual(cartesDuMail('automatique', r), { destinataires: 'lecture', message: 'lecture', envoi: 'lecture' });
  assert.deepEqual(cartesDuMail('sequence', r), { destinataires: 'lecture', message: 'lecture', envoi: 'lecture' });
  assert.deepEqual(cartesDuMail('auto_registre', r), { destinataires: 'non', message: 'lecture', envoi: 'non' });
  assert.deepEqual(cartesDuMail('boutique', r), { destinataires: 'non', message: 'lecture', envoi: 'non' });
});

test('cartesDuMail : nature inconnue = campagne manuelle ; options absentes = pas administrateur', () => {
  assert.deepEqual(cartesDuMail('autre'), cartesDuMail('manuelle', { isOrgAdmin: false }));
});

// ── Clés et noms ──────────────────────────────────────────────────────────────

test('cleDepuisLibelle : règle de slugifyKey', () => {
  assert.equal(cleDepuisLibelle('Promo Été 2026 !'), 'promo_ete_2026');
  assert.equal(cleDepuisLibelle('  '), 'campagne');
  assert.equal(cleDepuisLibelle(null), 'campagne');
  assert.equal(cleDepuisLibelle('a'.repeat(80)).length, 50);
});

test('cleDeCopie : jamais une clé existante, 50 caractères au plus', () => {
  assert.equal(cleDeCopie('promo', []), 'promo_copie');
  assert.equal(cleDeCopie('promo', ['promo_copie']), 'promo_copie_2');
  assert.equal(cleDeCopie('promo', ['promo_copie', 'promo_copie_2']), 'promo_copie_3');
  const longue = cleDeCopie('x'.repeat(50), []);
  assert.ok(longue.length <= 50);
  assert.ok(longue.endsWith('_copie'));
});

test('libelleDeCopie : jamais un nom existant (le journal des envois est tenu par le nom)', () => {
  assert.equal(libelleDeCopie('Promo', []), 'Promo (copie)');
  assert.equal(libelleDeCopie('Promo', ['Promo (copie)']), 'Promo (copie 2)');
  assert.equal(libelleDeCopie('Promo', ['promo (COPIE)']), 'Promo (copie 2)');
});

test('nomVerrouille : journal inconnu ⇒ verrouillé, aucun envoi ⇒ libre', () => {
  assert.equal(nomVerrouille(undefined), true);
  assert.equal(nomVerrouille(null), true);
  assert.equal(nomVerrouille(0), false);
  assert.equal(nomVerrouille(3), true);
});

test('etatDuNom : nouveau libre ; envoyé ou inconnu fixé avec la raison ; e-mails de l’application fixés', () => {
  assert.deepEqual(etatDuNom({ nature: 'manuelle', nouveau: true, nbEnvois: undefined }), { modifiable: true, raison: null });
  assert.deepEqual(etatDuNom({ nature: 'manuelle', nouveau: false, nbEnvois: 0 }), { modifiable: true, raison: null });
  const envoye = etatDuNom({ nature: 'automatique', nouveau: false, nbEnvois: 12 });
  assert.equal(envoye.modifiable, false);
  assert.match(envoye.raison, /déjà été envoyé/);
  const inconnu = etatDuNom({ nature: 'manuelle', nouveau: false, nbEnvois: undefined, journalEnEchec: true });
  assert.equal(inconnu.modifiable, false);
  assert.ok(inconnu.raison);
  assert.deepEqual(etatDuNom({ nature: 'manuelle', nouveau: false, nbEnvois: 0, lectureSeule: true }), { modifiable: false, raison: null });
  for (const nature of ['sequence', 'auto_registre', 'boutique']) {
    const e = etatDuNom({ nature, nouveau: false, nbEnvois: 0 });
    assert.equal(e.modifiable, false, nature);
    assert.ok(e.raison, nature);
  }
});

// ── Enregistrement ────────────────────────────────────────────────────────────

test('formulaireDepuisCampagne : un mail neuf est une campagne manuelle vide', () => {
  const f = formulaireDepuisCampagne(null);
  assert.equal(f.label, '');
  assert.equal(f.subject, '');
  assert.equal(f.html_body, '');
  assert.deepEqual(f.blocks, {});
  assert.equal(f.is_automated, false);
});

test('champsAEnregistrer : rien de changé ⇒ rien à envoyer', () => {
  const f = formulaireDepuisCampagne(MANUELLE);
  assert.deepEqual(champsAEnregistrer(f, formulaireDepuisCampagne(MANUELLE)), {});
  assert.equal(estModifie(f, formulaireDepuisCampagne(MANUELLE)), false);
});

test('champsAEnregistrer : seulement les champs changés, jamais purpose / audience / tone / notes', () => {
  const initial = formulaireDepuisCampagne(MANUELLE);
  const f = { ...initial, subject: 'Nouvel objet', blocks: { ...initial.blocks, brief: 'Autre chose' }, purpose: 'X', audience: 'Y', tone: 'Z', notes: 'N' };
  const p = champsAEnregistrer(f, initial);
  assert.deepEqual(Object.keys(p).sort(), ['blocks', 'subject']);
  assert.deepEqual(p.blocks, { brief: 'Autre chose' });
  for (const k of ['purpose', 'audience', 'tone', 'notes', 'key', 'tracking_type_value', 'id']) assert.ok(!(k in p), k);
});

test('champsAEnregistrer : un texte retapé à l’identique (aux blancs près) n’est pas un changement', () => {
  const initial = formulaireDepuisCampagne({ ...MANUELLE, html_body: '<p>{{SALUTATION}}</p>\n<p>Bonjour.</p>' });
  const f = { ...initial, html_body: '<p>{{SALUTATION}}</p><p>Bonjour.</p>' };
  assert.deepEqual(champsAEnregistrer(f, initial), {});
});

test('champsAEnregistrer : un ancien format comparé tel quel', () => {
  const page = '<!DOCTYPE html><html><body><table><tr><td>Old</td></tr></table></body></html>';
  const initial = formulaireDepuisCampagne({ ...MANUELLE, html_body: page });
  assert.deepEqual(champsAEnregistrer({ ...initial }, initial), {});
  assert.deepEqual(Object.keys(champsAEnregistrer({ ...initial, html_body: '<p>Neuf</p>' }, initial)), ['html_body']);
});

test('champsAEnregistrer : création ⇒ clé et marqueur de suivi dérivés du nom, champs de la page', () => {
  const f = { ...formulaireDepuisCampagne(null), label: ' Promo Été ', subject: 'Objet', html_body: '<p>Texte</p>', purpose: 'X' };
  const p = champsAEnregistrer(f, null);
  assert.equal(p.key, 'promo_ete');
  assert.equal(p.tracking_type_value, 'promo_ete');
  assert.equal(p.label, 'Promo Été');
  assert.equal(p.subject, 'Objet');
  assert.equal(p.html_body, '<p>Texte</p>');
  assert.equal(p.is_automated, false);
  for (const k of ['purpose', 'audience', 'tone', 'notes']) assert.ok(!(k in p), k);
});

test('champsAEnregistrer : le nom et l’objet sont enregistrés sans blancs autour', () => {
  const initial = formulaireDepuisCampagne(MANUELLE);
  const p = champsAEnregistrer({ ...initial, label: ' Promo hiver ', subject: ' Objet ' }, initial);
  assert.deepEqual(p, { label: 'Promo hiver', subject: 'Objet' });
});

test('estModifie : une intention écrite puis effacée n’est pas une modification', () => {
  const initial = formulaireDepuisCampagne({ ...MANUELLE, blocks: null });
  assert.equal(estModifie({ ...initial, blocks: { brief: '' } }, initial), false);
  assert.equal(estModifie({ ...formulaireDepuisCampagne(null), blocks: { brief: '' } }, null), false);
});

test('estModifie : un nouveau mail est modifié dès qu’on y écrit', () => {
  const vide = formulaireDepuisCampagne(null);
  assert.equal(estModifie(vide, null), false);
  assert.equal(estModifie({ ...vide, label: 'A' }, null), true);
});

test('raisonsEnregistrement : nom requis, nom ou clé déjà pris refusés, envoi automatique sans objet ni texte refusé', () => {
  const autres = [{ id: 'z', key: 'promo_ete', label: 'Promo été' }];
  const vide = formulaireDepuisCampagne(null);
  assert.ok(raisonsEnregistrement({ form: vide, nature: 'manuelle', nouveau: true, campagnes: [] }).length > 0);
  // Brouillon manuel incomplet : autorisé (il ne part qu'à la main).
  assert.deepEqual(raisonsEnregistrement({ form: { ...vide, label: 'Neuf' }, nature: 'manuelle', nouveau: true, campagnes: [] }), []);
  const doublonNom = raisonsEnregistrement({ form: { ...vide, label: 'PROMO ÉTÉ ' }, nature: 'manuelle', nouveau: true, campagnes: autres });
  assert.ok(doublonNom.length > 0);
  const doublonCle = raisonsEnregistrement({ form: { ...vide, label: 'Promo, été !' }, nature: 'manuelle', nouveau: true, campagnes: autres });
  assert.ok(doublonCle.length > 0);
  // Le mail lui-même ne compte pas comme doublon.
  assert.deepEqual(raisonsEnregistrement({ form: formulaireDepuisCampagne({ ...MANUELLE, id: 'z', label: 'Promo été' }), nature: 'manuelle', nouveau: false, campagnes: autres, id: 'z' }), []);
  // Un mail qui part tout seul doit avoir un objet et un texte.
  const sansObjet = { ...formulaireDepuisCampagne(MANUELLE), subject: ' ' };
  assert.ok(raisonsEnregistrement({ form: sansObjet, nature: 'sequence', nouveau: false, campagnes: [], id: 'c1' }).length > 0);
  const sansTexte = { ...formulaireDepuisCampagne(MANUELLE), html_body: '<p>{{SALUTATION}}</p>' };
  assert.ok(raisonsEnregistrement({ form: sansTexte, nature: 'auto_registre', nouveau: false, campagnes: [], id: 'c1' }).length > 0);
  assert.ok(raisonsEnregistrement({ form: { ...sansTexte, is_automated: true }, nature: 'automatique', nouveau: false, campagnes: [], id: 'c1' }).length > 0);
});

// ── Gestes d'envoi ───────────────────────────────────────────────────────────

const PRET = { objet: 'Objet', corps: '<p>Bonjour</p>', variablesInconnues: [], segmentId: 's1', nombre: 12, refusExpediteur: null, envoiEnCours: false };

test('raisonsDeBlocage : tout est prêt ⇒ aucun motif', () => {
  for (const g of ['tester', 'lancer', 'automatiser']) assert.deepEqual(raisonsDeBlocage(PRET, g), [], g);
});

test('raisonsDeBlocage : objet vide, texte vide (variables seules comprises)', () => {
  for (const g of ['tester', 'lancer', 'automatiser']) {
    assert.ok(raisonsDeBlocage({ ...PRET, objet: '  ' }, g).some((r) => /objet/i.test(r)), g);
    assert.ok(raisonsDeBlocage({ ...PRET, corps: '' }, g).some((r) => /texte/i.test(r)), g);
    assert.ok(raisonsDeBlocage({ ...PRET, corps: '<p>{{SALUTATION}}</p>' }, g).some((r) => /texte/i.test(r)), g);
  }
});

test('raisonsDeBlocage : variable inconnue nommée sans accolades', () => {
  const r = raisonsDeBlocage({ ...PRET, variablesInconnues: ['{{PRENOM}}'] }, 'lancer');
  assert.ok(r.some((m) => m.includes('PRENOM')));
  assert.ok(r.every((m) => !m.includes('{')));
});

test('raisonsDeBlocage : segment absent ferme aussi « Tester » (l’essai d’une campagne passe par son segment)', () => {
  assert.ok(raisonsDeBlocage({ ...PRET, segmentId: null }, 'lancer').length > 0);
  assert.ok(raisonsDeBlocage({ ...PRET, segmentId: null }, 'automatiser').length > 0);
  assert.ok(raisonsDeBlocage({ ...PRET, segmentId: null }, 'tester').length > 0);
});

test('raisonsDeBlocage : adresse d’essai requise et lisible quand elle est fournie', () => {
  assert.ok(raisonsDeBlocage({ ...PRET, adresseTest: '' }, 'tester').some((m) => /adresse/i.test(m)));
  assert.ok(raisonsDeBlocage({ ...PRET, adresseTest: 'pas une adresse' }, 'tester').some((m) => /adresse/i.test(m)));
  assert.deepEqual(raisonsDeBlocage({ ...PRET, adresseTest: ' moi@exemple.fr ' }, 'tester'), []);
  // L'adresse d'essai ne concerne que l'essai.
  assert.deepEqual(raisonsDeBlocage({ ...PRET, adresseTest: '' }, 'lancer'), []);
});

test('raisonsDeBlocage : nombre inconnu ou nul ferme « Lancer »', () => {
  assert.ok(raisonsDeBlocage({ ...PRET, nombre: undefined }, 'lancer').length > 0);
  assert.ok(raisonsDeBlocage({ ...PRET, nombre: 0 }, 'lancer').length > 0);
  assert.deepEqual(raisonsDeBlocage({ ...PRET, nombre: undefined }, 'tester'), []);
});

test('raisonsDeBlocage : refus d’expéditeur et envoi en cours (double clic)', () => {
  assert.ok(raisonsDeBlocage({ ...PRET, refusExpediteur: 'domaine_requis' }, 'lancer').some((m) => /domaine/.test(m)));
  assert.ok(raisonsDeBlocage({ ...PRET, refusExpediteur: 'no_from_email' }, 'tester').length > 0);
  for (const g of ['tester', 'lancer', 'automatiser']) assert.ok(raisonsDeBlocage({ ...PRET, envoiEnCours: true }, g).length > 0, g);
});

test('raisonsDeBlocage : geste inconnu ⇒ fermé', () => {
  assert.ok(raisonsDeBlocage(PRET, 'autre').length > 0);
});

// ── Rédaction assistée ───────────────────────────────────────────────────────

test('raisonsRedaction : rédiger demande une intention, retravailler demande un texte', () => {
  assert.ok(raisonsRedaction({ consigne: 'rediger', intention: ' ', corps: '' }).length > 0);
  assert.deepEqual(raisonsRedaction({ consigne: 'rediger', intention: 'Promo', corps: '' }), []);
  for (const c of ['court', 'chaleureux', 'reformuler', 'objets']) {
    assert.ok(raisonsRedaction({ consigne: c, intention: '', corps: '<p>{{SALUTATION}}</p>' }).length > 0, c);
    assert.deepEqual(raisonsRedaction({ consigne: c, intention: '', corps: '<p>Bonjour</p>' }), [], c);
  }
});

test('raisonsRedaction : longueurs bornées comme le serveur, rédaction en cours', () => {
  assert.equal(LIMITES_REDACTION.corps, 12000);
  assert.equal(LIMITES_REDACTION.intention, 2000);
  assert.equal(LIMITES_REDACTION.objet, 300);
  assert.ok(raisonsRedaction({ consigne: 'rediger', intention: 'a'.repeat(2001), corps: '' }).length > 0);
  assert.ok(raisonsRedaction({ consigne: 'court', intention: '', corps: `<p>${'a'.repeat(12001)}</p>` }).length > 0);
  assert.ok(raisonsRedaction({ consigne: 'court', intention: '', objet: 'o'.repeat(301), corps: '<p>a</p>' }).length > 0);
  assert.ok(raisonsRedaction({ consigne: 'rediger', intention: 'Promo', corps: '', enCours: true }).length > 0);
  assert.ok(raisonsRedaction({ consigne: 'inconnue', intention: 'x', corps: '<p>a</p>' }).length > 0);
});

test('demandeRedaction : les NOMS des variables proposées, la nature du mail, rien d’autre', () => {
  const d = demandeRedaction({ consigne: 'rediger', form: formulaireDepuisCampagne(MANUELLE), campagne: MANUELLE });
  assert.deepEqual(Object.keys(d).sort(), ['consigne', 'corps', 'intention', 'nature', 'objet', 'variables']);
  assert.equal(d.nature, 'manuelle');
  assert.equal(d.intention, 'Promo poêle');
  assert.ok(d.variables.includes('{{SALUTATION}}'));
  assert.ok(d.variables.every((v) => typeof v === 'string'));
});

test('appliquerRedaction : texte normalisé, styles reposés ; inutilisable ⇒ null', () => {
  const r = appliquerRedaction({ objet: 'Objet', objets: ['A', 'B'], corps: '<p>Bonjour</p><p><a data-bouton href="{{ORG_WEBSITE_URL}}">Voir</a></p>' });
  assert.equal(r.objet, 'Objet');
  assert.deepEqual(r.objets, ['A', 'B']);
  assert.match(r.corps, /data-bouton/);
  assert.match(r.corps, /style=/);
  // Mails habillés par le site : pas de bouton.
  const s = appliquerRedaction({ objet: '', objets: [], corps: '<p><a data-bouton href="{{ORG_WEBSITE_URL}}">Voir</a></p>' }, { sansElements: true });
  assert.doesNotMatch(s.corps, /data-bouton/);
  assert.equal(appliquerRedaction(null), null);
  assert.equal(appliquerRedaction({ objet: 'x', objets: [], corps: '<table><tr><td>x</td></tr></table>' }), null);
  assert.equal(appliquerRedaction({ objet: 'x', objets: [], corps: '' }), null);
});

// ── Ancien format ────────────────────────────────────────────────────────────

test('refaireAvecNouvelEditeur garde l’ancien texte, revenirALAncien le rend', () => {
  const page = '<!DOCTYPE html><html><body><table><tr><td>Old</td></tr></table></body></html>';
  const c = { html_body: page, blocks: { brief: 'B' } };
  const neuf = refaireAvecNouvelEditeur(c, { html_body: '<p>Défaut</p>' });
  assert.equal(neuf.html_body, '<p>Défaut</p>');
  assert.equal(neuf.blocks.ancien_html, page);
  assert.equal(neuf.blocks.brief, 'B');
  const vide = refaireAvecNouvelEditeur(c, null);
  assert.equal(vide.html_body, '');
  const retour = revenirALAncien({ html_body: '<p>x</p>', blocks: neuf.blocks });
  assert.equal(retour.html_body, page);
  assert.ok(!('ancien_html' in retour.blocks));
  assert.equal(retour.blocks.brief, 'B');
  assert.equal(revenirALAncien({ html_body: '<p>x</p>', blocks: { brief: 'B' } }), null);
  assert.equal(revenirALAncien({ html_body: '<p>x</p>', blocks: null }), null);
});

test('refaireAvecNouvelEditeur : un second passage ne remplace pas l’ancien texte gardé', () => {
  const c = { html_body: '<html><body>B</body></html>', blocks: { ancien_html: '<html><body>A</body></html>' } };
  assert.equal(refaireAvecNouvelEditeur(c, null).blocks.ancien_html, '<html><body>A</body></html>');
});

// ── Petits messages ──────────────────────────────────────────────────────────

test('rappelObjet : rien jusqu’à 50 caractères, un rappel au-delà', () => {
  assert.equal(rappelObjet('a'.repeat(50)), null);
  assert.ok(rappelObjet('a'.repeat(51)));
  assert.equal(rappelObjet(''), null);
});

test('avertissementsTexte : variable inconnue par son nom brut entre guillemets, sans accolades', () => {
  const a = avertissementsTexte(MANUELLE, '<p>{{SALUTATION}} {{PRENOM}}</p>');
  assert.equal(a.manquantes, null);
  assert.equal(a.inconnues.length, 1);
  assert.match(a.inconnues[0], /« PRENOM »/);
  assert.match(a.inconnues[0], /tel quel/);
  assert.ok(!a.inconnues[0].includes('{'));
});

test('avertissementsTexte : information du texte par défaut retirée', () => {
  const a = avertissementsTexte({ key: 'pv_reception' }, '<p>Rien</p>');
  assert.ok(a.manquantes);
  assert.match(a.manquantes, /n’affiche plus/);
});

test('ligneExpediteur : envoi en nombre sans domaine vérifié ⇒ refus, individuel ⇒ adresse commune', () => {
  const sans = { brand_name: 'Cimaj', from_email: 'contact@cimaj.fr' };
  const n = ligneExpediteur(sans, 'manuelle');
  assert.equal(n.refus, 'domaine_requis');
  assert.ok(n.texte);
  const i = ligneExpediteur(sans, 'auto_registre');
  assert.equal(i.refus, null);
  assert.match(i.texte, /Cimaj/);
  assert.equal(ligneExpediteur({}, 'manuelle').refus, 'no_from_email');
  const ok = ligneExpediteur({ brand_name: 'Mayer', from_email: 'a@mayer.fr', resend: { status: 'verified', domain: 'mayer.fr' } }, 'manuelle');
  assert.equal(ok.refus, null);
  assert.match(ok.texte, /a@mayer\.fr/);
});

test('etatEnregistrement : nouveau, modifié, enregistré, en cours', () => {
  assert.equal(etatEnregistrement({ nouveau: false, modifie: false, enCours: false }), 'Enregistré');
  assert.equal(etatEnregistrement({ nouveau: false, modifie: true, enCours: false }), 'Modifications non enregistrées');
  assert.equal(etatEnregistrement({ nouveau: true, modifie: false, enCours: false }), 'Pas encore enregistré');
  assert.equal(etatEnregistrement({ nouveau: false, modifie: true, enCours: true }), 'Enregistrement…');
});

test('corpsVide : variables et blancs seuls = vide', () => {
  assert.equal(corpsVide(''), true);
  assert.equal(corpsVide('<p>{{SALUTATION}}</p><p> </p>'), true);
  assert.equal(corpsVide('<p>{{SALUTATION}} Merci</p>'), false);
});

// ── Fix round 1 ──────────────────────────────────────────────────────────────

const AUTOMATIQUE = {
  ...MANUELLE, id: 'a1', key: 'relance_hiver', label: 'Relance hiver', is_automated: true, auto_segment_id: 's1',
  auto_cadence_days: 7, auto_cadence_minutes: null, next_run_at: '2026-11-01T09:00:00Z', last_run_at: '2026-10-25T09:00:00Z',
  is_archived: false, created_at: 'x', updated_at: 'y', created_by: 'u', org_id: 'o', preheader: 'P',
};

test('champsDeCopie : une copie n’envoie jamais toute seule (automatique, séquence, e-mail du registre)', () => {
  const sources = [
    AUTOMATIQUE,
    { ...AUTOMATIQUE, key: SEQUENCES_EMAILS[0].gabarit.key },
    { ...AUTOMATIQUE, key: EMAILS_AUTOMATIQUES[0].gabarit.key, is_automated: false, is_transactional: true },
  ];
  for (const c of sources) {
    const copie = champsDeCopie(c, 'nouvelle_cle', 'Nouveau nom');
    assert.equal(copie.is_automated, false, c.key);
    assert.equal(copie.is_transactional, false, c.key);
    assert.equal(copie.next_run_at, null, c.key);
    assert.equal(copie.last_run_at, null, c.key);
    assert.equal(copie.is_archived, false, c.key);
    assert.equal(copie.auto_cadence_days, null, c.key);
    assert.equal(copie.auto_cadence_minutes, null, c.key);
    assert.equal(copie.key, 'nouvelle_cle');
    assert.equal(copie.label, 'Nouveau nom');
    assert.equal(copie.tracking_type_value, 'nouvelle_cle');
    for (const k of ['id', 'created_at', 'updated_at', 'created_by', 'org_id']) assert.ok(!(k in copie), k);
  }
});

test('champsDeCopie : contenu et segment suivent, seules les colonnes de la table sont écrites', () => {
  const copie = champsDeCopie({ ...AUTOMATIQUE, colonne_de_vue: 'calculée' }, 'k', 'L');
  assert.equal(copie.subject, AUTOMATIQUE.subject);
  assert.equal(copie.html_body, AUTOMATIQUE.html_body);
  assert.equal(copie.preheader, 'P');
  assert.equal(copie.auto_segment_id, 's1');
  assert.deepEqual(copie.blocks, { brief: 'Promo poêle' });
  assert.ok(!('colonne_de_vue' in copie));
});

test('raisonsEnregistrement : un mail existant dont seul l’objet change s’enregistre malgré un homonyme', () => {
  const initial = formulaireDepuisCampagne({ ...MANUELLE, label: 'Promo (copie)' });
  const form = { ...initial, subject: 'Autre objet' };
  const autres = [{ id: 'zz', key: 'promo_copie_2', label: 'Promo (copie)' }];
  assert.deepEqual(raisonsEnregistrement({ form, initial, nature: 'manuelle', nouveau: false, campagnes: autres, id: 'c1' }), []);
  // Renommer vers un nom pris reste refusé.
  const renomme = { ...formulaireDepuisCampagne(MANUELLE), label: 'Promo (copie)' };
  assert.ok(raisonsEnregistrement({ form: renomme, initial: formulaireDepuisCampagne(MANUELLE), nature: 'manuelle', nouveau: false, campagnes: autres, id: 'c1' }).length > 0);
});

test('cleReservee / raisonsEnregistrement : un nom qui donnerait la clé d’un e-mail de l’application est refusé', () => {
  for (const cle of [EMAILS_AUTOMATIQUES[0].gabarit.key, SEQUENCES_EMAILS[0].gabarit.key, WEBSHOP_EMAIL_KEYS[0]]) {
    assert.equal(cleReservee(cle), true, cle);
    const label = cle.replace(/_/g, ' ');
    const r = raisonsEnregistrement({ form: { ...formulaireDepuisCampagne(null), label }, initial: null, nature: 'manuelle', nouveau: true, campagnes: [] });
    assert.ok(r.some((m) => /réservé/.test(m)), cle);
  }
  assert.equal(cleReservee('promo_automne'), false);
});

test('etatDuNom : pendant le comptage, nom fixé sans phrase ; la phrase seulement après un échec', () => {
  assert.deepEqual(etatDuNom({ nature: 'manuelle', nouveau: false, nbEnvois: undefined }), { modifiable: false, raison: null });
  const echec = etatDuNom({ nature: 'manuelle', nouveau: false, nbEnvois: undefined, journalEnEchec: true });
  assert.equal(echec.modifiable, false);
  assert.match(echec.raison, /Impossible de vérifier/);
});

test('objetsSuggeres : texte non vide seulement, rognés, trois au plus', () => {
  assert.deepEqual(objetsSuggeres({ objets: [' A ', '', 3, 'B', 'C', 'D'] }), ['A', 'B', 'C']);
  assert.deepEqual(objetsSuggeres(null), []);
  assert.deepEqual(objetsSuggeres({ objets: 'x' }), []);
});

test('sansElementsDe : vrai quand aucun titre, bouton ni encadré n’est permis', () => {
  assert.equal(sansElementsDe({ titre: false, bouton: false, encadre: false }), true);
  assert.equal(sansElementsDe({ titre: true, bouton: true, encadre: true }), false);
  assert.equal(sansElementsDe({ titre: false, bouton: true, encadre: false }), false);
});

test('miseEnFormeSimplifiee : texte simple ou déjà au format ⇒ faux ; couleur ou alignement ⇒ vrai', () => {
  assert.equal(miseEnFormeSimplifiee('<p>{{SALUTATION}}</p>\n<p>Bonjour <strong>toi</strong>,<br>merci.</p>'), false);
  assert.equal(miseEnFormeSimplifiee('<p>A &amp; B l&#39;été&nbsp;x</p>'), false);
  assert.equal(miseEnFormeSimplifiee(''), false);
  // Texte tel que l'éditeur l'enregistre, attributs et déclarations dans un autre ordre : rien à simplifier.
  assert.equal(miseEnFormeSimplifiee('<h2 style="color:#0f172a; margin:24px 0 8px;font-size:18px;line-height:1.3">T</h2>'
    + '<p style="margin:28px 0;text-align:center"><a style="background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600" href="https://a.fr" data-bouton>B</a></p>'), false);
  assert.equal(miseEnFormeSimplifiee('<p style="color:red">Rouge</p>'), true);
  assert.equal(miseEnFormeSimplifiee('<p style="text-align:center">Centré</p>'), true);
  // Un ancien format (non éditable) part tel quel : pas concerné.
  assert.equal(miseEnFormeSimplifiee('<!DOCTYPE html><html><body><table><tr><td>x</td></tr></table></body></html>'), false);
});

// ── Fix round 2 : mise en forme ───────────────────────────────────────────────

test('miseEnFormeSimplifiee : un texte par défaut intact n’est pas « simplifié » (le marqueur de bouton ne compte pas)', () => {
  for (const key of ['proposition_contrat', 'auto_rdv', 'pv_reception', 'pv_levee_reserves']) {
    const defaut = texteParDefaut({ key });
    assert.ok(defaut?.html_body, key);
    assert.equal(miseEnFormeSimplifiee(defaut.html_body), false, key);
  }
  assert.equal(miseEnFormeSimplifiee('<p style="color:red">Rouge</p>'), true);
});

// ── Destinataires et envoi ───────────────────────────────────────────────────

const SEGMENTS = [
  { id: 's1', name: 'Clients poêle', audience: 'clients', is_archived: false, filters: { a: 1 } },
  { id: 's2', name: 'Prospects chauds', audience: 'leads', is_archived: false, filters: { b: 1 } },
  { id: 's3', name: 'Ancien', audience: 'clients', is_archived: true, filters: {} },
];

test('segmentsRanges : Clients / Prospects, sans les archivés', () => {
  const r = segmentsRanges(SEGMENTS);
  assert.deepEqual(r.clients.map((s) => s.id), ['s1']);
  assert.deepEqual(r.prospects.map((s) => s.id), ['s2']);
});

test('etatSegment : aucun, liste inconnue, introuvable, archivé, prêt', () => {
  assert.equal(etatSegment(null, SEGMENTS, { chargee: true }).etat, 'aucun');
  assert.equal(etatSegment('s1', [], { chargee: false }).etat, 'inconnu');
  const perdu = etatSegment('zz', SEGMENTS, { chargee: true });
  assert.equal(perdu.etat, 'introuvable');
  assert.ok(perdu.raison);
  const archive = etatSegment('s3', SEGMENTS, { chargee: true });
  assert.equal(archive.etat, 'archive');
  assert.match(archive.raison, /archivé/);
  const ok = etatSegment('s1', SEGMENTS, { chargee: true });
  assert.equal(ok.etat, 'ok');
  assert.equal(ok.segment.name, 'Clients poêle');
  assert.equal(ok.raison, null);
});

test('segmentSurLaCampagne : seul le choix d’un administrateur devient le segment de la campagne', () => {
  assert.equal(segmentSurLaCampagne({ isOrgAdmin: true, cartes: cartesDuMail('manuelle', { isOrgAdmin: true }) }), true);
  assert.equal(segmentSurLaCampagne({ isOrgAdmin: false, cartes: cartesDuMail('manuelle', { isOrgAdmin: false }) }), false);
  assert.equal(segmentSurLaCampagne({ isOrgAdmin: true, cartes: cartesDuMail('sequence', { isOrgAdmin: true }) }), false);
});

test('modesEnvoi : administrateur une fois / automatiquement, autre rôle une fois, lecture et essai sans mode', () => {
  const a = { isOrgAdmin: true };
  const r = { isOrgAdmin: false };
  assert.deepEqual(modesEnvoi({ cartes: cartesDuMail('manuelle', a), isOrgAdmin: true }), ['une_fois', 'automatique']);
  assert.deepEqual(modesEnvoi({ cartes: cartesDuMail('automatique', a), isOrgAdmin: true }), ['une_fois', 'automatique']);
  assert.deepEqual(modesEnvoi({ cartes: cartesDuMail('manuelle', r), isOrgAdmin: false }), ['une_fois']);
  assert.deepEqual(modesEnvoi({ cartes: cartesDuMail('sequence', a), isOrgAdmin: true }), []);
  assert.deepEqual(modesEnvoi({ cartes: cartesDuMail('auto_registre', a), isOrgAdmin: true }), []);
});

const PRET_AUTO = { ...PRET, cadenceJours: 7, cadenceMinutes: null, heure: '09:00' };

test('raisonsAutomatisation : reprend les gestes d’envoi, exige une cadence et une heure', () => {
  assert.deepEqual(raisonsAutomatisation(PRET_AUTO), []);
  assert.ok(raisonsAutomatisation({ ...PRET_AUTO, cadenceJours: null }).some((m) => /jours/.test(m)));
  assert.ok(raisonsAutomatisation({ ...PRET_AUTO, cadenceJours: 0 }).length > 0);
  assert.ok(raisonsAutomatisation({ ...PRET_AUTO, cadenceJours: 2.5 }).length > 0);
  assert.ok(raisonsAutomatisation({ ...PRET_AUTO, heure: '' }).length > 0);
  // Une cadence en minutes déjà enregistrée suffit.
  assert.deepEqual(raisonsAutomatisation({ ...PRET_AUTO, cadenceJours: null, cadenceMinutes: 10 }), []);
  assert.ok(raisonsAutomatisation({ ...PRET_AUTO, segmentId: null }).length > 0);
  assert.ok(raisonsAutomatisation({ ...PRET_AUTO, refusExpediteur: 'domaine_requis' }).length > 0);
  // Le nombre n'est pas exigé : il change d'un passage à l'autre.
  assert.deepEqual(raisonsAutomatisation({ ...PRET_AUTO, nombre: undefined }), []);
});

test('cadenceEnMots : jours, semaine, minutes conservées, rien', () => {
  assert.equal(cadenceEnMots({ auto_cadence_days: 1, auto_time_of_day: '08:30:00' }), 'tous les jours à 8 h 30');
  assert.equal(cadenceEnMots({ auto_cadence_days: 7, auto_time_of_day: '09:00' }), 'toutes les semaines à 9 h');
  assert.equal(cadenceEnMots({ auto_cadence_days: 3, auto_time_of_day: null }), 'tous les 3 jours à 9 h');
  assert.equal(cadenceEnMots({ auto_cadence_minutes: 10, auto_cadence_days: 7 }), 'toutes les 10 minutes');
  assert.equal(cadenceEnMots({ auto_cadence_minutes: 60 }), 'toutes les heures');
  assert.equal(cadenceEnMots({}), null);
});

test('prochainEnvoiEnMots : arrêté, au prochain passage, à une date', () => {
  const maintenant = new Date('2026-11-22T10:00:00Z');
  assert.match(prochainEnvoiEnMots({ is_automated: false }, { maintenant }), /ne part pas/);
  assert.match(prochainEnvoiEnMots({ is_automated: true, next_run_at: null }, { maintenant }), /10 minutes/);
  assert.match(prochainEnvoiEnMots({ is_automated: true, next_run_at: '2026-11-22T09:00:00Z' }, { maintenant }), /10 minutes/);
  const futur = prochainEnvoiEnMots({ is_automated: true, next_run_at: '2026-11-29T08:00:00Z' }, { maintenant });
  assert.match(futur, /29 novembre/);
  assert.match(prochainEnvoiEnMots({ is_automated: true, next_run_at: null }, { maintenant, nonEnregistre: true }), /enregistr/);
});

test('basculerAutomatisation : allumer part au prochain passage, éteindre ne touche à rien d’autre', () => {
  const initial = formulaireDepuisCampagne(MANUELLE);
  const maintenant = new Date('2026-11-22T10:00:00Z');
  const on = basculerAutomatisation(initial, initial, true, maintenant);
  assert.equal(on.is_automated, true);
  assert.equal(on.next_run_at, maintenant.toISOString());
  assert.equal(on.auto_cadence_days, 7);
  const off = basculerAutomatisation(on, initial, false, maintenant);
  assert.equal(off.is_automated, false);
  assert.deepEqual(champsAEnregistrer(off, initial), { auto_cadence_days: 7 });
  // Une campagne déjà automatique rallumée garde sa date prévue.
  const auto = formulaireDepuisCampagne({ ...MANUELLE, is_automated: true, auto_cadence_days: 3, next_run_at: '2026-12-01T09:00:00Z' });
  const eteinte = basculerAutomatisation(auto, auto, false, maintenant);
  const rallumee = basculerAutomatisation(eteinte, auto, true, maintenant);
  assert.equal(rallumee.next_run_at, '2026-12-01T09:00:00Z');
  assert.equal(rallumee.auto_cadence_days, 3);
  assert.deepEqual(champsAEnregistrer(eteinte, auto), { is_automated: false });
  // Une cadence en minutes : pas de cadence en jours ajoutée, la page ne convertit rien.
  const minutes = formulaireDepuisCampagne({ ...MANUELLE, auto_cadence_minutes: 10 });
  assert.equal(basculerAutomatisation(minutes, minutes, true, maintenant).auto_cadence_days, null);
});

test('texteConfirmationLancement : segment, nombre, nom, et la promesse « pas deux fois »', () => {
  const t = texteConfirmationLancement({ segmentNom: 'Clients poêle', nombre: 1234, nomCampagne: 'Promo automne' });
  assert.match(t, /Clients poêle/);
  assert.match(t, /1\s234/);
  assert.match(t, /Promo automne/);
  assert.match(t, /déjà reçu/);
  assert.equal(texteConfirmationLancement({ segmentNom: 'X', nombre: undefined, nomCampagne: 'Y' }), null);
  assert.equal(texteConfirmationLancement({ segmentNom: 'X', nombre: 0, nomCampagne: 'Y' }), null);
});

test('metEnRoute / texteConfirmationActivation : seul l’allumage d’une campagne éteinte est confirmé', () => {
  const eteinte = formulaireDepuisCampagne(MANUELLE);
  const allumee = { ...eteinte, is_automated: true };
  assert.equal(metEnRoute(allumee, eteinte), true);
  assert.equal(metEnRoute(allumee, allumee), false);
  assert.equal(metEnRoute(eteinte, eteinte), false);
  assert.equal(metEnRoute(allumee, null), true);
  const t = texteConfirmationActivation({ segmentNom: 'Clients poêle', nombre: 40, cadence: 'toutes les semaines à 9 h' });
  assert.match(t, /10 minutes/);
  assert.match(t, /40 destinataires/);
  assert.match(t, /toutes les semaines/);
  assert.match(texteConfirmationActivation({ segmentNom: 'X', nombre: undefined, cadence: null }), /groupe « X »/);
});

test('raisonsReglageAutomatique : allumer ou changer la cadence exige un réglage complet ; retoucher le texte non', () => {
  const eteinte = formulaireDepuisCampagne(MANUELLE);
  const pret = { ...PRET_AUTO, envoiEnCours: true };
  assert.deepEqual(raisonsReglageAutomatique({ form: eteinte, initial: eteinte, etat: { ...pret, segmentId: null } }), []);
  const allumee = { ...eteinte, is_automated: true, auto_cadence_days: 7 };
  assert.deepEqual(raisonsReglageAutomatique({ form: allumee, initial: eteinte, etat: pret }), []);
  assert.ok(raisonsReglageAutomatique({ form: allumee, initial: eteinte, etat: { ...pret, segmentId: null } }).length > 0);
  const auto = formulaireDepuisCampagne({ ...MANUELLE, is_automated: true, auto_cadence_days: 7, auto_segment_id: 's1' });
  // Texte seul retouché : rien n'est exigé (domaine absent compris).
  assert.deepEqual(raisonsReglageAutomatique({ form: { ...auto, subject: 'Autre' }, initial: auto, etat: { ...pret, refusExpediteur: 'domaine_requis' } }), []);
  assert.ok(raisonsReglageAutomatique({ form: { ...auto, auto_cadence_days: 0 }, initial: auto, etat: { ...pret, cadenceJours: 0 } }).length > 0);
});

test('dejaServis : écart entre la taille du segment et le nombre pour cette campagne, 0 si inconnu', () => {
  assert.equal(dejaServis(100, 80), 20);
  assert.equal(dejaServis(undefined, 80), 0);
  assert.equal(dejaServis(100, undefined), 0);
  assert.equal(dejaServis(50, 80), 0);
});

test('peutOuvrirMail : administrateur tout ; autre rôle seulement une campagne manuelle non archivée', () => {
  assert.equal(peutOuvrirMail({ campagne: null, nouveau: true, isOrgAdmin: true }), true);
  assert.equal(peutOuvrirMail({ campagne: null, nouveau: true, isOrgAdmin: false }), false);
  assert.equal(peutOuvrirMail({ campagne: MANUELLE, nouveau: false, isOrgAdmin: false }), true);
  assert.equal(peutOuvrirMail({ campagne: { ...MANUELLE, is_archived: true }, nouveau: false, isOrgAdmin: false }), false);
  assert.equal(peutOuvrirMail({ campagne: { ...MANUELLE, is_automated: true }, nouveau: false, isOrgAdmin: false }), false);
  assert.equal(peutOuvrirMail({ campagne: { ...MANUELLE, is_transactional: true }, nouveau: false, isOrgAdmin: false }), false);
  assert.equal(peutOuvrirMail({ campagne: { ...MANUELLE, key: SEQUENCES_EMAILS[0].gabarit.key }, nouveau: false, isOrgAdmin: false }), false);
  assert.equal(peutOuvrirMail({ campagne: { ...MANUELLE, is_automated: true }, nouveau: false, isOrgAdmin: true }), true);
});

test('raisonsEnvoiPage : mail archivé, segment perdu, mail impossible à enregistrer ferment l’envoi', () => {
  const base = { geste: 'lancer', etat: PRET, archive: false, segment: { etat: 'ok', raison: null }, raisonsEnregistrement: [], modifie: false };
  assert.deepEqual(raisonsEnvoiPage(base), []);
  assert.ok(raisonsEnvoiPage({ ...base, archive: true }).some((m) => /archivé/.test(m)));
  assert.ok(raisonsEnvoiPage({ ...base, segment: { etat: 'archive', raison: 'Ce groupe de destinataires est archivé.' } }).some((m) => /archivé/.test(m)));
  assert.ok(raisonsEnvoiPage({ ...base, segment: { etat: 'inconnu', raison: null } }).length > 0);
  // Un mail modifié s'enregistre avant l'envoi : s'il ne peut pas l'être, l'envoi est fermé avec la raison.
  const r = raisonsEnvoiPage({ ...base, modifie: true, raisonsEnregistrement: ['Donnez un nom à ce mail.'] });
  assert.ok(r.some((m) => /nom/.test(m)));
  assert.deepEqual(raisonsEnvoiPage({ ...base, modifie: false, raisonsEnregistrement: ['Donnez un nom à ce mail.'] }), []);
  // Sans doublon de phrase.
  const doublon = raisonsEnvoiPage({ ...base, etat: { ...PRET, segmentId: null }, segment: { etat: 'aucun', raison: null } });
  assert.equal(new Set(doublon).size, doublon.length);
  // Une mise en route automatique non enregistrée ferme essai et envoi (l'enregistrement se confirme à part).
  assert.ok(raisonsEnvoiPage({ ...base, geste: 'tester', miseEnRoute: true }).some((m) => /mise en route/.test(m)));
  assert.ok(!raisonsEnvoiPage({ ...base, geste: 'automatiser', etat: PRET_AUTO, miseEnRoute: true }).some((m) => /mise en route/.test(m)));
  // L'automatisation passe par raisonsAutomatisation.
  assert.ok(raisonsEnvoiPage({ ...base, geste: 'automatiser', etat: { ...PRET_AUTO, cadenceJours: null } }).some((m) => /jours/.test(m)));
});

test('raisonsSauvegardePage : un envoi en cours ferme « Enregistrer », sans doublon', () => {
  assert.deepEqual(raisonsSauvegardePage({ envoiEnCours: false, raisonsEnregistrement: [], raisonsReglage: [] }), []);
  assert.ok(raisonsSauvegardePage({ envoiEnCours: true, raisonsEnregistrement: [], raisonsReglage: [] })[0].includes('envoi est en cours'));
  assert.deepEqual(raisonsSauvegardePage({ envoiEnCours: false, raisonsEnregistrement: ['A'], raisonsReglage: ['A', 'B'] }), ['A', 'B']);
});

// ── Fix round 1 de la tâche 10 ───────────────────────────────────────────────

test('cleEnvoi : organisation + nom au caractère près ; incomplet ⇒ vide', () => {
  assert.equal(cleEnvoi('o1', 'Promo '), 'o1:Promo ');
  assert.equal(cleEnvoi('', 'Promo'), '');
  assert.equal(cleEnvoi('o1', ''), '');
  assert.notEqual(cleEnvoi('o1', 'A'), cleEnvoi('o2', 'A'));
});

test('etatEnvoiCampagne : en cours ailleurs, à reprendre une fois fini, libre', () => {
  assert.equal(etatEnvoiCampagne({ occupe: true, vuOccupe: true, ici: false }), 'en_cours');
  assert.equal(etatEnvoiCampagne({ occupe: true, vuOccupe: true, ici: true }), 'ici');
  assert.equal(etatEnvoiCampagne({ occupe: false, vuOccupe: true, ici: false }), 'reprendre');
  assert.equal(etatEnvoiCampagne({ occupe: false, vuOccupe: false, ici: false }), 'libre');
});

test('raisonsEnvoiPage : un envoi de cette campagne en cours ailleurs ferme tester, lancer et automatiser', () => {
  const base = { etat: PRET, archive: false, segment: { etat: 'ok', raison: null }, raisonsEnregistrement: [], modifie: false };
  for (const geste of ['tester', 'lancer']) {
    assert.ok(raisonsEnvoiPage({ ...base, geste, envoiAilleurs: true }).some((m) => /en cours/.test(m)), geste);
  }
  assert.ok(raisonsEnvoiPage({ ...base, geste: 'automatiser', etat: PRET_AUTO, envoiAilleurs: true }).some((m) => /en cours/.test(m)));
});

test('raisonsEnvoiPage : une campagne automatique en base ne se lance pas à la main', () => {
  const base = { etat: PRET, archive: false, segment: { etat: 'ok', raison: null }, raisonsEnregistrement: [], modifie: false };
  const r = raisonsEnvoiPage({ ...base, geste: 'lancer', automatiqueEnBase: true });
  assert.ok(r.some((m) => /part déjà tout seul/.test(m) && /arrêtez/.test(m)));
  assert.deepEqual(raisonsEnvoiPage({ ...base, geste: 'tester', automatiqueEnBase: true }), []);
});

test('raisonsEnvoiPage : un réglage automatique modifié non enregistré ferme tester et lancer', () => {
  const base = { etat: PRET, archive: false, segment: { etat: 'ok', raison: null }, raisonsEnregistrement: [], modifie: true };
  for (const geste of ['tester', 'lancer']) {
    assert.ok(raisonsEnvoiPage({ ...base, geste, reglageAutoModifie: true }).some((m) => /Enregistrez d’abord les changements de l’envoi automatique/.test(m)), geste);
  }
});

test('reglageAutomatiqueModifie : segment, cadence, heure ou interrupteur d’une campagne automatique en base', () => {
  const auto = formulaireDepuisCampagne({ ...MANUELLE, is_automated: true, auto_cadence_days: 7, auto_segment_id: 's1' });
  assert.equal(reglageAutomatiqueModifie(auto, auto), false);
  assert.equal(reglageAutomatiqueModifie({ ...auto, subject: 'Autre' }, auto), false);
  assert.equal(reglageAutomatiqueModifie({ ...auto, auto_segment_id: 's2' }, auto), true);
  assert.equal(reglageAutomatiqueModifie({ ...auto, auto_cadence_days: 3 }, auto), true);
  assert.equal(reglageAutomatiqueModifie({ ...auto, auto_time_of_day: '10:00' }, auto), true);
  assert.equal(reglageAutomatiqueModifie({ ...auto, is_automated: false }, auto), true);
  // Campagne manuelle en base : ce n'est pas un réglage automatique (l'allumage a sa propre confirmation).
  const manuelle = formulaireDepuisCampagne(MANUELLE);
  assert.equal(reglageAutomatiqueModifie({ ...manuelle, auto_segment_id: 's2' }, manuelle), false);
  assert.equal(reglageAutomatiqueModifie(manuelle, null), false);
});

test('texteConfirmationReglage : arrêt ou changement de l’envoi automatique dit en clair', () => {
  assert.match(texteConfirmationReglage({ actif: false, segmentNom: 'X', cadence: null }), /ne partira plus/);
  const t = texteConfirmationReglage({ actif: true, segmentNom: 'Clients poêle', cadence: 'tous les 3 jours à 10 h' });
  assert.match(t, /Clients poêle/);
  assert.match(t, /tous les 3 jours/);
});

test('phraseNombreInconnu : sans nom, le nombre attend le nom ; sinon échec de calcul', () => {
  assert.match(phraseNombreInconnu({ nomCampagne: '' }), /nom/);
  assert.match(phraseNombreInconnu({ nomCampagne: 'Promo' }), /pas pu être calculé/);
});

test('messageErreurEnvoi : refus d’expéditeur traduit, sinon le message reçu', () => {
  assert.match(messageErreurEnvoi({ code: 'domaine_requis', message: 'x' }), /domaine/);
  assert.match(messageErreurEnvoi({ code: 'no_from_email', message: 'x' }), /adresse e-mail/);
  assert.equal(messageErreurEnvoi({ code: null, message: 'Panne' }), 'Panne');
  assert.equal(messageErreurEnvoi({ code: 'autre_chose', message: '' }), 'autre_chose');
  assert.ok(messageErreurEnvoi({}));
});

// ── Vague finale : page fidèle à ce qui est enregistré ───────────────────────

/** Ligne telle que la base la rend : heure en `time` (secondes). */
const LIGNE_BASE = { ...MANUELLE, auto_time_of_day: '09:00:00' };

test('formulaireDepuisCampagne : l’heure enregistrée « 09:00:00 » devient « 09:00 » (champ heure)', () => {
  assert.equal(formulaireDepuisCampagne(LIGNE_BASE).auto_time_of_day, '09:00');
  assert.equal(formulaireDepuisCampagne({ ...MANUELLE, auto_time_of_day: '8:30' }).auto_time_of_day, '08:30');
  assert.equal(formulaireDepuisCampagne({ ...MANUELLE, auto_time_of_day: null }).auto_time_of_day, '09:00');
});

test('champsAEnregistrer : « 09:00 » et « 09:00:00 » sont la même heure ; deux écritures du même instant aussi', () => {
  const f = formulaireDepuisCampagne(MANUELLE);
  assert.deepEqual(champsAEnregistrer({ ...f, auto_time_of_day: '09:00' }, { ...f, auto_time_of_day: '09:00:00' }), {});
  assert.deepEqual(
    champsAEnregistrer({ ...f, next_run_at: '2026-11-23T08:00:00.000Z' }, { ...f, next_run_at: '2026-11-23T08:00:00+00:00' }),
    {},
  );
  assert.deepEqual(Object.keys(champsAEnregistrer({ ...f, auto_time_of_day: '10:00' }, { ...f, auto_time_of_day: '09:00:00' })), ['auto_time_of_day']);
});

test('création → enregistré : plus rien à enregistrer', () => {
  const neuf = { ...formulaireDepuisCampagne(null), label: 'Promo hiver', subject: 'Objet', html_body: '<p>Bonjour</p>' };
  const ligne = { id: 'n1', ...champsAEnregistrer(neuf, null), auto_time_of_day: '09:00:00', next_run_at: null };
  const apres = formulaireApresEnregistrement(neuf, neuf, ligne);
  const initial = formulaireDepuisCampagne(ligne);
  assert.deepEqual(champsAEnregistrer(apres, initial), {});
  assert.equal(estModifie(apres, initial), false);
});

test('mise en route → enregistrée : plus rien à enregistrer, et un enregistrement suivant ne réécrit pas la date prévue', () => {
  const initial0 = formulaireDepuisCampagne(LIGNE_BASE);
  const on = basculerAutomatisation(initial0, initial0, true, new Date('2026-11-22T10:00:00Z'));
  assert.ok('next_run_at' in champsAEnregistrer(on, initial0));
  const ligne = { ...LIGNE_BASE, ...champsAEnregistrer(on, initial0), auto_time_of_day: '09:00:00', next_run_at: '2026-11-22T10:00:00+00:00' };
  const apres = formulaireApresEnregistrement(on, on, ligne);
  const initial = formulaireDepuisCampagne(ligne);
  assert.deepEqual(champsAEnregistrer(apres, initial), {});
  assert.equal(reglageAutomatiqueModifie(apres, initial), false);
  const plusTard = champsAEnregistrer({ ...apres, subject: 'Autre objet' }, initial);
  assert.deepEqual(Object.keys(plusTard), ['subject']);
});

test('heure d’un mail automatique changée → enregistrée : le réglage n’est plus « modifié »', () => {
  const auto = { ...LIGNE_BASE, is_automated: true, auto_cadence_days: 7, auto_segment_id: 's1', next_run_at: '2026-11-29T08:00:00+00:00' };
  const initial0 = formulaireDepuisCampagne(auto);
  const form = { ...initial0, auto_time_of_day: '10:00' };
  assert.equal(reglageAutomatiqueModifie(form, initial0), true);
  const ligne = { ...auto, auto_time_of_day: '10:00:00', next_run_at: '2026-11-29T09:00:00+00:00' };
  const apres = formulaireApresEnregistrement(form, form, ligne);
  const initial = formulaireDepuisCampagne(ligne);
  assert.equal(reglageAutomatiqueModifie(apres, initial), false);
  assert.deepEqual(champsAEnregistrer(apres, initial), {});
});

test('formulaireApresEnregistrement : une frappe faite pendant l’enregistrement reste à enregistrer', () => {
  const initial0 = formulaireDepuisCampagne(LIGNE_BASE);
  const envoye = { ...initial0, subject: 'Objet A' };
  const actuel = { ...envoye, subject: 'Objet AB' };
  const ligne = { ...LIGNE_BASE, subject: 'Objet A' };
  const apres = formulaireApresEnregistrement(actuel, envoye, ligne);
  assert.equal(apres.subject, 'Objet AB');
  assert.deepEqual(champsAEnregistrer(apres, formulaireDepuisCampagne(ligne)), { subject: 'Objet AB' });
});

// ── Vague finale : reprise prudente après une coupure ────────────────────────

test('etatEnvoiCampagne : coupure (attente avant reprise), puis reprise après coupure', () => {
  assert.equal(etatEnvoiCampagne({ occupe: true, vuOccupe: false, ici: false, repriseVers: 1000 }), 'coupure');
  assert.equal(etatEnvoiCampagne({ occupe: true, vuOccupe: true, ici: true, repriseVers: 1000 }), 'coupure');
  assert.equal(etatEnvoiCampagne({ occupe: false, vuOccupe: true, ici: false, coupureVue: true }), 'reprendre_apres_coupure');
  assert.equal(etatEnvoiCampagne({ occupe: false, vuOccupe: true, ici: false, coupureVue: false }), 'reprendre');
});

test('heureDeReprise : heure de Paris en mots, rien si inconnue', () => {
  assert.equal(heureDeReprise(Date.parse('2026-11-22T13:32:00Z')), '14 h 32');
  assert.equal(heureDeReprise(Date.parse('2026-07-01T07:05:00Z')), '9 h 05');
  assert.equal(heureDeReprise(null), null);
});

test('raisonsEnvoiPage : après une coupure, tester, lancer et automatiser restent fermés jusqu’à l’heure de reprise', () => {
  const base = { etat: PRET, archive: false, segment: { etat: 'ok', raison: null }, raisonsEnregistrement: [], modifie: false };
  for (const geste of ['tester', 'lancer']) {
    const r = raisonsEnvoiPage({ ...base, geste, coupure: '14 h 32' });
    assert.ok(r.some((m) => /coupée/.test(m) && /14 h 32/.test(m)), geste);
  }
  assert.ok(raisonsEnvoiPage({ ...base, geste: 'automatiser', etat: PRET_AUTO, coupure: '14 h 32' }).some((m) => /14 h 32/.test(m)));
});

// ── Vague finale : objet sans formule non remplacée ─────────────────────────

test('avertissementsObjet : ce qui arriverait tel quel dans l’objet, nommé sans accolades', () => {
  const a = avertissementsObjet(MANUELLE, '{{SALUTATION}} votre poêle {{CLIENT_NAME}}');
  assert.equal(a.length, 1);
  assert.match(a[0], /Formule de politesse/);
  assert.ok(!a[0].includes('{{'));
  assert.deepEqual(avertissementsObjet(MANUELLE, 'Votre poêle, {{CLIENT_NAME}}'), []);
});

test('raisonsDeBlocage : une formule que l’envoi ne remplace pas dans l’objet ferme les trois gestes', () => {
  for (const geste of ['tester', 'lancer', 'automatiser']) {
    const r = raisonsDeBlocage({ ...PRET, variablesInconnuesObjet: ['{{SALUTATION}}'] }, geste);
    assert.ok(r.some((m) => /objet/.test(m) && /tel quel/.test(m)), geste);
  }
  assert.deepEqual(raisonsDeBlocage({ ...PRET, variablesInconnuesObjet: [] }, 'lancer'), []);
});

test('objetSansFormuleInconnue / objetsSuggeres / appliquerRedaction : l’assistant ne propose jamais d’objet avec une formule non remplacée', () => {
  assert.equal(objetSansFormuleInconnue(MANUELLE, '{{SALUTATION}} votre poêle vous attend'), 'Votre poêle vous attend');
  assert.equal(objetSansFormuleInconnue(MANUELLE, '{{CLIENT_NAME}}, votre entretien'), '{{CLIENT_NAME}}, votre entretien');
  assert.equal(objetSansFormuleInconnue(MANUELLE, 'Offre {{lien_pellets}} !'), 'Offre !');
  assert.deepEqual(objetsSuggeres({ objets: ['{{SALUTATION}}', '{{SALUTATION}} Hiver au chaud', 'B'] }, MANUELLE), ['Hiver au chaud', 'B']);
  const r = appliquerRedaction({ objet: '{{SALUTATION}}', objets: ['{{SALUTATION}} A'], corps: '<p>Bonjour</p>' }, { campagne: MANUELLE });
  assert.equal(r.objet, '');
  assert.deepEqual(r.objets, ['A']);
});

// ── Vague finale : la mise en route dit la vérité sur le nombre par passage ──

test('texteConfirmationActivation : au-delà d’un passage, le premier envoi n’écrit qu’à ENVOIS_PAR_PASSAGE personnes', () => {
  assert.equal(ENVOIS_PAR_PASSAGE, 300);
  const t = texteConfirmationActivation({ segmentNom: 'Tous', nombre: 1200, cadence: 'toutes les semaines à 9 h' });
  assert.match(t, /300/);
  assert.match(t, /1\s200/);
  assert.match(t, /passages suivants/);
  assert.match(t, /toutes les semaines/);
  const court = texteConfirmationActivation({ segmentNom: 'Tous', nombre: 300, cadence: 'toutes les semaines à 9 h' });
  assert.ok(!/passages suivants/.test(court));
  assert.match(texteConfirmationActivation({ segmentNom: 'X', nombre: undefined, cadence: null }), /300/);
});
