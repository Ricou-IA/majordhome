// src/lib/organisation/bodacc.js
// ============================================================================
// RCS et capital social d'une entreprise, lus dans ses annonces légales (BODACC, données ouvertes de la
// DILA : bodacc-datadila.opendatasoft.com, jeu « annonces-commerciales », Licence Ouverte, sans clé).
// L'annuaire des entreprises ne donne ni l'un ni l'autre (vérifié le 2026-11-21).
//
// Ce que le BODACC sait, et ses limites :
//   - le GREFFE d'immatriculation figure sur chaque annonce de la société (`nomGreffeImmat`) : c'est le
//     greffe réel, pas la ville du siège ;
//   - le CAPITAL ne figure que sur les annonces de création et de modification : il est daté, et peut être
//     ancien — il s'affiche avec la date de son annonce, à vérifier ;
//   - une entreprise sans annonce (très récente, ou hors registre du commerce) ne donne rien : on ne
//     construit jamais un RCS à partir de la ville du siège.
// Module PUR, testé par scripts/organisation-bodacc.test.mjs ; l'appel réseau est dans bodaccClient.js.
// ============================================================================

const texte = (v) => (typeof v === 'string' ? v.trim() : '');
const estObjet = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const chiffres = (v) => String(v ?? '').replace(/\D/g, '');

/**
 * @typedef {Object} ImmatriculationBodacc
 * @property {string|null} greffe        nom du greffe (« Lille Métropole »), ou null
 * @property {string|null} rcs           mention complète (« 306 138 900 R.C.S. Lille Métropole »), ou null
 * @property {{ montant: number, date: string|null }|null} capital  en euros, avec la date de l'annonce
 * @property {number} annonces           nombre d'annonces lues pour ce SIREN
 */

/** « 306138900 » → « 306 138 900 ». */
function sirenParGroupes(siren) {
  return siren.replace(/(\d{3})(?=\d)/g, '$1 ');
}

/** Personnes d'une annonce : `listepersonnes` arrive en texte JSON ou en objet, `personne` seule ou en liste. */
function personnesDe(annonce) {
  let liste = annonce?.listepersonnes;
  if (typeof liste === 'string') {
    try { liste = JSON.parse(liste); } catch { return []; }
  }
  if (!estObjet(liste)) return [];
  const p = liste.personne;
  return (Array.isArray(p) ? p : [p]).filter(estObjet);
}

/**
 * Lecture des annonces d'un SIREN (réponse de l'API, de la plus récente à la plus ancienne). Seules les
 * personnes immatriculées au RCS sous CE SIREN comptent : une annonce cite parfois une autre société.
 * @param {unknown} reponse
 * @param {string} siren  9 chiffres
 * @returns {ImmatriculationBodacc}
 */
export function lireImmatriculation(reponse, siren) {
  const cible = chiffres(siren);
  const vide = { greffe: null, rcs: null, capital: null, annonces: 0 };
  if (!/^\d{9}$/.test(cible) || !estObjet(reponse) || !Array.isArray(reponse.results)) return vide;

  const annonces = reponse.results.filter(estObjet)
    .slice()
    .sort((a, b) => texte(b.dateparution).localeCompare(texte(a.dateparution)));

  let greffe = null;
  let capital = null;
  let lues = 0;
  for (const annonce of annonces) {
    for (const personne of personnesDe(annonce)) {
      const immat = estObjet(personne.numeroImmatriculation) ? personne.numeroImmatriculation : null;
      if (!immat || chiffres(immat.numeroIdentification) !== cible) continue;
      lues += 1;
      if (!greffe && texte(immat.codeRCS).toUpperCase() === 'RCS' && texte(immat.nomGreffeImmat)) {
        greffe = texte(immat.nomGreffeImmat);
      }
      if (!capital && estObjet(personne.capital)) {
        const montant = Number(String(personne.capital.montantCapital ?? '').replace(',', '.'));
        const devise = texte(personne.capital.devise).toUpperCase();
        // Euros seulement, montant fixe et positif : un capital variable ou en devise se saisit à la main.
        if (Number.isFinite(montant) && montant > 0 && (devise === 'EUR' || devise === '')) {
          capital = { montant, date: texte(annonce.dateparution) || null };
        }
      }
    }
    if (greffe && capital) break;
  }

  return {
    greffe,
    rcs: greffe ? `${sirenParGroupes(cible)} R.C.S. ${greffe}` : null,
    capital,
    annonces: lues,
  };
}

/** Montant tel qu'il se saisit dans le champ : « 10 800 000 », « 7 500,50 ». */
export function formaterCapital(montant) {
  if (!Number.isFinite(montant)) return '';
  const [entier, decimales] = (Math.round(montant * 100) / 100).toFixed(2).split('.');
  const groupe = entier.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return decimales === '00' ? groupe : `${groupe},${decimales}`;
}

/** « 2026-08-21 » → « 21/08/2026 » ; autre forme : rendue telle quelle. */
function dateFr(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(texte(iso));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : texte(iso);
}

/**
 * Report de la lecture sur le formulaire Identité. Rien n'est enregistré ici.
 * `remplacer` (entreprise différente de celle du formulaire) : RCS et capital sont remplacés, et VIDÉS si le
 * BODACC ne les donne pas — jamais ceux de l'entreprise précédente. Sinon ils ne sont remplis que s'ils sont vides.
 * @param {Record<string, string>} form
 * @param {ImmatriculationBodacc} lecture
 * @param {{ remplacer?: boolean }} [options]
 * @returns {{ form: Record<string, string>, detail: string }}
 */
export function appliquerImmatriculation(form, lecture, { remplacer = false } = {}) {
  const rcsLibre = remplacer || !texte(form.rcs);
  const capitalLibre = remplacer || !texte(form.capital);
  const suite = {
    ...form,
    rcs: rcsLibre ? (lecture.rcs || '') : form.rcs,
    capital: capitalLibre ? (lecture.capital ? formaterCapital(lecture.capital.montant) : '') : form.capital,
  };

  const remplis = [
    rcsLibre && lecture.rcs ? `RCS (${lecture.rcs})` : null,
    capitalLibre && lecture.capital
      ? `capital social (${formaterCapital(lecture.capital.montant)} €${lecture.capital.date ? `, annonce du ${dateFr(lecture.capital.date)}` : ''})`
      : null,
  ].filter(Boolean);
  const manquants = [
    rcsLibre && !lecture.rcs ? 'RCS' : null,
    capitalLibre && !lecture.capital ? 'capital social' : null,
  ].filter(Boolean);

  let detail = '';
  if (remplis.length) detail = `Annonces légales : ${remplis.join(', ')}.`;
  if (manquants.length) {
    detail += `${detail ? ' ' : 'Annonces légales : '}${manquants.join(' et ')} non trouvé${manquants.length > 1 ? 's' : ''}, à saisir.`;
  }
  return { form: suite, detail };
}
