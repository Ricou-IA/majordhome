// ops/aspirateur/navigateur.mjs — navigateur Chromium (Playwright) BORNÉ au site du fournisseur.
// - Toute requête (page, image, script, PDF) vers un hôte hors du domaine enregistrable du site est interrompue et
//   comptée : une page piégée ne peut rien envoyer ailleurs.
// - Politesse : au moins `delaiMs` entre deux demandes de page, de clic ou de téléchargement.
// - Tout texte qui sort du navigateur (page, sélecteur, lien) passe par masquerSecrets : un site qui réaffiche
//   l'identifiant (« Utilisateur x@y.fr inconnu ») ne le fait pas remonter au modèle ni au journal.
// Spec 2026-11-28 aspirateur § 7.4-7.5. Testé : test/navigateur.test.mjs (site factice local, `modeTest`).
import { chromium } from 'playwright';
import { urlAutorisee } from './lib/domaine.js';
import { masquerSecrets } from './journal.mjs';

const TEXTE_MAX = 60_000;
const LIENS_MAX = 300;
const PDF_MAX = 20 * 1024 * 1024;
const DELAI_PAGE_MS = 30_000;
const PROTECTION = /challenges\.cloudflare\.com|hcaptcha\.com|google\.com\/recaptcha|v[ée]rifiez que vous [êe]tes humain|verify you are human|cf-chl-/i;

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ hoteSite: string, delaiMs: number, modeTest?: boolean, secrets?: string[] }} opts
 *   `modeTest` : accepte http et compare l'hôte exact (avec le port) — tests sur le site factice local seulement.
 */
export async function ouvrirNavigateur({ hoteSite, delaiMs, modeTest = false, secrets = [] }) {
  const navigateur = await chromium.launch({ headless: true });
  return creer(navigateur, { hoteSite, delaiMs, modeTest, secrets }, true, true);
}

async function creer(navigateur, cfg, avecSession, proprietaire) {
  const autorise = (url) => {
    if (cfg.modeTest) { try { return new URL(url).host === cfg.hoteSite; } catch { return false; } }
    return urlAutorisee(url, cfg.hoteSite);
  };
  const masquer = (t) => masquerSecrets(t, cfg.secrets);
  const contexte = await navigateur.newContext({ acceptDownloads: false, javaScriptEnabled: true, userAgent: 'Majordhome-aspirateur (catalogue fournisseur, accord du fournisseur)' });
  const etat = { pagesVues: 0, bloquees: 0, derniere: 0 };
  await contexte.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || autorise(url)) return route.continue();
    etat.bloquees += 1;
    return route.abort('blockedbyclient');
  });
  const page = await contexte.newPage();
  page.setDefaultTimeout(DELAI_PAGE_MS);

  const politesse = async () => {
    const reste = etat.derniere + cfg.delaiMs - Date.now();
    if (reste > 0) await attendre(reste);
    etat.derniere = Date.now();
  };
  const exiger = (url) => { if (!autorise(url)) throw new Error('adresse hors du site'); };

  const nav = {
    get pagesVues() { return etat.pagesVues; },
    get bloquees() { return etat.bloquees; },
    avecSession,

    /** @param {string} url @returns {Promise<{ statut: number, url: string }>} */
    async aller(url) {
      exiger(url);
      await politesse();
      const r = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DELAI_PAGE_MS });
      etat.pagesVues += 1;
      return { statut: r ? r.status() : 0, url: page.url() };
    },

    /** @returns {Promise<{ titre: string, texte: string, liens: Array<{ texte: string, url: string }> }>} */
    async lirePage() {
      const brut = await page.evaluate((max) => ({
        titre: document.title || '',
        texte: (document.body?.innerText || '').slice(0, 200_000),
        liens: [...document.querySelectorAll('a[href]')].slice(0, max).map((a) => ({ texte: (a.textContent || '').trim().slice(0, 200), url: a.href })),
      }), LIENS_MAX);
      const texte = brut.texte.length > TEXTE_MAX ? `${brut.texte.slice(0, TEXTE_MAX)}\n[… page tronquée]` : brut.texte;
      return { titre: masquer(brut.titre), texte: masquer(texte), liens: brut.liens.map((l) => ({ texte: masquer(l.texte), url: masquer(l.url) })) };
    },

    /** Texte du premier élément du sélecteur, null s'il n'y en a pas. @param {string} selecteur */
    async texte(selecteur) {
      const el = await page.$(selecteur);
      if (!el) return null;
      const t = ((await el.textContent()) || '').replace(/\s+/g, ' ').trim();
      return t ? masquer(t) : null;
    },

    /** Attribut de tous les éléments du sélecteur (href / src rendus absolus). @param {string} selecteur @param {string} attribut */
    async attributs(selecteur, attribut) {
      const valeurs = await page.$$eval(selecteur, (els, a) => els.map((el) => (a in el && typeof el[a] === 'string' ? el[a] : el.getAttribute(a)) || ''), attribut);
      return valeurs.filter(Boolean).map(masquer);
    },

    /** @param {string} selecteur */
    async cliquer(selecteur) {
      await politesse();
      const navigation = page.waitForEvent('framenavigated', { timeout: 5_000 }).catch(() => null);
      await page.click(selecteur, { timeout: 10_000 });
      await navigation;
      await page.waitForLoadState('domcontentloaded').catch(() => null);
    },

    /** @param {string} selecteur @param {string} valeur */
    async remplir(selecteur, valeur) {
      await page.fill(selecteur, valeur, { timeout: 10_000 });
    },

    /** @param {string} url @returns {Promise<{ octets: Buffer, type: string }>} */
    async telecharger(url) {
      exiger(url);
      await politesse();
      const r = await contexte.request.get(url, { timeout: DELAI_PAGE_MS, maxRedirects: 3 });
      if (!r.ok()) throw new Error(`téléchargement refusé (${r.status()})`);
      if (!autorise(r.url())) throw new Error('adresse hors du site');
      const octets = await r.body();
      if (octets.length > PDF_MAX) throw new Error('fichier trop lourd');
      return { octets, type: (r.headers()['content-type'] || '').split(';')[0].trim() };
    },

    async estProtege() {
      return PROTECTION.test(await page.content());
    },

    /** Même navigateur, même bornage, sans aucun cookie (mesure de la provenance « public »). */
    async sansSession() {
      return creer(navigateur, cfg, false, false);
    },

    async fermer() {
      await contexte.close().catch(() => null);
      if (proprietaire) await navigateur.close().catch(() => null);
    },
  };
  return nav;
}
