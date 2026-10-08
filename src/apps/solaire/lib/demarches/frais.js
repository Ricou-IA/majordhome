// src/apps/solaire/lib/demarches/frais.js
// Tableau des frais administratifs (spec §6.9). PUR.
// Montant inconnu = null + montant_connu:false (jamais 0 par défaut) ; le total
// n'est donné que si toutes les lignes sont connues.
import { valeurA, TARIFS_META } from './parametres.js';
import { alerteParametre, typeConsuel, demarcheEnedis } from './regles.js';

const arrondi = (n) => Math.round(n * 100) / 100;

/**
 * @param {object} inputs
 * @param {object} params
 * @param {{ depot_enedis: string, attestation_consuel: string }} dates dates du planning auxquelles résoudre les tarifs
 */
export function calculerFrais(inputs, params, dates) {
  const alertes = [];
  const pec = { ...params.prise_en_charge_defaut, ...(inputs.prise_en_charge ?? {}) };
  const lignes = [];

  lignes.push({ code: 'dp', libelle: 'Déclaration préalable de travaux', montant_ttc: 0, montant_connu: true, prise_en_charge: 'inclus', parametre: null });

  const enedis = demarcheEnedis(inputs);
  if (enedis.type === 'cacsi') {
    lignes.push({ code: 'raccordement_enedis', libelle: 'Convention CACSI (autoconsommation sans injection)', montant_ttc: 0, montant_connu: true, prise_en_charge: pec.raccordement_enedis, parametre: null });
  } else if (inputs.compteur_linky === false) {
    lignes.push({ code: 'raccordement_enedis', libelle: 'Raccordement Enedis (compteur à remplacer, montant à confirmer)', montant_ttc: null, montant_connu: false, prise_en_charge: pec.raccordement_enedis, parametre: null });
  } else {
    const cle = 'frais_raccordement_enedis';
    const r = valeurA(params.tarifs[cle], dates.depot_enedis);
    const a = alerteParametre(cle, r);
    if (a) alertes.push(a);
    lignes.push({
      code: 'raccordement_enedis', libelle: 'Raccordement Enedis (vente du surplus)',
      montant_ttc: r ? r.valeur : null, montant_connu: Boolean(r), prise_en_charge: pec.raccordement_enedis,
      parametre: { cle, date_effet: r ? r.date_effet : null, unite: TARIFS_META[cle].unite },
    });
  }

  const visa = typeConsuel(inputs);
  const cleConsuel = visa === 'violet' ? 'tarif_consuel_violet' : 'tarif_consuel_bleu';
  const rc = valeurA(params.tarifs[cleConsuel], dates.attestation_consuel);
  const ac = alerteParametre(cleConsuel, rc);
  if (ac) alertes.push(ac);
  lignes.push({
    code: 'consuel', libelle: `Attestation Consuel — visa ${visa}`,
    montant_ttc: rc ? rc.valeur : null, montant_connu: Boolean(rc), prise_en_charge: pec.consuel,
    parametre: { cle: cleConsuel, date_effet: rc ? rc.date_effet : null, unite: TARIFS_META[cleConsuel].unite },
  });

  const total_connu = lignes.every((l) => l.montant_connu);
  const total_ttc = total_connu ? arrondi(lignes.reduce((s, l) => s + l.montant_ttc, 0)) : null;
  return { lignes, total_ttc, total_connu, alertes };
}
