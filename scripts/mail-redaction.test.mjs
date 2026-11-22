import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONSIGNES, REDACTION_CODES, messageErreurRedaction, adressesAutorisees, adressesDuTexte, validerDemande,
  construireConsigne, SCHEMA_REDACTION, lireReponse,
} from '../src/lib/mailRedaction.js';
import { variablesDe, normaliser } from '../src/lib/mailCorps.js';
import { SEQUENCES_EMAILS } from '../src/lib/sequencesEmails.js';

const ctx = { consigne: 'rediger', variables: ['{{SALUTATION}}'], adresses: ['https://ex.fr/contact'] };
const MARQUEUR = 'mailto:{{ORG_EMAIL}}?subject=Désabonnement';

test('réponse inutilisable : null', () => {
  for (const brut of [null, undefined, 42, [], '', 'pas du json', { objet: 'x' },
    { objet: 'x', objets: [], corps: '<!DOCTYPE html><html></html>' }, { objet: '', objets: [], corps: '' },
    { objet: 'x', objets: [], corps: '<p>a</p><table><tr><td>b</td></tr></table>' },
    { objet: 'x', objets: [], corps: '<p>a</p><img src="x.png">' },
    { objet: 'x', objets: [], corps: '<script>alert(1)</script><p>a</p>' },
    { objet: 'x', objets: [], corps: 12 }, { objet: 3, objets: [], corps: '<p>a</p>' },
    { objet: 'x', objets: 'a', corps: '<p>a</p>' }])
    assert.equal(lireReponse(brut, ctx), null, JSON.stringify(brut));
});

test('lien inventé ramené à du texte, lien du catalogue gardé', () => {
  const r = lireReponse({ objet: 'O', objets: ['a', 'b', 'c'], corps: '<p><a href="https://invente.fr">ici</a> <a href="https://ex.fr/contact">là</a></p>' }, ctx);
  assert.ok(!r.corps.includes('invente.fr') && r.corps.includes('ici') && r.corps.includes('https://ex.fr/contact'));
});

test('téléphone et courriel inventés : ramenés à du texte', () => {
  const r = lireReponse({ objet: 'O', objets: [], corps: '<p><a href="tel:0600000000">appelez</a> <a href="mailto:x@y.fr">écrivez</a></p>' }, ctx);
  assert.ok(!r.corps.includes('tel:') && !r.corps.includes('mailto:') && r.corps.includes('appelez') && r.corps.includes('écrivez'));
});

test('bouton inventé : devient un paragraphe, sans style de bouton', () => {
  const r = lireReponse({ objet: 'O', objets: [], corps: '<p style="text-align:center"><a data-bouton href="https://invente.fr">Cliquez</a></p>' }, ctx);
  assert.equal(r.corps, '<p>Cliquez</p>');
});

test('lien sur une variable offerte gardé, sur une variable non offerte ramené à du texte', () => {
  const c = { ...ctx, variables: ['{{SALUTATION}}', '{{LIEN}}'] };
  const r = lireReponse({ objet: 'O', objets: [], corps: '<p><a href="{{LIEN}}">a</a> <a href="{{AUTRE}}">b</a></p>' }, c);
  assert.ok(r.corps.includes('href="{{LIEN}}"') && !r.corps.includes('AUTRE') && r.corps.includes('b'));
});

test('variable non proposée retirée', () => {
  const r = lireReponse({ objet: 'O {{PRENOM}}', objets: ['x {{PRENOM}} y'], corps: '<p>{{SALUTATION}} {{PRENOM}}</p>' }, ctx);
  assert.deepEqual(variablesDe(r.corps), ['{{SALUTATION}}']);
  assert.equal(r.objet, 'O');
  assert.deepEqual(r.objets, ['x y']);
});

test('variable retirée : pas d\'espace doublé, pas de paragraphe vide, ponctuation recollée', () => {
  const r = lireReponse({ objet: 'O', objets: [], corps: '<p>Bonjour {{PRENOM}}, merci.</p><p>{{NOM}}</p><p>Fin {{X}} ici</p>' }, ctx);
  assert.equal(r.corps, '<p>Bonjour, merci.</p><p>Fin ici</p>');
});

test('corps fait seulement d\'une variable non offerte : null', () => {
  assert.equal(lireReponse({ objet: 'O', objets: [], corps: '<p>{{PRENOM}}</p>' }, ctx), null);
});

test('consigne objets : le texte en place n\'est pas rendu', () => {
  const o = { ...ctx, consigne: 'objets' };
  assert.equal(lireReponse({ objet: 'O', objets: ['a', 'b', 'c'], corps: '<p>x</p>' }, o).corps, '');
  assert.equal(lireReponse({ objet: '', objets: [], corps: '' }, o), null);
  assert.equal(lireReponse({ objet: '', objets: [' ', 7], corps: '' }, o), null);
});

test('objets : texte seul, une ligne, vides écartés, trois au plus', () => {
  const r = lireReponse({ objet: ' <b>Un\nobjet</b> ', objets: ['<i>a</i>', '', 5, 'b\n\nc', 'd', 'e'], corps: '<p>x</p>' }, ctx);
  assert.equal(r.objet, 'Un objet');
  assert.deepEqual(r.objets, ['a', 'b c', 'd']);
});

test('objet de 300 caractères gardé, sur une ligne', () => {
  const r = lireReponse({ objet: `${'mot '.repeat(75)}\nfin`, objets: [], corps: '<p>x</p>' }, ctx);
  assert.ok(r.objet.length > 250 && !r.objet.includes('\n'));
});

test('objet requis pour rediger, facultatif pour court / chaleureux / reformuler', () => {
  const brut = { objet: '', objets: [], corps: '<p>x</p>' };
  assert.equal(lireReponse(brut, ctx), null);
  for (const consigne of ['court', 'chaleureux', 'reformuler']) assert.equal(lireReponse(brut, { ...ctx, consigne }).objet, '');
});

test('JSON en chaîne, clôture Markdown, clés en trop', () => {
  const j = JSON.stringify({ objet: 'O', objets: [], corps: '<p>x</p>', autre: 1 });
  assert.equal(lireReponse(j, ctx).corps, '<p>x</p>');
  assert.equal(lireReponse(`\`\`\`json\n${j}\n\`\`\``, ctx).corps, '<p>x</p>');
  assert.equal(lireReponse(`\`\`\`\n${j}\n\`\`\`\n`, ctx).objet, 'O');
});

test('lireReponse ne lève jamais', () => {
  const piege = { get objet() { throw new Error('x'); }, objets: [], corps: '<p>a</p>' };
  assert.equal(lireReponse(piege, ctx), null);
  assert.equal(lireReponse({ objet: 'O', objets: [], corps: '<p>x</p>' }, undefined), null);
  assert.equal(lireReponse({ objet: 'O', objets: [], corps: '<p>x</p>' }, { consigne: 'zzz', variables: [], adresses: [] }), null);
});

test('adressesDuTexte : marqueur de désabonnement d\'une séquence', () => {
  const html = SEQUENCES_EMAILS[0].gabarit.html_body;
  assert.deepEqual(adressesDuTexte(html), [MARQUEUR]);
  assert.deepEqual(adressesDuTexte(''), []);
  assert.deepEqual(adressesDuTexte(null), []);
  assert.deepEqual(adressesDuTexte('<p><a href="https://a.fr/?x=1&amp;y=2">a</a> <a href="https://a.fr/?x=1&amp;y=2">b</a></p>'), ['https://a.fr/?x=1&y=2']);
});

test('reformuler : le pied de séquence survit si son adresse est listée, sinon devient du texte', () => {
  const pied = SEQUENCES_EMAILS[0].gabarit.html_body;
  const brut = { objet: '', objets: [], corps: `<p>Texte repris.</p>${pied}` };
  const base = { consigne: 'reformuler', variables: ['{{ORG_EMAIL}}'] };
  const garde = lireReponse(brut, { ...base, adresses: adressesDuTexte(pied) });
  assert.ok(garde.corps.includes(`href="${MARQUEUR}"`), garde.corps);
  const perdu = lireReponse(brut, { ...base, adresses: [] });
  assert.ok(!perdu.corps.includes('mailto:') && perdu.corps.includes('Ne plus recevoir nos e-mails'));
});

test('adresses autorisées : toutes les url du catalogue, récursivement, et le site', () => {
  const a = adressesAutorisees({
    website_url: 'https://cimaj.fr',
    mailing_resources: { avis: { url: 'https://g.page/r/x', category: 'avis' }, groupe: { sous: { url: 'https://ex.fr/contact' } }, vide: { url: null }, sans: { nom: 'x' } },
  });
  assert.deepEqual(a.sort(), ['https://cimaj.fr', 'https://ex.fr/contact', 'https://g.page/r/x']);
  assert.deepEqual(adressesAutorisees(null), []);
  assert.deepEqual(adressesAutorisees({}), []);
});

test('la consigne ne contient que ce qu\'on lui donne', () => {
  const { system, user } = construireConsigne({ consigne: 'rediger', intention: 'Promo ramonage', objet: '', corps: '', nature: 'manuelle', variables: ['{{SALUTATION}}'], entreprise: { nom: 'Cimaj', site: '' }, adresses: [] });
  assert.ok(user.includes('Promo ramonage') && system.includes('Cimaj') && system.includes('{{SALUTATION}}'));
  assert.ok(/vouvoi/i.test(system) && system.includes('50'));
});

test('construireConsigne : déterministe, cinq consignes distinctes, rien d\'autre que l\'entrée', () => {
  const base = { intention: 'x', objet: 'Sujet actuel', corps: '<p>Texte actuel</p>', nature: 'sequence', variables: ['{{SALUTATION}}'], entreprise: { nom: 'Cimaj', site: 'https://cimaj.fr' }, adresses: ['https://ex.fr/contact'], client: 'DUPONT Jean', telephone: '0601020304' };
  const users = CONSIGNES.map((consigne) => construireConsigne({ ...base, consigne }).user);
  assert.equal(new Set(users).size, 5);
  assert.deepEqual(construireConsigne({ ...base, consigne: 'court' }), construireConsigne({ ...base, consigne: 'court' }));
  for (const consigne of CONSIGNES) {
    const { system, user } = construireConsigne({ ...base, consigne });
    assert.ok(!system.includes('DUPONT') && !user.includes('DUPONT') && !user.includes('0601020304') && !system.includes('0601020304'));
    assert.ok(system.includes('https://cimaj.fr') && system.includes('https://ex.fr/contact'));
  }
  for (const consigne of ['court', 'chaleureux', 'reformuler']) {
    const { user } = construireConsigne({ ...base, consigne });
    assert.ok(user.includes('Texte actuel') && user.includes('Sujet actuel'));
    assert.ok(/liens et les variables/i.test(user));
  }
  assert.throws(() => construireConsigne({ ...base, consigne: 'zzz' }));
});

test('schéma sans type union ni null, trois champs requis', () => {
  assert.ok(!JSON.stringify(SCHEMA_REDACTION).includes('null'));
  assert.ok(!JSON.stringify(SCHEMA_REDACTION).includes('anyOf') && !JSON.stringify(SCHEMA_REDACTION).includes('oneOf'));
  assert.deepEqual([...SCHEMA_REDACTION.required].sort(), ['corps', 'objet', 'objets']);
  assert.equal(SCHEMA_REDACTION.additionalProperties, false);
  assert.equal(SCHEMA_REDACTION.properties.objets.items.type, 'string');
});

test('validerDemande', () => {
  assert.equal(validerDemande({ consigne: 'rediger', intention: ' ', corps: '' }), 'intention_requise');
  assert.equal(validerDemande({ consigne: 'court', intention: '', corps: '' }), 'texte_requis');
  assert.equal(validerDemande({ consigne: 'court', intention: '', corps: '<p> </p>' }), 'texte_requis');
  assert.equal(validerDemande({ consigne: 'x', intention: 'a', corps: '' }), 'consigne_inconnue');
  assert.equal(validerDemande({ consigne: 'rediger', intention: 'a', corps: '' }), null);
  assert.equal(validerDemande({ consigne: 'objets', intention: '', corps: '<p>a</p>' }), null);
});

test('messages d\'erreur lisibles', () => {
  for (const code of ['module_communication_inactif', 'consigne_inconnue', 'intention_requise', 'texte_requis', 'plafond_atteint', 'service_indisponible', 'reponse_illisible'])
    assert.ok(REDACTION_CODES[code] && !/html|json|modèle/i.test(REDACTION_CODES[code]), code);
  assert.ok(messageErreurRedaction('plafond_atteint').includes('demain'));
  assert.ok(messageErreurRedaction('inconnu').length > 10);
});

test('variables à espaces : la forme exacte d’une variable offerte est rétablie, tout le reste est retiré', () => {
  const r = lireReponse({ objet: 'A {{ SALUTATION }} {{ PRENOM }}', objets: ['b {{PRENOM }} c {{ prenom}}'], corps: '<p>{{ SALUTATION }} {{ PRENOM }} et {{PRENOM }} {{ nom }}.</p>' }, ctx);
  assert.equal(r.corps, '<p>{{SALUTATION}} et.</p>');
  assert.equal(r.objet, 'A {{SALUTATION}}');
  assert.deepEqual(r.objets, ['b c']);
  assert.equal(lireReponse({ objet: 'O', objets: [], corps: '<p>{{ PRENOM }}</p>' }, ctx), null);
});

test('texte actuel montré au modèle : sans style, et il revient à l’identique de normaliser', () => {
  const pied = SEQUENCES_EMAILS[0].gabarit.html_body;
  const original = `<h2>Titre</h2><p>Bonjour {{SALUTATION}}</p><p style="text-align:center"><a data-bouton href="https://ex.fr/contact">Nous écrire</a></p><div data-encadre>Un <strong>encadré</strong></div>${pied}`;
  const base = { consigne: 'reformuler', intention: '', objet: 'S', corps: original, nature: 'sequence', variables: ['{{SALUTATION}}', '{{ORG_EMAIL}}', '{{BRAND_NAME}}'], entreprise: { nom: 'C', site: '' }, adresses: ['https://ex.fr/contact'] };
  const { user } = construireConsigne(base);
  const marque = 'Texte actuel :\n';
  const vu = user.slice(user.indexOf(marque) + marque.length);
  assert.ok(!vu.includes('style=') && !vu.includes('ACCENT_COLOR') && vu.includes('data-bouton') && vu.includes('data-encadre'));
  const r = lireReponse({ objet: '', objets: [], corps: vu }, { consigne: 'reformuler', variables: base.variables, adresses: [...base.adresses, ...adressesDuTexte(original)] });
  assert.equal(r.corps, normaliser(original));
  assert.ok(r.corps.includes('data-bouton') && r.corps.includes('data-encadre') && r.corps.includes('<h2'));
});

test('construireConsigne sans argument : lève consigne_inconnue', () => {
  assert.throws(() => construireConsigne(), /consigne_inconnue/);
});

// ── Côté serveur (tâche 6) : l'edge, sa migration et le service ───────────────

const lire = (chemin) => readFileSync(new URL(`../${chemin}`, import.meta.url), 'utf8');
const EDGE = lire('supabase/functions/mailing-rediger/index.ts');
const MIGRATION = lire('supabase/migrations/20261122_4_mailing_redaction_quota.sql');

test('edge : tout code rendu est une clé de REDACTION_CODES, et les gardes attendues y sont', () => {
  const codes = [...EDGE.matchAll(/refus\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
  assert.ok(codes.length > 0);
  for (const c of codes) assert.ok(c in REDACTION_CODES, `code hors REDACTION_CODES : ${c}`);
  for (const c of ['module_communication_inactif', 'demande_trop_longue', 'plafond_atteint', 'service_indisponible', 'reponse_illisible'])
    assert.ok(codes.includes(c), `l'edge ne rend jamais ${c}`);
  assert.match(EDGE, /validerDemande\(/); // consigne_inconnue, intention_requise, texte_requis viennent de ce contrôle
  assert.match(REDACTION_CODES.demande_trop_longue, /trop long/i);
});

test('edge : règles partagées depuis _shared, rien d’un destinataire n’est lu, rien n’est écrit sauf le plafond', () => {
  assert.match(EDGE, /from "\.\.\/_shared\/mailRedaction\.js"/);
  assert.match(EDGE, /from "\.\.\/_shared\/mailCorps\.js"/);
  assert.match(EDGE, /requireOrgMembership\(req, \{[^}]*requiredRole: "org_admin"/);
  for (const interdit of ['clients', 'leads', 'mailing_logs', 'mail_segments'])
    assert.ok(!new RegExp(String.raw`\b${interdit}\b`).test(EDGE), `l'edge cite ${interdit}`);
  assert.ok(!/\.(insert|update|upsert|delete)\(/.test(EDGE), 'l’edge écrit en base');
  assert.ok(!/body\.(nom|site|brand|website|resources|adresses)/.test(EDGE), 'nom, site ou adresses pris de la requête');
});

test('edge : ordre des gardes — membre, module, validation, secret, plafond, appel', () => {
  const i = (motif) => EDGE.search(motif);
  const ordre = [i(/requireOrgMembership\(/), i(/moduleActif\(/), i(/validerDemande\(/), i(/ANTHROPIC_API_KEY\)/), i(/rpc\("increment_mailing_redaction_quota"/), i(/\.messages\.(stream|create)\(/)];
  assert.ok(ordre.every((n) => n >= 0), JSON.stringify(ordre));
  assert.deepEqual([...ordre].sort((a, b) => a - b), ordre);
});

test('edge : réponse recollée sans séparateur, tailles bornées, organisation exigée avant l’aide partagée', () => {
  assert.match(EDGE, /b\.text\)\.join\(""\)/, 'les blocs de texte doivent être joints par ""');
  assert.ok(!/b\.text\)\.join\("\n"\)/.test(EDGE));
  assert.match(EDGE, /CORPS_MAX = 12_000/);
  assert.match(EDGE, /MAX_TOKENS = 8_000/);
  assert.match(EDGE, /DUREE_IA_MS = 60_000/);
  assert.match(EDGE, /fallback/); // le passage par un modèle de repli est journalisé
  assert.match(EDGE, /usage\??\.iterations|\.iterations/);
  const uuid = EDGE.search(/\[0-9a-f\]\{8\}-/);
  const membre = EDGE.search(/requireOrgMembership\(req/);
  assert.ok(uuid >= 0 && uuid < membre, 'org_id doit être contrôlé (UUID) avant requireOrgMembership');
});

test('edge : les bornes de taille passent avant validerDemande', () => {
  const bornes = EDGE.search(/CORPS_MAX\) return refus\("demande_trop_longue"\)|> CORPS_MAX/);
  const valide = EDGE.search(/validerDemande\(\{/);
  assert.ok(bornes >= 0 && valide >= 0 && bornes < valide);
});

test('migration du plafond : trois révocations, service_role seul, RLS, exception attendue', () => {
  assert.match(MIGRATION, /REVOKE ALL ON majordhome\.mailing_redaction_quotas FROM PUBLIC, anon, authenticated/);
  assert.match(MIGRATION, /ENABLE ROW LEVEL SECURITY/);
  assert.match(MIGRATION, /REVOKE EXECUTE ON FUNCTION public\.increment_mailing_redaction_quota\(uuid, uuid, int\) FROM PUBLIC, anon, authenticated/);
  assert.match(MIGRATION, /GRANT EXECUTE ON FUNCTION public\.increment_mailing_redaction_quota\(uuid, uuid, int\) TO service_role/);
  assert.match(MIGRATION, /SECURITY DEFINER/);
  assert.match(MIGRATION, /SET search_path = majordhome, public/);
  assert.match(MIGRATION, /mailing_redaction_quota_exceeded/);
});

test('service : rediger appelle l’edge et rend un code, jamais une exception', () => {
  const svc = lire('src/shared/services/mailCampaigns.service.js');
  assert.match(svc, /async rediger\(orgId, demande\)/);
  assert.match(svc, /functions\.invoke\('mailing-rediger'/);
  assert.match(svc, /service_indisponible/);
});
