// ops/aspirateur/navigateur.mjs — navigateur Chromium (Playwright) BORNÉ au site du fournisseur.
// - Toute requête vers un hôte hors du domaine enregistrable du site est interrompue et comptée. Pour les documents et
//   les appels de script (fetch, XHR), chaque redirection est examinée AVANT d'être suivie : une redirection ouverte du
//   site ne mène pas ailleurs (relecture C1/I3). WebSockets interrompus, service workers bloqués.
// - Les accès ne sont tapés que par seConnecter, dans un vrai formulaire de connexion de l'hôte EXACT du site
//   (champ mot de passe, même formulaire, envoi vers ce même hôte) — jamais dans un formulaire d'avis ou d'un tiers.
// - Politesse : au moins `delaiMs` entre deux demandes, partagé entre la session et le contexte sans session.
// - Sans session, robots.txt est respecté (groupe « * »).
// - Tout texte qui sort du navigateur passe par masquerSecrets (toutes formes du secret), AVANT toute troncature.
// Spec 2026-11-28 aspirateur § 7.4-7.5. Testé : test/navigateur.test.mjs (site factice local, `modeTest`).
import { chromium } from 'playwright';
import { urlAutorisee, cheminAutorise } from './lib/domaine.js';
import { masquerSecrets } from './journal.mjs';

const TEXTE_MAX = 60_000;
const LIENS_MAX = 300;
const CHAMPS_MAX = 60;
// Une application JavaScript (Angular chez Invicta) dessine le formulaire après le chargement de la page.
const ATTENTE_FORMULAIRE_MS = 10_000;
const APAISEMENT_MS = 8_000;
const PDF_MAX = 20 * 1024 * 1024;
const DELAI_PAGE_MS = 30_000;
const REDIRECTIONS_MAX = 3;
const TYPES_EXAMINES = new Set(['document', 'xhr', 'fetch']);
const PROTECTION = /challenges\.cloudflare\.com|hcaptcha\.com|google\.com\/recaptcha|v[ée]rifiez que vous [êe]tes humain|verify you are human|cf-chl-/i;
const HORS_SITE = 'adresse hors du site';

const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{ hoteSite: string, delaiMs: number, modeTest?: boolean, secrets?: string[] }} opts
 *   `modeTest` : accepte http et compare l'hôte exact (avec le port) — tests sur le site factice local seulement.
 */
export async function ouvrirNavigateur({ hoteSite, delaiMs, modeTest = false, secrets = [] }) {
  const navigateur = await chromium.launch({ headless: true, chromiumSandbox: process.env.ASPIRATEUR_SANS_BAC_A_SABLE !== '1' && !modeTest });
  return creer(navigateur, { hoteSite, delaiMs, modeTest, secrets }, true, true, { derniere: 0 });
}

async function creer(navigateur, cfg, avecSession, proprietaire, horloge) {
  const autorise = (url) => {
    if (cfg.modeTest) { try { return new URL(url).host === cfg.hoteSite; } catch { return false; } }
    return urlAutorisee(url, cfg.hoteSite);
  };
  const hoteExact = (url) => {
    try { const u = new URL(url); return cfg.modeTest ? u.host === cfg.hoteSite : (u.protocol === 'https:' && u.hostname === cfg.hoteSite); } catch { return false; }
  };
  const masquer = (t) => masquerSecrets(t, cfg.secrets);
  const contexte = await navigateur.newContext({
    acceptDownloads: false, javaScriptEnabled: true, serviceWorkers: 'block',
    userAgent: 'Majordhome-aspirateur (catalogue fournisseur, accord du fournisseur)',
  });
  const etat = { pagesVues: 0, bloquees: 0, horsSite: false, robots: undefined };
  await contexte.routeWebSocket(/.*/, (ws) => { etat.bloquees += 1; ws.close({ code: 1008, reason: 'aspirateur' }).catch(() => null); });
  await contexte.route('**/*', async (route) => {
    const requete = route.request();
    const url = requete.url();
    if (url.startsWith('data:')) return route.continue();
    if (!autorise(url)) { etat.bloquees += 1; if (requete.isNavigationRequest() && !requete.frame().parentFrame()) etat.horsSite = true; return route.abort('blockedbyclient'); }
    if (!TYPES_EXAMINES.has(requete.resourceType())) return route.continue();
    try {
      // La redirection est lue AVANT d'être suivie : le navigateur ne la suit que si la cible est du site.
      const reponse = await route.fetch({ maxRedirects: 0 });
      const cible = reponse.status() >= 300 && reponse.status() < 400 ? reponse.headers().location : null;
      if (cible && !autorise(new URL(cible, url).href)) {
        etat.bloquees += 1;
        if (requete.isNavigationRequest() && !requete.frame().parentFrame()) etat.horsSite = true;
        return route.abort('blockedbyclient');
      }
      return route.fulfill({ response: reponse });
    } catch {
      return route.abort('failed').catch(() => null);
    }
  });
  const page = await contexte.newPage();
  page.setDefaultTimeout(DELAI_PAGE_MS);

  const politesse = async () => {
    const reste = horloge.derniere + cfg.delaiMs - Date.now();
    if (reste > 0) await attendre(reste);
    horloge.derniere = Date.now();
  };
  const exiger = (url) => { if (!autorise(url)) throw new Error(HORS_SITE); };
  /** Après une navigation : la page doit être restée sur le site, sinon elle est quittée. */
  const verifierPage = async () => {
    if (etat.horsSite || !autorise(page.url())) {
      etat.horsSite = false;
      await page.goto('about:blank').catch(() => null);
      throw new Error(HORS_SITE);
    }
  };
  const robotsAutorise = async (url) => {
    if (avecSession) return true;
    if (etat.robots === undefined) {
      try {
        const r = await contexte.request.get(new URL('/robots.txt', url).href, { timeout: 15_000, maxRedirects: 0 });
        etat.robots = r.ok() ? await r.text() : '';
      } catch { etat.robots = ''; }
    }
    const u = new URL(url);
    return cheminAutorise(etat.robots, `${u.pathname}${u.search}`);
  };

  // Une application JavaScript (Angular chez Invicta) dessine la page après ses appels réseau : au « load », la page
  // est encore vide (vécu le 2026-11-28 : texte vide, aucun champ, l'agent devinait). On attend la fin des échanges,
  // borné : un site qui ne se tait jamais rend la main au bout du délai.
  const apaiser = () => page.waitForLoadState('networkidle', { timeout: APAISEMENT_MS }).catch(() => null);

  const nav = {
    get pagesVues() { return etat.pagesVues; },
    get bloquees() { return etat.bloquees; },
    avecSession,

    /** @param {string} url @returns {Promise<{ statut: number, url: string }>} */
    async aller(url) {
      exiger(url);
      if (!(await robotsAutorise(url))) throw new Error('page interdite aux robots par robots.txt');
      await politesse();
      etat.horsSite = false;
      let r = null;
      try {
        // « load » : images et scripts de la page sont demandés (et bloqués s'ils sortent du site) avant de rendre la main
        r = await page.goto(url, { waitUntil: 'load', timeout: DELAI_PAGE_MS });
      } catch (e) {
        if (etat.horsSite) { await verifierPage(); }
        throw e;
      }
      await apaiser();
      await verifierPage();
      etat.pagesVues += 1;
      return { statut: r ? r.status() : 0, url: page.url() };
    },

    /**
     * Titre, texte visible, liens et CHAMPS de formulaire de la page ouverte. Sans les champs, l'agent devinait les
     * sélecteurs du formulaire de connexion à l'aveugle (vécu le 2026-11-28 sur Invicta : 8 refus, 2,88 $). Un champ
     * est décrit par sa structure seulement — jamais sa valeur.
     * @returns {Promise<{ titre: string, texte: string, liens: Array<{ texte: string, url: string }>, champs: Array<Record<string, string | number | null>> }>}
     */
    async lirePage() {
      const brut = await page.evaluate(({ max, maxChamps }) => {
        const formulaires = [...document.forms];
        const attr = (el, a) => (el.getAttribute(a) || '').trim().slice(0, 120) || null;
        const libelle = (el) => {
          const pour = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
          const l = pour || el.closest('label');
          return ((l?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120)) || attr(el, 'aria-label');
        };
        const selecteur = (el) => {
          const t = el.tagName.toLowerCase();
          if (el.id) return `#${CSS.escape(el.id)}`;
          for (const a of ['name', 'formcontrolname']) { const v = el.getAttribute(a); if (v) return `${t}[${a}="${v.replace(/"/g, '\\"')}"]`; }
          return null;
        };
        const champs = [...document.querySelectorAll('input, select, textarea, button')]
          .filter((el) => !(el.tagName === 'INPUT' && el.type === 'hidden'))
          .slice(0, maxChamps)
          .map((el) => ({
            balise: el.tagName.toLowerCase(), type: el.getAttribute('type') || (el.tagName === 'BUTTON' ? 'submit' : null),
            id: el.id || null, name: attr(el, 'name'), formcontrolname: attr(el, 'formcontrolname'),
            placeholder: attr(el, 'placeholder'), autocomplete: attr(el, 'autocomplete'), libelle: libelle(el),
            texte: el.tagName === 'BUTTON' ? ((el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || null) : null,
            formulaire: el.form ? formulaires.indexOf(el.form) : -1, selecteur: selecteur(el),
          }));
        return {
          titre: document.title || '',
          texte: (document.body?.innerText || '').slice(0, 2_000_000),
          liens: [...document.querySelectorAll('a[href]')].slice(0, max).map((a) => ({ texte: (a.textContent || '').trim().slice(0, 2_000), url: a.href })),
          champs,
        };
      }, { max: LIENS_MAX, maxChamps: CHAMPS_MAX });
      // masquer AVANT de tronquer : un secret coupé à la limite garderait une partie visible (relecture I4)
      const plein = masquer(brut.texte);
      const texte = plein.length > TEXTE_MAX ? `${plein.slice(0, TEXTE_MAX)}\n[… page tronquée]` : plein;
      const champs = brut.champs.map((c) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, typeof v === 'string' ? masquer(v) : v])));
      return { titre: masquer(brut.titre), texte, liens: brut.liens.map((l) => ({ texte: masquer(l.texte).slice(0, 200), url: masquer(l.url) })), champs };
    },

    /** Texte du premier élément du sélecteur, null s'il n'y en a pas. @param {string} selecteur */
    async texte(selecteur) {
      const el = await page.$(selecteur);
      if (!el) return null;
      const t = masquer(((await el.textContent()) || '').replace(/\s+/g, ' ').trim());
      return t || null;
    },

    /** Attribut de tous les éléments du sélecteur (href / src rendus absolus). @param {string} selecteur @param {string} attribut */
    async attributs(selecteur, attribut) {
      const valeurs = await page.$$eval(selecteur, (els, a) => els.map((el) => (a in el && typeof el[a] === 'string' ? el[a] : el.getAttribute(a)) || ''), attribut);
      return valeurs.filter(Boolean).map(masquer);
    },

    /** @param {string} selecteur */
    async cliquer(selecteur) {
      await politesse();
      etat.horsSite = false;
      const navigation = page.waitForEvent('framenavigated', { timeout: 5_000 }).catch(() => null);
      await page.click(selecteur, { timeout: 10_000 });
      await navigation;
      await page.waitForLoadState('domcontentloaded').catch(() => null);
      await apaiser();
      await verifierPage();
    },

    /**
     * Tape les accès dans le formulaire de connexion de la page ouverte et rend l'état : 'connecte' | 'refuse'.
     * Refus (erreur « formulaire de connexion refusé ») si la page n'est pas sur l'hôte exact du site, si le champ du
     * mot de passe n'est pas un champ mot de passe, si les champs et le bouton ne sont pas dans un même formulaire, si
     * le formulaire envoie ailleurs que sur ce même hôte, ou si la preuve de connexion est déjà visible avant.
     * @param {{ champ_identifiant: string, champ_mot_de_passe: string, bouton: string, preuve: string }} c
     * @param {{ identifiant: string, motDePasse: string }} acces
     */
    async seConnecter(c, acces) {
      const refus = (raison) => new Error(`formulaire de connexion refusé : ${raison}`);
      if (!hoteExact(page.url())) throw refus('la page n’est pas sur le site du fournisseur');
      // attendre que le formulaire soit dessiné ; un sélecteur qui n'apparaît pas finit en « champs introuvables »
      await Promise.all([c.champ_identifiant, c.champ_mot_de_passe].map((s) => page.waitForSelector(s, { state: 'attached', timeout: ATTENTE_FORMULAIRE_MS }).catch(() => null)));
      const verdict = await page.evaluate(({ id, mdp, bouton, preuve }) => {
        const a = document.querySelector(id);
        const b = document.querySelector(mdp);
        if (!a || !b) return 'champs introuvables';
        if (!(b instanceof HTMLInputElement) || b.type !== 'password') return 'pas de champ mot de passe';
        if (!(a instanceof HTMLInputElement) || !a.form || a.form !== b.form) return 'les champs ne sont pas dans un même formulaire';
        const bt = document.querySelector(bouton);
        if (!bt || !a.form.contains(bt)) return 'le bouton n’est pas dans le formulaire';
        if (preuve && document.querySelector(preuve)) return 'la preuve de connexion est visible avant la connexion';
        const action = a.form.getAttribute('action');
        return { cible: action ? new URL(action, location.href).href : location.href };
      }, { id: c.champ_identifiant, mdp: c.champ_mot_de_passe, bouton: c.bouton, preuve: c.preuve });
      if (typeof verdict === 'string') throw refus(verdict);
      if (!hoteExact(verdict.cible)) throw refus('il envoie hors du site');
      await page.fill(c.champ_identifiant, acces.identifiant, { timeout: 10_000 });
      await page.fill(c.champ_mot_de_passe, acces.motDePasse, { timeout: 10_000 });
      await nav.cliquer(c.bouton);
      return (await nav.texte(c.preuve)) ? 'connecte' : 'refuse';
    },

    /** @param {string} url @returns {Promise<{ octets: Buffer, type: string }>} */
    async telecharger(url) {
      exiger(url);
      if (!(await robotsAutorise(url))) throw new Error('fichier interdit aux robots par robots.txt');
      let courant = url;
      for (let saut = 0; saut <= REDIRECTIONS_MAX; saut += 1) {
        await politesse();
        const r = await contexte.request.get(courant, { timeout: DELAI_PAGE_MS, maxRedirects: 0 });
        if (r.status() >= 300 && r.status() < 400) {
          const cible = r.headers().location;
          if (!cible) throw new Error(`téléchargement refusé (${r.status()})`);
          courant = new URL(cible, courant).href;
          exiger(courant); // chaque saut est vérifié avant d'être suivi
          continue;
        }
        if (!r.ok()) throw new Error(`téléchargement refusé (${r.status()})`);
        const octets = await r.body();
        if (octets.length > PDF_MAX) throw new Error('fichier trop lourd');
        return { octets, type: (r.headers()['content-type'] || '').split(';')[0].trim() };
      }
      throw new Error('trop de redirections');
    },

    async estProtege() {
      return PROTECTION.test(await page.content());
    },

    /** Même navigateur, même bornage et même politesse, sans aucun cookie (mesure de la provenance « public »). */
    async sansSession() {
      return creer(navigateur, cfg, false, false, horloge);
    },

    async fermer() {
      await contexte.close().catch(() => null);
      if (proprietaire) await navigateur.close().catch(() => null);
    },
  };
  return nav;
}
