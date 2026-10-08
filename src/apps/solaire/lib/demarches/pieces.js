// src/apps/solaire/lib/demarches/pieces.js
// Checklist des pièces à collecter auprès du client (spec §6.8). PUR.
// Toutes les pièces sont listées avec `applicable` ; le statut (a_demander / recue /
// non_applicable) est porté par l'UI dans pv_dossiers.demarches.pieces_statut.

const PIECES = [
  { code: 'factures_12_mois', libelle: 'Factures d’électricité des 12 derniers mois', condition: null },
  { code: 'numero_pdl', libelle: 'Numéro de point de livraison (PDL / PRM, sur la facture)', condition: null },
  { code: 'justificatif_propriete', libelle: 'Justificatif de propriété (taxe foncière ou acte)', condition: null },
  { code: 'piece_identite_declarant', libelle: 'Pièce d’identité du déclarant', condition: null },
  { code: 'mandat_signe', libelle: 'Mandat de représentation signé', condition: null },
  { code: 'rib', libelle: 'RIB (versement du rachat du surplus)', condition: 'vente du surplus' },
  { code: 'reglement_copropriete', libelle: 'Règlement de copropriété', condition: 'copropriété' },
  { code: 'accord_ag', libelle: 'Procès-verbal d’assemblée générale autorisant les travaux', condition: 'copropriété' },
  { code: 'reglement_lotissement', libelle: 'Règlement ou cahier des charges du lotissement', condition: 'lotissement' },
];

function estApplicable(piece, inputs) {
  switch (piece.condition) {
    case null: return true;
    case 'vente du surplus': return inputs.mode_valorisation === 'autoconso_surplus';
    case 'copropriété': return inputs.copropriete_ou_lotissement === 'copropriete';
    case 'lotissement': return inputs.copropriete_ou_lotissement === 'lotissement';
    default: return false;
  }
}

/**
 * @param {object} inputs
 * @returns {Array<{ code: string, libelle: string, applicable: boolean, condition: string|null }>}
 */
export function listerPieces(inputs) {
  return PIECES.map((p) => ({ ...p, applicable: estApplicable(p, inputs) }));
}
