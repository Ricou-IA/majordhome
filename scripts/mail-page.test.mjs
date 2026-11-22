import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cartesDuMail, cleDepuisLibelle, cleDeCopie, libelleDeCopie, nomVerrouille, etatDuNom,
  formulaireDepuisCampagne, champsAEnregistrer, estModifie, raisonsEnregistrement, raisonsDeBlocage,
  raisonsRedaction, demandeRedaction, appliquerRedaction, refaireAvecNouvelEditeur, revenirALAncien,
  rappelObjet, avertissementsTexte, ligneExpediteur, ligneEnvoi, etatEnregistrement, corpsVide,
  LIMITES_REDACTION, champsDeCopie, objetsSuggeres, sansElementsDe, miseEnFormeSimplifiee, cleReservee,
} from '../src/lib/mailPage.js';
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

test('raisonsDeBlocage : segment absent pour lancer et automatiser, pas pour tester', () => {
  assert.ok(raisonsDeBlocage({ ...PRET, segmentId: null }, 'lancer').length > 0);
  assert.ok(raisonsDeBlocage({ ...PRET, segmentId: null }, 'automatiser').length > 0);
  assert.deepEqual(raisonsDeBlocage({ ...PRET, segmentId: null }, 'tester'), []);
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

test('ligneEnvoi : renvoi provisoire vers l’onglet Envoi pour les campagnes, Réglages pour les autres', () => {
  const admin = { isOrgAdmin: true };
  assert.match(ligneEnvoi('manuelle', cartesDuMail('manuelle', admin)).texte, /onglet Envoi/);
  const auto = ligneEnvoi('automatique', cartesDuMail('automatique', admin)).texte;
  // L'envoi automatique continue tel que réglé ; archiver l'arrête (mail_campaigns_due écarte les archivées).
  assert.match(auto, /continue/);
  assert.match(auto, /archiv/i);
  assert.equal(ligneEnvoi('sequence', cartesDuMail('sequence', admin)).lien.vers, '/settings/communication');
  assert.equal(ligneEnvoi('auto_registre', cartesDuMail('auto_registre', admin)).lien.vers, '/settings/communication');
  assert.equal(ligneEnvoi('boutique', cartesDuMail('boutique', admin)), null);
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
