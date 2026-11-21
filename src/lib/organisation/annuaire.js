// src/lib/organisation/annuaire.js
// ============================================================================
// Lecture d'une entreprise dans l'annuaire des entreprises (API Recherche d'entreprises,
// recherche-entreprises.api.gouv.fr — INSEE et RNE, Licence Ouverte, sans clé) et report sur
// l'onglet Identité. Module PUR, testé par scripts/organisation-annuaire.test.mjs ; l'appel
// réseau est dans annuaireClient.js. Mêmes règles que HésiaSun (lib/organization/annuaire.ts).
// ============================================================================
import { formatSiret, tvaDepuisSiret, formatTva } from './identite.js';

/**
 * @typedef {Object} EntrepriseAnnuaire
 * @property {string} siret
 * @property {string} siren
 * @property {string} raison_sociale
 * @property {string|null} forme_juridique  forme du formulaire, ou null sans correspondance sûre
 * @property {string} nature_juridique      code INSEE tel que publié (« 5710 »)
 * @property {string} adresse               numéro et voie, sans code postal ni commune
 * @property {string} code_postal
 * @property {string} ville
 * @property {'actif'|'ferme'|'inconnu'} etat
 * @property {{ nom: string, fonction: string }|null} signataire
 */

const texte = (v) => (typeof v === 'string' ? v.trim() : '');
const estObjet = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Nature juridique INSEE → forme du formulaire. Seules les correspondances sans ambiguïté sont traduites :
 * 1000 entrepreneur individuel, 5498 SARL unipersonnelle, 5499 SARL, 5505 à 5599 sociétés anonymes,
 * 5710 SAS, 5720 SAS unipersonnelle, 6540 SCI. Le reste se choisit à la main.
 * @param {unknown} code
 * @returns {string|null}
 */
export function formeJuridiqueDepuisNature(code) {
  const c = texte(typeof code === 'number' ? String(code) : code);
  if (c === '1000') return 'EI';
  if (c === '5498') return 'EURL';
  if (c === '5499') return 'SARL';
  if (c === '5710') return 'SAS';
  if (c === '5720') return 'SAS à associé unique';
  if (c === '6540') return 'SCI';
  if (/^55\d\d$/.test(c) && Number(c) >= 5505) return 'SA';
  return null;
}

/** « LOÏC JACQUES » → « Loïc Jacques », « JEAN-PIERRE » → « Jean-Pierre ». */
function prenomsLisibles(prenoms) {
  return prenoms.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, sep, lettre) => sep + lettre.toUpperCase());
}

/**
 * Signataire proposé : le président ou le gérant s'il est une personne physique, sinon la première personne
 * physique ; « Président de SAS » devient « Président ». Null si aucun dirigeant n'est une personne physique.
 * @param {unknown} dirigeants
 * @returns {{ nom: string, fonction: string }|null}
 */
export function signataireDepuisDirigeants(dirigeants) {
  if (!Array.isArray(dirigeants)) return null;
  const personnes = dirigeants.filter((d) => estObjet(d) && texte(d.type_dirigeant) === 'personne physique' && texte(d.nom) !== '');
  const choisi = personnes.find((d) => /pr[ée]sident|g[ée]rant/i.test(texte(d.qualite))) || personnes[0];
  if (!choisi) return null;
  const nom = [prenomsLisibles(texte(choisi.prenoms)), texte(choisi.nom).toUpperCase()].filter(Boolean).join(' ');
  const fonction = texte(choisi.qualite).replace(/\s+de\s+(SAS|SASU|SARL|EURL|SA|SCI)$/i, '');
  return { nom, fonction };
}

/** « 26 RUE DES PYRENEES 81600 GAILLAC » → « 26 RUE DES PYRENEES ». */
function voieDepuisAdresse(adresse, codePostal, commune) {
  const suffixe = `${codePostal} ${commune}`.trim();
  return suffixe && adresse.endsWith(suffixe) ? adresse.slice(0, -suffixe.length).trim() : adresse;
}

/**
 * Relit la réponse de `GET /search?q=<nom ou SIRET>` en propositions, dans l'ordre de l'annuaire.
 * SIRET tapé (14 chiffres) : l'établissement de ce SIRET, même secondaire. Nom ou SIREN : le siège.
 * Un résultat sans établissement lisible est écarté.
 * @param {unknown} reponse
 * @param {string} requete
 * @returns {EntrepriseAnnuaire[]}
 */
export function lireSuggestions(reponse, requete) {
  if (!estObjet(reponse) || !Array.isArray(reponse.results)) return [];
  const net = String(requete ?? '').replace(/\s/g, '');
  const siretTape = /^\d{14}$/.test(net) ? net : null;

  const suggestions = [];
  for (const resultat of reponse.results) {
    if (!estObjet(resultat)) continue;
    const siren = texte(resultat.siren);
    if (!/^\d{9}$/.test(siren)) continue;

    const voisins = Array.isArray(resultat.matching_etablissements) ? resultat.matching_etablissements.filter(estObjet) : [];
    const siege = estObjet(resultat.siege) ? resultat.siege : null;
    const etablissement = siretTape
      ? [...voisins, ...(siege ? [siege] : [])].find((e) => texte(e.siret) === siretTape)
      : (siege || voisins[0]);
    if (!etablissement || !/^\d{14}$/.test(texte(etablissement.siret))) continue;

    const nature = texte(typeof resultat.nature_juridique === 'number' ? String(resultat.nature_juridique) : resultat.nature_juridique);
    const codePostal = texte(etablissement.code_postal);
    const commune = texte(etablissement.libelle_commune);
    const etat = etablissement.etat_administratif;
    suggestions.push({
      siret: texte(etablissement.siret),
      siren,
      raison_sociale: texte(resultat.nom_raison_sociale) || texte(resultat.nom_complet),
      forme_juridique: formeJuridiqueDepuisNature(nature),
      nature_juridique: nature,
      adresse: voieDepuisAdresse(texte(etablissement.adresse), codePostal, commune),
      code_postal: codePostal,
      ville: commune,
      etat: etat === 'A' ? 'actif' : etat === 'F' ? 'ferme' : 'inconnu',
      signataire: signataireDepuisDirigeants(resultat.dirigeants),
    });
  }
  return suggestions;
}

/**
 * Identité déjà enregistrée : une raison sociale (ou un nom commercial) et un SIRET complet. La recherche
 * se replie alors en une ligne.
 * @param {Record<string, unknown>|null|undefined} settings
 * @returns {boolean}
 */
export function identiteEnregistree(settings) {
  const s = settings || {};
  return !!(texte(s.legal_name) || texte(s.brand_name)) && /^\d{14}$/.test(String(s.siret ?? '').replace(/\s/g, ''));
}

/**
 * Report d'une entreprise de l'annuaire sur le formulaire Identité. Rien n'est enregistré ici.
 * Raison sociale, SIRET, TVA et forme juridique sont REMPLACÉS (forme vidée si l'annuaire ne la traduit pas :
 * jamais celle de l'entreprise précédente) ; nom commercial et signataire ne sont remplis que s'ils sont vides.
 * @param {Record<string, string>} form
 * @param {EntrepriseAnnuaire} e
 * @returns {{ form: Record<string, string>, siege: { address: string, postal_code: string, city: string }|null, detail: string, avertissement: string|null }}
 */
export function appliquerEntreprise(form, e) {
  const nomVide = !texte(form.brand_name) && !!e.raison_sociale;
  const signataireLibre = !texte(form.signatory_name) && !texte(form.signatory_role) && !!e.signataire;
  const siege = e.adresse && e.code_postal && e.ville ? { address: e.adresse, postal_code: e.code_postal, city: e.ville } : null;
  const suite = {
    ...form,
    brand_name: nomVide ? e.raison_sociale : form.brand_name,
    legal_name: e.raison_sociale || form.legal_name,
    legal_form: e.forme_juridique || '',
    siret: formatSiret(e.siret),
    tva_intra: formatTva(tvaDepuisSiret(e.siret)),
    signatory_name: signataireLibre ? e.signataire.nom : form.signatory_name,
    signatory_role: signataireLibre ? e.signataire.fonction : form.signatory_role,
  };
  const remplis = [
    nomVide ? 'nom commercial' : null,
    'raison sociale',
    'SIRET',
    e.forme_juridique ? `forme juridique (${e.forme_juridique})` : null,
    'n° TVA',
    siege ? `adresse du siège (${siege.address}, ${siege.postal_code} ${siege.city})` : null,
    signataireLibre ? 'signataire' : null,
  ].filter(Boolean);
  const alertes = [
    e.forme_juridique ? null : `forme juridique à choisir à la main (nature juridique INSEE ${e.nature_juridique || 'inconnue'})`,
    e.etat === 'ferme' ? 'cet établissement est fermé dans l’annuaire' : null,
  ].filter(Boolean);
  return {
    form: suite,
    siege,
    detail: `Rempli : ${remplis.join(', ')}. Vérifiez puis enregistrez.`,
    avertissement: alertes.length ? `Attention : ${alertes.join(' ; ')}.` : null,
  };
}
