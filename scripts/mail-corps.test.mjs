import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estEditable, normaliser, versEditeur, depuisEditeur, variablesDe, texteBrut,
} from '../src/lib/mailCorps.js';
import { EMAILS_AUTOMATIQUES } from '../src/lib/emailsAutomatiques.js';
import { SEQUENCES_EMAILS } from '../src/lib/sequencesEmails.js';
import { WEBSHOP_EMAIL_DEFAULTS } from '../src/lib/webshop/emailTemplates.js';

const DEFAUTS = [
  ...EMAILS_AUTOMATIQUES.map((e) => [e.gabarit.key, e.gabarit.html_body]),
  ...SEQUENCES_EMAILS.map((e) => [e.gabarit.key, e.gabarit.html_body]),
  ...Object.values(WEBSHOP_EMAIL_DEFAULTS).map((g) => [g.key, g.html_body]),
];

const BOUTON_STYLE = 'background:{{ACCENT_COLOR}};color:#ffffff;padding:12px 22px;border-radius:6px;text-decoration:none;font-weight:600';

// ── Tests de la tâche ────────────────────────────────────────────────────────

test('tous les textes par défaut sont éditables', () => {
  for (const e of [...EMAILS_AUTOMATIQUES, ...SEQUENCES_EMAILS]) assert.ok(estEditable(e.gabarit.html_body), e.gabarit.key);
  for (const g of Object.values(WEBSHOP_EMAIL_DEFAULTS)) assert.ok(estEditable(g.html_body), g.key);
});

test('une page complète, une image, un tableau ne sont pas éditables', () => {
  for (const h of ['<!DOCTYPE html><html><body>x</body></html>', '<p><img src="a"></p>', '<table><tr><td>x</td></tr></table>']) assert.equal(estEditable(h), false);
});

test('normaliser est stable et ne change pas un texte simple', () => {
  const simple = '<p>Bonjour {{CLIENT_NAME}},</p>{{ITEMS}}<p><strong>Merci</strong><br>{{BRAND_NAME}}</p>';
  assert.equal(normaliser(simple), simple);
  for (const e of EMAILS_AUTOMATIQUES) assert.equal(normaliser(normaliser(e.gabarit.html_body)), normaliser(e.gabarit.html_body));
});

test('rien de dangereux ne survit', () => {
  const n = normaliser('<p onclick="x()">a<script>x</script><iframe></iframe><a href="javascript:1">b</a><style>p{}</style></p>');
  for (const interdit of ['onclick', '<script', '<iframe', 'javascript:', '<style']) assert.ok(!n.includes(interdit));
});

test('lecture tolérante : ancien bouton et ancien encadré reconnus', () => {
  assert.ok(normaliser('<p style="text-align:center"><a href="{{LIEN_PV}}" style="background:{{ACCENT_COLOR}};color:#fff">Signer</a></p>').includes('data-bouton'));
  assert.ok(normaliser('<div style="padding:8px">x</div>').includes('data-encadre'));
});

test('variable-bloc : nue à la racine, jamais dans un paragraphe', () => {
  assert.ok(normaliser('<p>a</p>{{LEGAL_INFO}}').endsWith('</p>{{LEGAL_INFO}}'));
  assert.equal(depuisEditeur(versEditeur('<p>a</p>{{ITEMS}}', {})), '<p>a</p>{{ITEMS}}');
});

test('texte collé depuis un traitement de texte : seul le texte reste', () => {
  const colle = '<div><span style="font-family:Calibri;color:red">Bonjour</span><font size="7"> à tous</font></div><table><tr><td>x</td></tr></table>';
  const n = depuisEditeur(colle);
  assert.ok(n.includes('Bonjour') && !/font|span|color:red|<table/.test(n));
});

test('sansElements : titre, bouton et encadré deviennent des paragraphes', () => {
  assert.ok(!/data-bouton|data-encadre|<h2/.test(normaliser('<h2>T</h2><div data-encadre>x</div>', { sansElements: true })));
});

// ── Forme enregistrée ────────────────────────────────────────────────────────

test('forme enregistrée : valeurs exactes du titre, du lien, du bouton et de l\'encadré', () => {
  assert.equal(normaliser('<h1 style="color:red">Titre</h1>'),
    '<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3;color:#0f172a">Titre</h2>');
  assert.equal(normaliser('<p><a href="https://ex.fr" class="x">ici</a></p>'),
    '<p><a href="https://ex.fr" style="color:{{ACCENT_COLOR}}">ici</a></p>');
  assert.equal(normaliser('<p><a data-bouton href="{{LIEN_PV}}">Signer</a></p>'),
    `<p style="text-align:center;margin:28px 0"><a data-bouton href="{{LIEN_PV}}" style="${BOUTON_STYLE}">Signer</a></p>`);
  assert.equal(normaliser('<div data-encadre>Important</div>'),
    '<div data-encadre style="border-left:4px solid {{ACCENT_COLOR}};background:#f8fafc;padding:12px 16px;margin:16px 0">Important</div>');
  assert.equal(normaliser('<ul><li>a</li><li><b>b</b></li></ul><ol><li><i>c</i></li></ol>'),
    '<ul><li>a</li><li><strong>b</strong></li></ul><ol><li><em>c</em></li></ol>');
});

test('le bouton des textes par défaut est reconnu', () => {
  for (const [cle, html] of DEFAUTS) {
    if (!html.includes('background:{{ACCENT_COLOR}}')) continue;
    assert.ok(normaliser(html).includes(`<a data-bouton href="`), cle);
  }
});

test('un lien coloré dans un paragraphe avec du texte reste un lien', () => {
  const n = normaliser('<p>Voir <a href="https://ex.fr" style="background:red">ici</a> merci</p>');
  assert.ok(!n.includes('data-bouton'));
  assert.ok(n.includes('<a href="https://ex.fr" style="color:{{ACCENT_COLOR}}">ici</a>'));
});

test('un div sans style de cadre est un paragraphe ; un div qui enveloppe des paragraphes est transparent', () => {
  assert.equal(normaliser('<div>Ligne</div>'), '<p>Ligne</p>');
  assert.equal(normaliser('<div style="font-family:Arial"><p>a</p><p>b</p></div>'), '<p>a</p><p>b</p>');
  assert.ok(normaliser('<div style="background:#eee">x</div>').includes('data-encadre'));
});

// ── Idempotence et aller-retour ──────────────────────────────────────────────

test('idempotence et aller-retour éditeur sur tous les textes par défaut', () => {
  const libelles = { '{{CLIENT_NAME}}': 'Nom du client', '{{ITEMS}}': 'Articles' };
  for (const [cle, html] of DEFAUTS) {
    const n = normaliser(html);
    assert.equal(normaliser(n), n, `${cle} idempotent`);
    assert.equal(depuisEditeur(versEditeur(n, libelles)), n, `${cle} aller-retour`);
    const s = normaliser(html, { sansElements: true });
    assert.equal(normaliser(s, { sansElements: true }), s, `${cle} sansElements idempotent`);
    assert.equal(depuisEditeur(versEditeur(s, libelles), { sansElements: true }), s, `${cle} sansElements aller-retour`);
  }
});

test('idempotence sur des entrées abîmées', () => {
  const abimes = [
    '<p>a <span> b</span> c</p>', '<p><strong>a</strong><strong> </strong>b</p>', '<b><p>x</p><p>y</p></b>',
    '<p>a<br><br><br>b<br></p>', '<p>&amp;lt; &lt;3 &foo; &eacute; &#233; &#xE9;</p>', 'texte <i>racine</i>\n{{X}}',
    '<ul><li>a<ul><li>b</li></ul></li></ul>', '<p>a<div>b</div>c</p>', '<a href="https://x.fr"><a href="https://y.fr">z</a></a>',
    '<div data-encadre><p>a</p><p>b</p></div>', '<p>&nbsp;a&nbsp;</p>', '<<p>>a</p>', '<p>a</b></i></p></div>',
  ];
  for (const h of abimes) {
    const n = normaliser(h);
    assert.equal(normaliser(n), n, h);
    assert.equal(depuisEditeur(versEditeur(n, {})), n, `aller-retour ${h}`);
  }
});

// ── Assainissement ───────────────────────────────────────────────────────────

test('attributs : seuls ceux de la table survivent', () => {
  const n = normaliser('<p id="i" class="c" style="color:red" onmouseover="x()" data-x="1">a <strong onclick="y()" class="k">b</strong> <a href="https://e.fr" onclick="z()" target="_blank" rel="x" id="l">c</a></p>');
  assert.equal(n, '<p>a <strong>b</strong> <a href="https://e.fr" style="color:{{ACCENT_COLOR}}">c</a></p>');
  assert.equal(normaliser('<h2 class="x" id="y" style="color:red">T</h2><div data-encadre class="z" onclick="a()" style="color:red">x</div>'),
    `<h2 style="margin:24px 0 8px;font-size:18px;line-height:1.3;color:#0f172a">T</h2><div data-encadre style="border-left:4px solid {{ACCENT_COLOR}};background:#f8fafc;padding:12px 16px;margin:16px 0">x</div>`);
  assert.equal(normaliser(`<p><a data-bouton href="https://e.fr" class="b" onclick="x" style="background:red;color:blue">Go</a></p>`),
    `<p style="text-align:center;margin:28px 0"><a data-bouton href="https://e.fr" style="${BOUTON_STYLE}">Go</a></p>`);
});

test('adresses de lien : seuls https, http, mailto, tel et une variable seule', () => {
  const bons = ['https://a.fr', 'http://a.fr', 'mailto:x@a.fr?subject=Désabonnement', 'tel:+33600000000', '{{LIEN_PV}}', 'HTTPS://A.FR', '  https://a.fr  '];
  for (const href of bons) assert.ok(normaliser(`<p><a href="${href}">x</a></p>`).includes('<a href="'), href);
  const mauvais = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', '  javascript:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)',
    '&#106;avascript:alert(1)', '&#x6A;avascript:alert(1)', '&#106avascript:alert(1)', 'javascript&colon;alert(1)',
    'data:text/html,<script>x</script>', 'vbscript:msgbox', '/relatif', '#ancre', '{{A}}{{B}}', '{{LIEN}}/suite', 'ftp://a.fr', '',
  ];
  for (const href of mauvais) {
    const n = normaliser(`<p><a href="${href.replace(/"/g, '&quot;')}">x</a></p>`);
    assert.equal(n, '<p>x</p>', href);
  }
  assert.equal(normaliser('<p><a>x</a></p>'), '<p>x</p>');
  assert.equal(normaliser("<p><a href='javascript:1'>x</a></p>"), '<p>x</p>');
  assert.equal(normaliser('<p><a href=javascript:1>x</a></p>'), '<p>x</p>');
});

test('un bouton à adresse refusée devient un paragraphe', () => {
  assert.equal(normaliser(`<p style="text-align:center"><a data-bouton href="javascript:x" style="${BOUTON_STYLE}">Payer</a></p>`), '<p>Payer</p>');
});

test('échappement : texte et attributs, sans double échappement', () => {
  assert.equal(normaliser('<p>a &lt; b &gt; c &amp; d "e"</p>'), '<p>a &lt; b &gt; c &amp; d &quot;e&quot;</p>');
  assert.equal(normaliser('<p>R&amp;D, J’ai 5 € &eacute;t&#233; à l\'heure <3</p>'), '<p>R&amp;D, J’ai 5 € été à l\'heure &lt;3</p>');
  assert.equal(normaliser('<p><a href="https://a.fr/?a=1&amp;b=&quot;2">x</a></p>'),
    '<p><a href="https://a.fr/?a=1&amp;b=&quot;2" style="color:{{ACCENT_COLOR}}">x</a></p>');
  assert.equal(normaliser('<p><a href="https://a.fr/?a=1&b=2">x</a></p>'),
    '<p><a href="https://a.fr/?a=1&amp;b=2" style="color:{{ACCENT_COLOR}}">x</a></p>');
  assert.equal(normaliser('<p>a&nbsp;b\u00a0c</p>'), '<p>a&nbsp;b&nbsp;c</p>');
});

test('balises mal fermées, commentaires, CDATA, < isolé : pas de plantage, pas de fuite', () => {
  const cas = [
    '<p>a<strong>b', '<p>a</strong>b</p>', '<!-- <script>x</script> -->', '<p>a<!-- commentaire -->b</p>', '<![CDATA[<script>x</script>]]><p>c</p>',
    '<p>1 < 2 et 3 > 2</p>', '<', '<p', '<p>a</p', '<a href="https://x.fr', '<scr<script>ipt>alert(1)</script>', '<script>alert(1)',
    '<style>p{}', '<p onclick="x" <script>', '<img src=x onerror=alert(1)>', '<svg><script>alert(1)</script></svg>',
    '<p>' + '<b>'.repeat(5000) + 'x', '<!--[if mso]><table><tr><td><![endif]-->x',
    '<iframe src="javascript:1"></iframe>', '<object data="x"></object><embed src="y">', '<math><mi>x</mi></math>',
    'İİİİİİİİ<STYLE>p{}</STYLE><P ONCLICK="x">a</P><SCRIPT>alert(1)</SCRIPT>',
  ];
  assert.equal(normaliser('İİİİ<STYLE>p{}</STYLE><P ONCLICK="x">a</P>'), '<p>İİİİ</p><p>a</p>');
  for (const h of cas) {
    const n = normaliser(h);
    assert.equal(typeof n, 'string');
    assert.ok(!/<(script|style|iframe|img|svg|object|embed|math|table|!--)/i.test(n), `${h} → ${n}`);
    assert.ok(!/onerror|onclick|javascript:/i.test(n), `${h} → ${n}`);
    assert.equal(normaliser(n), n, `idempotent ${h}`);
    // aucune balise hors de la liste
    for (const m of n.matchAll(/<\/?([a-z0-9]+)/gi)) assert.ok(['p', 'br', 'strong', 'em', 'a', 'h2', 'div', 'ul', 'ol', 'li'].includes(m[1]), `${m[1]} dans ${n}`);
  }
  assert.equal(normaliser('<p>1 < 2 et 3 > 2</p>'), '<p>1 &lt; 2 et 3 &gt; 2</p>');
  assert.equal(normaliser('<p>a<!-- commentaire -->b</p>'), '<p>ab</p>');
});

test('entrée vide, null, undefined : chaîne vide, jamais d\'exception', () => {
  for (const v of ['', null, undefined, '   ', '\n\n']) {
    assert.equal(normaliser(v), '');
    assert.equal(depuisEditeur(v), '');
    assert.equal(versEditeur(v, {}), '');
    assert.equal(texteBrut(v), '');
    assert.deepEqual(variablesDe(v), []);
    assert.equal(estEditable(v), true);
  }
  assert.equal(versEditeur('<p>a</p>'), '<p>a</p>');
});

test('texte collé depuis Word : seul le texte reste, en paragraphes', () => {
  const word = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset="utf-8"><style>p.MsoNormal{margin:0}</style><xml><o:OfficeDocumentSettings></o:OfficeDocumentSettings></xml></head><body lang="FR">'
    + '<p class="MsoNormal" style="mso-margin-top-alt:auto;font-family:&quot;Calibri&quot;,sans-serif;mso-fareast-language:FR"><o:p></o:p><span style="font-size:11.0pt;color:#1F497D;mso-themecolor:text2">Bonjour <b>Madame</b>,</span><o:p></o:p></p>'
    + '<p class="MsoNormal"><font face="Arial" color="red">Votre entretien est prévu.</font><o:p>&nbsp;</o:p></p>'
    + '<!--[if !supportLists]--><p class="MsoListParagraph">Point</p><!--[endif]--></body></html>';
  assert.equal(depuisEditeur(word), '<p>Bonjour <strong>Madame</strong>,</p><p>Votre entretien est prévu.</p><p>Point</p>');
});

// ── Éditeur ──────────────────────────────────────────────────────────────────

test('versEditeur : variables en étiquettes, libellés échappés', () => {
  const e = versEditeur('<p>Bonjour {{CLIENT_NAME}} {{INCONNUE}}</p>{{ITEMS}}', { '{{CLIENT_NAME}}': 'Nom <b>&"', '{{ITEMS}}': 'Articles' });
  assert.equal(e, '<p>Bonjour <span contenteditable="false" data-var="{{CLIENT_NAME}}" class="variable-mail">Nom &lt;b&gt;&amp;&quot;</span> '
    + '<span contenteditable="false" data-var="{{INCONNUE}}" class="variable-mail">INCONNUE</span></p>'
    + '<div contenteditable="false" data-var-bloc="{{ITEMS}}" class="variable-bloc">Articles</div>');
  assert.equal(versEditeur('<p>{{X}}</p>', { X: 'Libellé X' }).includes('>Libellé X</span>'), true);
});

test('versEditeur assainit aussi ce qu\'il reçoit', () => {
  const e = versEditeur('<p onclick="x">a<script>b</script><img src=x onerror=y></p>', {});
  assert.equal(e, '<p>a</p>');
});

test('depuisEditeur : div de l\'éditeur → paragraphes, étiquettes → variables', () => {
  assert.equal(depuisEditeur('<div>Ligne 1</div><div><br></div><div>Ligne 2 <span contenteditable="false" data-var="{{X}}" class="variable-mail">Libellé</span></div>'),
    '<p>Ligne 1</p><p>Ligne 2 {{X}}</p>');
  assert.equal(depuisEditeur('<div style="padding:8px">collé</div>'), '<p>collé</p>');
  assert.equal(depuisEditeur('<div data-encadre style="x">a<div>b</div></div>'),
    '<div data-encadre style="border-left:4px solid {{ACCENT_COLOR}};background:#f8fafc;padding:12px 16px;margin:16px 0">a<br>b</div>');
  assert.equal(depuisEditeur('<span data-var="javascript:x">texte</span>'), '<p>texte</p>');
});

test('sansElements : le bouton devient un lien dans un paragraphe, le lien n\'a pas de couleur', () => {
  const s = normaliser(`<h2>Titre</h2><p style="text-align:center"><a data-bouton href="{{L}}" style="${BOUTON_STYLE}">Voir</a></p><div data-encadre>Note</div><p><a href="https://x.fr">lien</a></p>`, { sansElements: true });
  assert.equal(s, '<p>Titre</p><p><a href="{{L}}">Voir</a></p><p>Note</p><p><a href="https://x.fr">lien</a></p>');
  assert.ok(!s.includes('ACCENT_COLOR'));
});

test('un jeton de variable n\'est jamais coupé ni altéré', () => {
  assert.equal(normaliser('<p>  {{A}}   {{B}}\n{{C}}</p>'), '<p>{{A}} {{B}} {{C}}</p>');
  assert.equal(normaliser('<p>{{ PAS_UN_JETON }} {{a-b}}</p>'), '<p>{{ PAS_UN_JETON }} {{a-b}}</p>');
  assert.equal(normaliser('{{ITEMS}}\n{{DELIVERY_INFO}}\n<p>x</p>'), '{{ITEMS}}{{DELIVERY_INFO}}<p>x</p>');
  assert.equal(normaliser('Texte tapé {{X}}'), '<p>Texte tapé {{X}}</p>');
  assert.equal(normaliser('<p>{{ITEMS}}</p>'), '<p>{{ITEMS}}</p>');
});

test('estEditable : tolérant sur les styles, refuse ce qui ne se reprend pas', () => {
  for (const h of ['<p style="color:red">a</p>', '<div style="padding:8px">x</div>', '<p><span style="x">a</span><font>b</font><u>c</u></p>', '<h3>T</h3><ul><li>x</li></ul>', '<p>a<!-- c -->b</p>']) assert.equal(estEditable(h), true, h);
  for (const h of ['<p>a<script>x</script></p>', '<hr>', '<p><iframe></iframe></p>', '<html><body><p>x</p></body></html>', '<video src="x"></video>', '<form><input></form>']) assert.equal(estEditable(h), false, h);
});

test('variablesDe et texteBrut', () => {
  assert.deepEqual(variablesDe('<p>{{B}} {{A}} {{B}}</p><a href="{{L}}">x</a>'), ['{{B}}', '{{A}}', '{{L}}']);
  assert.equal(texteBrut('<p>Bonjour&nbsp;<strong>{{X}}</strong>,<br>ligne</p>{{ITEMS}}<ul><li>a</li><li>b &amp; c</li></ul>'),
    'Bonjour {{X}},\nligne\n{{ITEMS}}\na\nb & c');
});
