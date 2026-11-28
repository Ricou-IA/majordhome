// ops/aspirateur/rejeu.mjs — rejoue une RECETTE (aspiration sans agent) : connexion, listes paginées, pages produit,
// documents PDF ; les caractéristiques sont lues par le petit modèle (via le relais) sur le texte de la page et des PDF,
// la valeur d'un PDF primant. La provenance se MESURE : chaque page produit est d'abord demandée sans session ;
// servie telle quelle ⇒ « public », sinon « compte ». Les produits partent par lots de 20 (`surLot`).
// Aucun accès (identifiant, mot de passe) n'est envoyé au modèle ni placé dans un lot : le navigateur les masque.
// Spec 2026-11-28 aspirateur § 7.5. Testé : test/rejeu.test.mjs.
import { createHash } from 'node:crypto';
import { CodeErreur } from './erreurs.mjs';
import { texteDe } from './modele.mjs';
import { construirePromptLecture, lireReponse, fusionnerLectures } from './lib/lecture.js';

const LOT = 20;

/** Prix lu sur une page (« 1 200,00 € », « 1.200,50 € HT », « 980.5 ») ; null si illisible. @param {string | null} texte */
export function prixDepuisTexte(texte) {
  if (typeof texte !== 'string') return null;
  const m = texte.replace(/[\s\u00a0\u202f]/g, '').match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0];
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Texte d'un PDF (pdfjs, build legacy pour Node), tronqué à 60 000 caractères. @param {Buffer} octets */
export async function texteDuPdf(octets) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(octets), isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  let texte = '';
  for (let i = 1; i <= doc.numPages && texte.length < 60_000; i += 1) {
    const page = await doc.getPage(i);
    const contenu = await page.getTextContent();
    texte += contenu.items.map((it) => ('str' in it ? it.str : '')).join(' ') + '\n';
  }
  await doc.destroy();
  return texte.slice(0, 60_000);
}

/**
 * @param {{
 *   recette: Record<string, any>, acces: { identifiant: string, motDePasse: string } | null,
 *   champs: Array<Record<string, unknown>>, modele: { appeler: (d: any) => Promise<any> },
 *   navigateur: any, journal: { info: Function, erreur: Function },
 *   surLot: (produits: object[]) => Promise<void>, limitePages?: number, essai?: number,
 *   lirePdf?: (octets: Buffer) => Promise<string>,
 * }} opts
 * @returns {Promise<{ compteurs: { trouves: number, lus: number, echecs: number, documents: number }, echecs: Array<{ url: string, raison: string }> }>}
 */
export async function rejouer({ recette, acces, champs, modele, navigateur: nav, journal, surLot, limitePages = 2000, essai, lirePdf = texteDuPdf }) {
  const protege = async () => { if (await nav.estProtege()) throw new CodeErreur('site_protege'); };

  // 1. Connexion
  if (recette.connexion) {
    if (!acces) throw new CodeErreur('acces_absents');
    const c = recette.connexion;
    await nav.aller(c.url);
    await protege();
    await nav.remplir(c.champ_identifiant, acces.identifiant);
    await nav.remplir(c.champ_mot_de_passe, acces.motDePasse);
    await nav.cliquer(c.bouton);
    await protege();
    if (!(await nav.texte(c.preuve))) throw new CodeErreur('acces_refuses');
    journal.info('connecté');
  }

  // 2. Listes
  const urls = [];
  const vus = new Set();
  const limite = Number.isFinite(essai) && essai > 0 ? essai : Infinity;
  for (const depart of recette.listes.departs) {
    let page = depart;
    const pagesVues = new Set();
    while (page && !pagesVues.has(page) && urls.length < limite && nav.pagesVues < limitePages) {
      pagesVues.add(page);
      const r = await nav.aller(page);
      await protege();
      if (r.statut >= 400) break;
      const nouveaux = (await nav.attributs(recette.listes.lien_produit, 'href')).filter((u) => !vus.has(u));
      if (!nouveaux.length) break; // page vide ou répétée : fin de la liste
      for (const u of nouveaux) { vus.add(u); if (urls.length < limite) urls.push(u); }
      page = recette.listes.suivant ? (await nav.attributs(recette.listes.suivant, 'href'))[0] : null;
    }
  }
  const compteurs = { trouves: urls.length, lus: 0, echecs: 0, documents: 0 };
  const echecs = [];
  if (!urls.length) throw new CodeErreur('recette_obsolete');

  // 3. Produits
  const anonyme = recette.connexion ? await nav.sansSession() : null;
  let lot = [];
  let sansReference = 0;
  const p = recette.produit;
  try {
    for (const url of urls) {
      if (nav.pagesVues >= limitePages) { echecs.push({ url, raison: 'plafond_pages' }); compteurs.echecs += 1; continue; }
      try {
        let provenance = 'public';
        if (anonyme) {
          const r = await anonyme.aller(url);
          provenance = r.statut === 200 && new URL(r.url).pathname === new URL(url).pathname ? 'public' : 'compte';
        }
        await nav.aller(url);
        await protege();
        const titre = (await nav.lirePage()).titre;
        const reference = p.reference ? await nav.texte(p.reference) : null;
        const zone = (p.zone_caracteristiques && await nav.texte(p.zone_caracteristiques)) || (await nav.lirePage()).texte;

        const lire = async (texte, source) => {
          const { systeme, utilisateur } = construirePromptLecture({ champs, texte, source });
          return lireReponse(texteDe(await modele.appeler({ usage: 'lire', system: systeme, messages: [{ role: 'user', content: utilisateur }] })), champs);
        };
        const lecturePage = await lire(zone, 'page');
        let valeurs = lecturePage.valeurs;
        let refLue = lecturePage.reference_fabricant;

        const documents = [];
        for (const d of p.documents || []) {
          const lien = (await nav.attributs(d.selecteur, 'href'))[0];
          if (!lien) continue;
          try {
            const { octets } = await nav.telecharger(lien);
            if (octets.subarray(0, 5).toString('latin1') !== '%PDF-') continue;
            const lecturePdf = await lire(await lirePdf(octets), 'pdf');
            valeurs = fusionnerLectures(valeurs, lecturePdf.valeurs);
            refLue = refLue || lecturePdf.reference_fabricant;
            documents.push({ type: d.type, empreinte: createHash('sha256').update(octets).digest('hex'), contenu_base64: octets.toString('base64') });
            compteurs.documents += 1;
          } catch (e) {
            if (e instanceof CodeErreur) throw e;
            journal.info('document illisible', { url: lien });
          }
        }

        const ref = reference || refLue || null;
        if (!ref) sansReference += 1;
        lot.push({
          url, reference_fabricant: ref, nom: (p.nom && await nav.texte(p.nom)) || titre,
          marque: p.marque ? await nav.texte(p.marque) : null, ean: p.ean ? await nav.texte(p.ean) : null,
          prix: p.prix ? prixDepuisTexte(await nav.texte(p.prix)) : null,
          photo_url: p.photo ? (await nav.attributs(p.photo, 'src'))[0] || null : null,
          documents, valeurs, provenance, lu_le: new Date().toISOString(),
        });
        compteurs.lus += 1;
        if (lot.length >= LOT) { await surLot(lot); lot = []; }
      } catch (e) {
        if (e instanceof CodeErreur) throw e;
        echecs.push({ url, raison: 'page_illisible' });
        compteurs.echecs += 1;
        journal.erreur('produit illisible', { url, message: String(e?.message || e) });
      }
    }
    if (lot.length) await surLot(lot);
  } finally {
    if (anonyme) await anonyme.fermer();
  }

  if (compteurs.lus > 0 && sansReference > compteurs.lus / 2) throw new CodeErreur('recette_obsolete');
  return { compteurs, echecs };
}
