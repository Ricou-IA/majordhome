import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMARCHES_DEFAULTS, DELAIS_META, TARIFS_META, valeurA, buildDemarchesParams,
} from '../../src/apps/solaire/lib/demarches/parametres.js';

test('défauts : chaque délai et chaque tarif a ses métadonnées', () => {
  for (const cle of Object.keys(DEMARCHES_DEFAULTS.delais)) assert.ok(DELAIS_META[cle], `DELAIS_META.${cle}`);
  for (const cle of Object.keys(DEMARCHES_DEFAULTS.tarifs)) assert.ok(TARIFS_META[cle], `TARIFS_META.${cle}`);
  assert.deepEqual(DEMARCHES_DEFAULTS.prise_en_charge_defaut, { raccordement_enedis: 'refacture', consuel: 'refacture' });
});

test('valeurA : dernière entrée dont date_effet ≤ date cible', () => {
  const liste = [
    { date_effet: '2026-01-01', valeur: 50.1, valide_jusqu_au: '2026-10-27' },
    { date_effet: '2026-10-28', valeur: 61 },
  ];
  assert.equal(valeurA(liste, '2026-10-27').valeur, 50.1);
  assert.equal(valeurA(liste, '2026-10-28').valeur, 61);
  assert.equal(valeurA(liste, '2026-10-28').perimee, false);
});

test('valeurA : périmée si valide_jusqu_au dépassé, null si rien en vigueur ou liste vide', () => {
  const liste = [{ date_effet: '2026-01-01', valeur: 50.1, valide_jusqu_au: '2026-10-27' }];
  assert.equal(valeurA(liste, '2026-11-02').perimee, true);
  assert.equal(valeurA(liste, '2026-11-02').valeur, 50.1);
  assert.equal(valeurA(liste, '2025-12-31'), null);
  assert.equal(valeurA([], '2026-06-01'), null);
  assert.equal(valeurA(undefined, '2026-06-01'), null);
});

test('valeurA : ordre de la liste indifférent', () => {
  const liste = [{ date_effet: '2026-10-28', valeur: 61 }, { date_effet: '2026-01-01', valeur: 50.1 }];
  assert.equal(valeurA(liste, '2026-06-01').valeur, 50.1);
});

test('buildDemarchesParams : les objets fusionnent, les listes datées remplacent', () => {
  const settings = { pv: { demarches: {
    delais: { consuel: { jours: 10 } },
    tarifs: { tarif_consuel_bleu: [{ date_effet: '2027-01-01', valeur: 200 }] },
  } } };
  const p = buildDemarchesParams(settings);
  assert.equal(p.delais.consuel.jours, 10);
  assert.equal(p.delais.recours_tiers.mois, 2);            // défaut conservé
  assert.deepEqual(p.tarifs.tarif_consuel_bleu, [{ date_effet: '2027-01-01', valeur: 200 }]);
  assert.equal(p.tarifs.frais_raccordement_enedis.length, 1); // défaut conservé
});

test('buildDemarchesParams : sans settings → défauts', () => {
  assert.deepEqual(buildDemarchesParams(undefined), DEMARCHES_DEFAULTS);
  assert.deepEqual(buildDemarchesParams({}), DEMARCHES_DEFAULTS);
});

// ── Task 2 : planning ──────────────────────────────────────────────────────
import { ajouterDelai, lundiSuivant, maxIso, calculerPlanning } from '../../src/apps/solaire/lib/demarches/planning.js';

test('ajouterDelai : jours et mois calendaires, écrêtage fin de mois', () => {
  assert.equal(ajouterDelai('2026-10-08', { jours: 7 }), '2026-10-15');
  assert.equal(ajouterDelai('2026-01-31', { mois: 1 }), '2026-02-28');
  assert.equal(ajouterDelai('2026-11-15', { mois: 2 }), '2027-01-15');
  assert.equal(ajouterDelai('2026-10-08', {}), '2026-10-08');
});

test('lundiSuivant : lundi conservé, sinon prochain lundi', () => {
  assert.equal(lundiSuivant('2026-10-12'), '2026-10-12'); // lundi
  assert.equal(lundiSuivant('2026-10-13'), '2026-10-19'); // mardi
  assert.equal(lundiSuivant('2026-10-11'), '2026-10-12'); // dimanche
});

test('maxIso', () => {
  assert.equal(maxIso('2026-01-01', '2026-03-01'), '2026-03-01');
  assert.equal(maxIso('2026-03-01', '2026-01-01'), '2026-03-01');
});

test('calculerPlanning : chevauchement recours / Enedis, pose au lundi suivant le max', () => {
  const p = calculerPlanning({ date_depart: '2026-10-08', instructionCle: 'instruction_dp', enedisCle: 'enedis_surplus' }, DEMARCHES_DEFAULTS);
  assert.equal(p.depot_dp, '2026-10-15');
  assert.equal(p.accord_dp, '2026-11-15');
  assert.equal(p.fin_recours, '2027-01-15');
  assert.equal(p.depot_enedis, '2026-11-15');       // = accord, en parallèle du recours
  assert.equal(p.reponse_enedis, '2027-02-15');     // 3 mois (surplus) > fin du recours
  assert.equal(p.pose_au_plus_tot, '2027-02-15');   // 15/02/2027 est un lundi
  assert.equal(p.fin_pose, '2027-02-17');
  assert.equal(p.attestation_consuel, '2027-03-10');
  assert.equal(p.mise_en_service_au_plus_tard, '2027-04-21');
  assert.equal(p.duree_totale_mois, 6.4);
  assert.ok(p.hypotheses.some((h) => h.includes('7 jours')));
});

test('calculerPlanning : ABF = 2 mois d’instruction ; CACSI = 2 mois Enedis, le recours devient le facteur limitant', () => {
  const p = calculerPlanning({ date_depart: '2026-10-08', instructionCle: 'instruction_dp_abf', enedisCle: 'enedis_cacsi' }, DEMARCHES_DEFAULTS);
  assert.equal(p.accord_dp, '2026-12-15');
  assert.equal(p.fin_recours, '2027-02-15');
  assert.equal(p.reponse_enedis, '2027-02-15');
  assert.equal(p.pose_au_plus_tot, '2027-02-15');
});

// ── Task 3 : référentiel + règles ──────────────────────────────────────────
import { ETAPES } from '../../src/apps/solaire/lib/demarches/referentiel.js';
import {
  delaiInstruction, demarcheEnedis, typeConsuel, rachat, alertesSituation, construireEtapes,
} from '../../src/apps/solaire/lib/demarches/regles.js';

const BASE = {
  commune_insee: '81099', commune_nom: 'Gaillac', puissance_kwc: 6, batterie: false,
  perimetre_abf: 'non', installateur_rge: true, mode_valorisation: 'autoconso_surplus',
  copropriete_ou_lotissement: 'aucun', compteur_linky: true, date_depart: '2026-10-08',
  prise_en_charge: { raccordement_enedis: 'refacture', consuel: 'refacture' },
};

test('référentiel : 10 étapes (9 + accord d’AG), codes uniques', () => {
  assert.equal(ETAPES.length, 10);
  assert.equal(new Set(ETAPES.map((e) => e.code)).size, 10);
  assert.equal(ETAPES[0].code, 'ACCORD_AG');
  assert.equal(ETAPES.at(-1).code, 'CONTRAT_CLOTURE');
});

test('delaiInstruction : non → 1 mois, oui → 2 mois + prescriptions, inconnu → 2 mois + à vérifier', () => {
  assert.equal(delaiInstruction(BASE).cle, 'instruction_dp');
  const oui = delaiInstruction({ ...BASE, perimetre_abf: 'oui' });
  assert.equal(oui.cle, 'instruction_dp_abf');
  assert.ok(oui.alertes.some((a) => a.code === 'abf_prescriptions' && a.niveau === 'info'));
  const inc = delaiInstruction({ ...BASE, perimetre_abf: 'inconnu' });
  assert.equal(inc.cle, 'instruction_dp_abf');
  assert.ok(inc.alertes.some((a) => a.code === 'abf_a_verifier' && a.niveau === 'avertissement'));
});

test('demarcheEnedis et typeConsuel', () => {
  assert.deepEqual(demarcheEnedis(BASE), { type: 'surplus', delaiCle: 'enedis_surplus' });
  assert.deepEqual(demarcheEnedis({ ...BASE, mode_valorisation: 'autoconso_totale' }), { type: 'cacsi', delaiCle: 'enedis_cacsi' });
  assert.equal(typeConsuel(BASE), 'bleu');
  assert.equal(typeConsuel({ ...BASE, batterie: true }), 'violet');
});

test('rachat : surplus + RGE → éligible avec tarif ≤ 9 kWc ; totale → non applicable ; non RGE → bloquant', () => {
  const r = rachat(BASE, DEMARCHES_DEFAULTS, '2026-11-15');
  assert.equal(r.applicable, true);
  assert.equal(r.eligible, true);
  assert.equal(r.tarif.valeur, 1.1);
  assert.equal(r.tarif.unite, 'c€/kWh');
  assert.equal(r.alertes.length, 0);
  assert.equal(rachat({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, '2026-11-15').applicable, false);
  const nonRge = rachat({ ...BASE, installateur_rge: false }, DEMARCHES_DEFAULTS, '2026-11-15');
  assert.equal(nonRge.eligible, false);
  assert.ok(nonRge.alertes.some((a) => a.code === 'oa_non_eligible' && a.niveau === 'bloquant'));
});

test('rachat : > 9 kWc sans tarif → parametre_manquant, tarif null', () => {
  const r = rachat({ ...BASE, puissance_kwc: 12 }, DEMARCHES_DEFAULTS, '2026-11-15');
  assert.equal(r.tarif, null);
  assert.ok(r.alertes.some((a) => a.code === 'parametre_manquant' && a.cle === 'tarif_oa_surplus_gt_9kwc'));
});

test('alertesSituation : copropriété, lotissement, compteur non Linky', () => {
  assert.equal(alertesSituation(BASE).length, 0);
  assert.ok(alertesSituation({ ...BASE, copropriete_ou_lotissement: 'copropriete' }).some((a) => a.code === 'copropriete_ag' && a.niveau === 'avertissement'));
  assert.ok(alertesSituation({ ...BASE, copropriete_ou_lotissement: 'lotissement' }).some((a) => a.code === 'lotissement_reglement' && a.niveau === 'info'));
  assert.ok(alertesSituation({ ...BASE, compteur_linky: false }).some((a) => a.code === 'compteur_non_linky'));
  assert.equal(alertesSituation({ ...BASE, mode_valorisation: 'autoconso_totale', compteur_linky: false }).length, 0);
});

test('construireEtapes : textes variantes selon le mode, accord d’AG seulement en copropriété', () => {
  const ctx = { instructionCle: 'instruction_dp', enedisCle: 'enedis_surplus', societe: 'Soleil SAS' };
  const etapes = construireEtapes(BASE, DEMARCHES_DEFAULTS, ctx);
  assert.equal(etapes.filter((e) => e.applicable).length, 9);
  const depot = etapes.find((e) => e.code === 'DEPOT_DP');
  assert.ok(depot.installateur.includes('Soleil SAS'));
  assert.ok(depot.client.includes('mandat'));
  assert.ok(etapes.find((e) => e.code === 'RACCORDEMENT_ENEDIS').installateur.includes('obligation d’achat'));
  assert.ok(etapes.find((e) => e.code === 'CONTRAT_CLOTURE').client.includes('contrat de rachat'));
  assert.equal(etapes.find((e) => e.code === 'INSTRUCTION_DP').delai.libelle, '1 mois');
  const totale = construireEtapes({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, { ...ctx, enedisCle: 'enedis_cacsi' });
  assert.ok(totale.find((e) => e.code === 'RACCORDEMENT_ENEDIS').installateur.includes('CACSI'));
  assert.ok(!totale.find((e) => e.code === 'CONTRAT_CLOTURE').client.includes('contrat de rachat'));
  const copro = construireEtapes({ ...BASE, copropriete_ou_lotissement: 'copropriete' }, DEMARCHES_DEFAULTS, ctx);
  assert.equal(copro.filter((e) => e.applicable).length, 10);
  assert.equal(copro[0].code, 'ACCORD_AG');
});

// ── Task 4 : pièces + frais ────────────────────────────────────────────────
import { listerPieces } from '../../src/apps/solaire/lib/demarches/pieces.js';
import { calculerFrais } from '../../src/apps/solaire/lib/demarches/frais.js';

test('listerPieces : base toujours applicable, RIB seulement en surplus, règlements selon la situation', () => {
  const codes = (inputs) => listerPieces(inputs).filter((p) => p.applicable).map((p) => p.code);
  assert.deepEqual(codes(BASE), ['factures_12_mois', 'numero_pdl', 'justificatif_propriete', 'piece_identite_declarant', 'mandat_signe', 'rib']);
  assert.ok(!codes({ ...BASE, mode_valorisation: 'autoconso_totale' }).includes('rib'));
  assert.ok(codes({ ...BASE, copropriete_ou_lotissement: 'copropriete' }).includes('reglement_copropriete'));
  assert.ok(codes({ ...BASE, copropriete_ou_lotissement: 'copropriete' }).includes('accord_ag'));
  assert.ok(codes({ ...BASE, copropriete_ou_lotissement: 'lotissement' }).includes('reglement_lotissement'));
  assert.equal(listerPieces(BASE).length, 9); // toutes listées, applicable ou non
});

test('calculerFrais : surplus + Linky → Enedis au tarif en vigueur, Consuel bleu, DP gratuite, total connu', () => {
  const f = calculerFrais(BASE, DEMARCHES_DEFAULTS, { depot_enedis: '2026-11-15', attestation_consuel: '2027-03-10' });
  const enedis = f.lignes.find((l) => l.code === 'raccordement_enedis');
  assert.equal(enedis.montant_ttc, 50.1);
  assert.equal(enedis.prise_en_charge, 'refacture');
  assert.equal(enedis.parametre.cle, 'frais_raccordement_enedis');
  assert.equal(f.lignes.find((l) => l.code === 'consuel').montant_ttc, 195.2);
  assert.equal(f.lignes.find((l) => l.code === 'dp').montant_ttc, 0);
  assert.equal(f.total_ttc, 245.3);
  assert.equal(f.total_connu, true);
  assert.ok(f.alertes.some((a) => a.code === 'parametre_perime' && a.cle === 'frais_raccordement_enedis')); // valide jusqu'au 27/10/2026
});

test('calculerFrais : totale → CACSI gratuite ; batterie → violet manquant → montant null, total inconnu', () => {
  const totale = calculerFrais({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, { depot_enedis: '2026-10-15', attestation_consuel: '2026-12-01' });
  assert.equal(totale.lignes.find((l) => l.code === 'raccordement_enedis').montant_ttc, 0);
  const bat = calculerFrais({ ...BASE, batterie: true }, DEMARCHES_DEFAULTS, { depot_enedis: '2026-10-15', attestation_consuel: '2026-12-01' });
  const consuel = bat.lignes.find((l) => l.code === 'consuel');
  assert.equal(consuel.montant_ttc, null);
  assert.equal(consuel.montant_connu, false);
  assert.ok(consuel.libelle.includes('violet'));
  assert.equal(bat.total_connu, false);
  assert.equal(bat.total_ttc, null);
  assert.ok(bat.alertes.some((a) => a.code === 'parametre_manquant' && a.cle === 'tarif_consuel_violet'));
});

test('calculerFrais : surplus sans Linky → montant Enedis inconnu ; prise en charge par projet respectée', () => {
  const f = calculerFrais({ ...BASE, compteur_linky: false, prise_en_charge: { raccordement_enedis: 'inclus', consuel: 'refacture' } }, DEMARCHES_DEFAULTS, { depot_enedis: '2026-10-15', attestation_consuel: '2026-12-01' });
  const enedis = f.lignes.find((l) => l.code === 'raccordement_enedis');
  assert.equal(enedis.montant_connu, false);
  assert.equal(enedis.prise_en_charge, 'inclus');
  assert.equal(f.lignes.find((l) => l.code === 'consuel').prise_en_charge, 'refacture');
});

// ── Task 5 : point d'entrée + critères d'acceptation ───────────────────────
import { ENGINE_VERSION, normaliserInputs, calculerDemarches } from '../../src/apps/solaire/lib/demarches/index.js';

const OPTS = { aujourdhui: '2026-10-08', societe: 'Soleil SAS' };

test('normaliserInputs : défauts (surplus, aucun, Linky, date du jour) et perimetre_abf dérivable', () => {
  const n = normaliserInputs({ puissance_kwc: 6 }, { aujourdhui: '2026-10-08' });
  assert.equal(n.mode_valorisation, 'autoconso_surplus');
  assert.equal(n.copropriete_ou_lotissement, 'aucun');
  assert.equal(n.compteur_linky, true);
  assert.equal(n.batterie, false);
  assert.equal(n.perimetre_abf, 'inconnu');
  assert.equal(n.date_depart, '2026-10-08');
  assert.equal(normaliserInputs({ abf: { secteur_protege: true } }, { aujourdhui: '2026-10-08' }).perimetre_abf, 'oui');
  assert.equal(normaliserInputs({ abf: { secteur_protege: false } }, { aujourdhui: '2026-10-08' }).perimetre_abf, 'non');
  assert.equal(normaliserInputs({ perimetre_abf: 'non', abf: null }, { aujourdhui: '2026-10-08' }).perimetre_abf, 'non');
});

test('critère 1 : toiture, sans ABF, surplus, sans batterie → 9 étapes, 1 mois, Consuel bleu, rachat affiché', () => {
  const r = calculerDemarches(BASE, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.engine_version, ENGINE_VERSION);
  assert.equal(r.calcule_le, '2026-10-08');
  assert.equal(r.etapes.filter((e) => e.applicable).length, 9);
  assert.equal(r.etapes.find((e) => e.code === 'INSTRUCTION_DP').delai.libelle, '1 mois');
  assert.equal(r.consuel, 'bleu');
  assert.equal(r.rachat.applicable, true);
  assert.equal(r.rachat.tarif.valeur, 1.1);
  assert.equal(r.planning.pose_au_plus_tot, '2027-02-15');
  assert.ok(!r.alertes.some((a) => a.code === 'abf_a_verifier'));
  assert.ok(!('prime_autoconsommation' in r.parametres_utilises));
});

test('critère 2 : perimetre_abf inconnu → 2 mois + alerte', () => {
  const r = calculerDemarches({ ...BASE, perimetre_abf: 'inconnu' }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.etapes.find((e) => e.code === 'INSTRUCTION_DP').delai.libelle, '2 mois');
  assert.ok(r.alertes.some((a) => a.code === 'abf_a_verifier'));
  assert.equal(r.planning.accord_dp, '2026-12-15');
});

test('critère 5 : batterie → Consuel violet, montant à renseigner', () => {
  const r = calculerDemarches({ ...BASE, batterie: true }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.consuel, 'violet');
  assert.equal(r.frais.lignes.find((l) => l.code === 'consuel').montant_ttc, null);
  assert.ok(r.alertes.some((a) => a.code === 'parametre_manquant' && a.cle === 'tarif_consuel_violet'));
});

test('autoconsommation totale → CACSI, pas de rachat, pas de RIB, 2 mois Enedis', () => {
  const r = calculerDemarches({ ...BASE, mode_valorisation: 'autoconso_totale' }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.rachat.applicable, false);
  assert.ok(!r.pieces.find((p) => p.code === 'rib').applicable);
  assert.equal(r.etapes.find((e) => e.code === 'RACCORDEMENT_ENEDIS').delai.libelle, '2 mois');
  assert.equal(r.frais.lignes.find((l) => l.code === 'raccordement_enedis').montant_ttc, 0);
});

test('copropriété → 10 étapes applicables, accord d’AG en tête, pièces et alerte', () => {
  const r = calculerDemarches({ ...BASE, copropriete_ou_lotissement: 'copropriete' }, DEMARCHES_DEFAULTS, OPTS);
  assert.equal(r.etapes.filter((e) => e.applicable).length, 10);
  assert.equal(r.etapes[0].code, 'ACCORD_AG');
  assert.ok(r.pieces.find((p) => p.code === 'accord_ag').applicable);
  assert.ok(r.alertes.some((a) => a.code === 'copropriete_ag'));
});

test('non RGE + surplus → alerte bloquante', () => {
  const r = calculerDemarches({ ...BASE, installateur_rge: false }, DEMARCHES_DEFAULTS, OPTS);
  assert.ok(r.alertes.some((a) => a.code === 'oa_non_eligible' && a.niveau === 'bloquant'));
  assert.equal(r.rachat.eligible, false);
});

test('critère 6 : un paramètre modifié change le résultat sans autre intervention', () => {
  const params = buildDemarchesParams({ pv: { demarches: {
    delais: { instruction_dp: { mois: 2 } },
    tarifs: { frais_raccordement_enedis: [{ date_effet: '2026-10-28', valeur: 61 }] },
  } } });
  const r = calculerDemarches(BASE, params, OPTS);
  assert.equal(r.planning.accord_dp, '2026-12-15');
  assert.equal(r.frais.lignes.find((l) => l.code === 'raccordement_enedis').montant_ttc, 61);
  assert.ok(!r.alertes.some((a) => a.code === 'parametre_perime'));
});

test('traçabilité : parametres_utilises liste les tarifs résolus avec leur date d’effet', () => {
  const r = calculerDemarches(BASE, DEMARCHES_DEFAULTS, OPTS);
  assert.deepEqual(Object.keys(r.parametres_utilises).sort(), ['frais_raccordement_enedis', 'tarif_consuel_bleu', 'tarif_oa_surplus_lte_9kwc']);
  assert.equal(r.parametres_utilises.tarif_consuel_bleu.date_effet, '2026-01-01');
});

test('chaque alerte porte code, niveau et message ; chaque étape applicable porte un texte entreprise', () => {
  const r = calculerDemarches({ ...BASE, perimetre_abf: 'inconnu', batterie: true, copropriete_ou_lotissement: 'copropriete' }, DEMARCHES_DEFAULTS, OPTS);
  assert.ok(r.alertes.length >= 3);
  for (const a of r.alertes) {
    assert.ok(a.code && ['info', 'avertissement', 'bloquant'].includes(a.niveau) && a.message.length > 10);
  }
  for (const e of r.etapes.filter((x) => x.applicable)) assert.ok(e.installateur.length > 10);
});

// ── validation du bloc Settings ────────────────────────────────────────────
import { validerDemarches } from '../../src/apps/solaire/lib/demarches/parametres.js';

test('validerDemarches : défauts valides ; date d’effet vide, doublon ou prise en charge inconnue → invalide', () => {
  assert.equal(validerDemarches(DEMARCHES_DEFAULTS), true);
  assert.equal(validerDemarches(undefined), false);
  const videDate = { ...DEMARCHES_DEFAULTS, tarifs: { ...DEMARCHES_DEFAULTS.tarifs, tarif_consuel_violet: [{ date_effet: '', valeur: 250 }] } };
  assert.equal(validerDemarches(videDate), false);
  const doublon = { ...DEMARCHES_DEFAULTS, tarifs: { ...DEMARCHES_DEFAULTS.tarifs, tarif_consuel_bleu: [{ date_effet: '2026-01-01', valeur: 1 }, { date_effet: '2026-01-01', valeur: 2 }] } };
  assert.equal(validerDemarches(doublon), false);
  const delaiVide = { ...DEMARCHES_DEFAULTS, delais: { ...DEMARCHES_DEFAULTS.delais, consuel: { jours: '' } } };
  assert.equal(validerDemarches(delaiVide), false);
  const pec = { ...DEMARCHES_DEFAULTS, prise_en_charge_defaut: { raccordement_enedis: 'gratuit', consuel: 'refacture' } };
  assert.equal(validerDemarches(pec), false);
});
