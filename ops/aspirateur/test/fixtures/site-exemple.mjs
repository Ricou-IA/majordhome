// ops/aspirateur/test/fixtures/site-exemple.mjs — site factice servi en local pour les tests du service.
// Liste paginée (2 pages + une page 3 qui répète la 2), 3 produits (le 3e réservé au compte), connexion par formulaire
// (cookie), un PDF, une page « captcha », une page qui affiche l'identifiant refusé, une image vers un hôte extérieur.
import http from 'node:http';

export const IDENTIFIANT = 'demo@exemple.fr';
export const MOT_DE_PASSE = 'MotDePasse-123';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj 4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 10 100 Td (Etas 67 % Particules 30) Tj ET\nendstream endobj 5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');

const page = (titre, corps) => `<!doctype html><html><head><meta charset="utf-8"><title>${titre}</title></head><body>${corps}</body></html>`;
const produit = (id, ref, nom, prix) => page(nom, `<h1>${nom}</h1><span class="ref">${ref}</span><span class="marque">Invicta</span>
  <span class="prix">${prix}</span><img class="photo" src="/img/${id}.jpg"><a class="fiche" href="/docs/fiche-${id}.pdf">Fiche technique</a>
  <div class="caracs">Puissance 8 kW. Etas 66 %.</div><img src="https://evil.example/pixel.gif">`);

/** @returns {Promise<{ url: string, hote: string, fermer: () => Promise<void>, demandes: string[] }>} */
export async function demarrerSite() {
  const demandes = [];
  const serveur = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    demandes.push(`${req.method} ${u.pathname}${u.search}`);
    const connecte = (req.headers.cookie || '').includes('session=ok');
    const envoyer = (code, type, corps, entetes = {}) => { res.writeHead(code, { 'content-type': type, ...entetes }); res.end(corps); };
    if (req.method === 'POST' && u.pathname === '/login') {
      let corps = '';
      req.on('data', (c) => { corps += c; });
      req.on('end', () => {
        const f = new URLSearchParams(corps);
        if (f.get('email') === IDENTIFIANT && f.get('password') === MOT_DE_PASSE) envoyer(302, 'text/plain', '', { location: '/compte', 'set-cookie': 'session=ok; Path=/' });
        else envoyer(200, 'text/html', page('Erreur', `<p class="erreur">Utilisateur ${f.get('email')} inconnu</p>`));
      });
      return;
    }
    if (u.pathname === '/login') return envoyer(200, 'text/html', page('Connexion', '<form method="post" action="/login"><input id="email" name="email"><input id="password" name="password" type="password"><button type="submit">Se connecter</button></form>'));
    if (u.pathname === '/compte') return envoyer(200, 'text/html', page('Compte', connecte ? '<div class="mon-compte">Bonjour</div>' : '<p>Non connecté</p>'));
    if (u.pathname === '/robots.txt') return envoyer(200, 'text/plain', 'User-agent: *\nDisallow: /prive/\n');
    if (u.pathname === '/liste') {
      const n = u.searchParams.get('page') || '1';
      if (n === '1') return envoyer(200, 'text/html', page('Liste', '<a class="p" href="/produit/1">1</a><a class="p" href="/produit/2">2</a><a class="suivant" href="/liste?page=2">Suivant</a>'));
      return envoyer(200, 'text/html', page('Liste', `<a class="p" href="/produit/3">3</a><a class="suivant" href="/liste?page=${Number(n) + 1}">Suivant</a>`));
    }
    if (u.pathname === '/produit/1') return envoyer(200, 'text/html', produit(1, 'P613744', 'Châtel', '1 200,00 €'));
    if (u.pathname === '/produit/2') return envoyer(200, 'text/html', produit(2, 'P700100', 'Pierre', '980,50 €'));
    if (u.pathname === '/produit/3') return connecte ? envoyer(200, 'text/html', produit(3, 'C07768-06', 'Toron', '1 450,00 €')) : envoyer(302, 'text/plain', '', { location: '/login' });
    if (u.pathname === '/produit/4') return envoyer(200, 'text/html', page('Sans ref', '<h1>Sans référence</h1>'));
    if (u.pathname.startsWith('/docs/')) return envoyer(200, 'application/pdf', PDF);
    if (u.pathname.startsWith('/img/')) return envoyer(200, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    if (u.pathname === '/captcha') return envoyer(200, 'text/html', page('Vérification', '<p>Vérifiez que vous êtes humain</p><iframe src="https://challenges.cloudflare.com/x"></iframe>'));
    return envoyer(404, 'text/plain', 'introuvable');
  });
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r));
  const { port } = /** @type {import('node:net').AddressInfo} */ (serveur.address());
  return { url: `http://127.0.0.1:${port}`, hote: `127.0.0.1:${port}`, demandes, fermer: () => new Promise((r) => serveur.close(() => r())) };
}
