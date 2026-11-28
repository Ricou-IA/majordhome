// ops/aspirateur/travaux.mjs — file des travaux et exécution d'un travail (apprentissage ou aspiration).
// - Un travail à la fois par site (politesse), deux au plus en tout.
// - Les accès d'un travail ne vivent qu'en mémoire, le temps du travail ; le journal les masque.
// - Une aspiration se termine TOUJOURS par un envoi « fin » (réussite ou échec) ; un apprentissage réussi se termine par
//   l'envoi « recette » (le travail attend alors la confirmation de l'administrateur), un apprentissage en échec par « fin ».
// Spec 2026-11-28 aspirateur § 7.1, plan Task 9. Testé : test/serveur.test.mjs.
import { CodeErreur } from './erreurs.mjs';
import { creerJournal } from './journal.mjs';
import { filtrerParMarques } from './lib/propositions.js';

const ENVOI_MAX_OCTETS = 4 * 1024 * 1024; // corps d'un envoi vers l'edge (PDF en base64 compris)

/**
 * @param {{ executer: (t: any) => Promise<void>, maxTotal?: number }} cfg
 */
export function creerFile({ executer, maxTotal = 2 }) {
  const attente = [];
  const sitesOccupes = new Set();
  let enCours = 0;
  const pomper = () => {
    while (enCours < maxTotal) {
      const i = attente.findIndex((t) => !sitesOccupes.has(t.hote_site));
      if (i < 0) return;
      const [t] = attente.splice(i, 1);
      sitesOccupes.add(t.hote_site);
      enCours += 1;
      Promise.resolve().then(() => executer(t)).catch(() => null).finally(() => {
        sitesOccupes.delete(t.hote_site);
        enCours -= 1;
        pomper();
      });
    }
  };
  return { soumettre(t) { attente.push(t); pomper(); }, get enAttente() { return attente.length; }, get enCours() { return enCours; } };
}

/**
 * Découpe un lot de produits en envois sous `max` octets (taille JSON) ; un produit trop lourd part seul.
 * @param {object[]} produits @param {number} [max]
 * @returns {object[][]}
 */
export function decouperLot(produits, max = ENVOI_MAX_OCTETS) {
  const morceaux = [];
  let courant = [];
  let taille = 0;
  for (const p of produits) {
    const t = JSON.stringify(p).length;
    if (courant.length && taille + t > max) { morceaux.push(courant); courant = []; taille = 0; }
    courant.push(p);
    taille += t;
  }
  if (courant.length) morceaux.push(courant);
  return morceaux;
}

const sansContenu = (p) => ({ ...p, documents: (p.documents || []).map(({ contenu_base64, ...d }) => d) }); // eslint-disable-line no-unused-vars

/**
 * Exécute un travail. Ne lève jamais : toute erreur devient un envoi « fin » en échec.
 * @param {any} travail
 * @param {{ ouvrirNavigateur: Function, creerModele: Function, envoyerRetour: (corps: object) => Promise<void>,
 *   apprendre: Function, rejouer: Function, sortie?: { log: Function, error: Function }, plafonds?: { pages: number, minutes: number } }} deps
 */
export async function executerTravail(travail, deps) {
  const acces = travail.acces ? { identifiant: String(travail.acces.identifiant || ''), motDePasse: String(travail.acces.mot_de_passe || '') } : null;
  const secrets = [acces?.identifiant, acces?.motDePasse, travail.compte_client];
  const journal = creerJournal(secrets, deps.sortie);
  const id = travail.aspiration_id;
  let nav = null;
  try {
    nav = await deps.ouvrirNavigateur({ hoteSite: travail.hote_site, delaiMs: Math.max(1000, travail.recette?.politesse?.delai_ms ?? 1000), secrets });
    const modele = deps.creerModele({ aspirationId: id });
    if (travail.genre === 'apprentissage') {
      const { recette, essai } = await deps.apprendre({
        hoteSite: travail.hote_site, urlDepart: travail.url_depart, acces, compteClient: travail.compte_client, champs: travail.champs,
        marques: travail.marques, modele, navigateur: nav, journal, recetteDepart: travail.recette, plafonds: deps.plafonds || { pages: 60, minutes: 15 },
      });
      await deps.envoyerRetour({ action: 'recette', aspiration_id: id, recette, essai: essai.map(sansContenu) });
      journal.info('apprentissage terminé', { aspiration: id });
      return;
    }
    const { compteurs, echecs } = await deps.rejouer({
      recette: travail.recette, acces, champs: travail.champs, modele, navigateur: nav, journal, limitePages: deps.plafonds?.pages ?? 2000,
      surLot: async (lot) => {
        for (const morceau of decouperLot(filtrerParMarques(lot, travail.marques))) {
          if (morceau.length) await deps.envoyerRetour({ action: 'lot', aspiration_id: id, produits: morceau });
        }
      },
    });
    await deps.envoyerRetour({ action: 'fin', aspiration_id: id, statut: 'termine', code: null, compteurs, echecs });
    journal.info('aspiration terminée', { aspiration: id, ...compteurs });
  } catch (e) {
    const code = e instanceof CodeErreur ? e.code : 'service_indisponible';
    journal.erreur('travail en échec', { aspiration: id, code, message: String(e?.message || e) });
    try {
      await deps.envoyerRetour({ action: 'fin', aspiration_id: id, statut: 'echec', code, compteurs: null, echecs: null });
    } catch (e2) {
      journal.erreur('fin non transmise', { aspiration: id, message: String(e2?.message || e2) });
    }
  } finally {
    if (nav) await nav.fermer().catch(() => null);
  }
}
