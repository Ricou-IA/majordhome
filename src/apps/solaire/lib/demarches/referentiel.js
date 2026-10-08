// src/apps/solaire/lib/demarches/referentiel.js
// Les étapes du parcours administratif PV (spec §3 d'origine + accord d'AG en copropriété).
// Chaque texte est une fonction du contexte pour porter les variantes (mode de
// valorisation, société, copropriété) sans dupliquer d'étapes. PUR.
//
// ctx = { societe, mode_valorisation: 'autoconso_totale'|'autoconso_surplus',
//         copropriete_ou_lotissement, instructionCle, enedisCle }

const surplus = (ctx) => ctx.mode_valorisation === 'autoconso_surplus';

/**
 * @typedef {object} Etape
 * @property {string} code
 * @property {string} libelle
 * @property {string|null} tiers
 * @property {(ctx: object) => string|null} client   ce que fait le client
 * @property {(ctx: object) => string} installateur  ce que fait l'entreprise
 * @property {(ctx: object) => string|null} delaiCle clé de params.delais ou null
 * @property {(ctx: object) => boolean} applicable
 */

/** @type {Etape[]} */
export const ETAPES = [
  {
    code: 'ACCORD_AG', libelle: 'Accord de l’assemblée générale', tiers: 'Syndic de copropriété',
    client: () => 'Fait inscrire le projet à l’ordre du jour de l’assemblée générale et obtient son accord écrit.',
    installateur: (ctx) => `${ctx.societe} fournit la description technique et les visuels nécessaires au vote.`,
    delaiCle: () => null,
    applicable: (ctx) => ctx.copropriete_ou_lotissement === 'copropriete',
  },
  {
    code: 'ETUDE_DEVIS', libelle: 'Étude et devis', tiers: null,
    client: () => 'Transmet ses factures d’électricité. Signe le devis et le mandat de représentation.',
    installateur: (ctx) => `${ctx.societe} réalise la visite technique, l’étude de production et le devis. Vérifie le PLU et les abords de monuments historiques.`,
    delaiCle: () => null,
    applicable: () => true,
  },
  {
    code: 'DEPOT_DP', libelle: 'Déclaration préalable', tiers: 'Mairie',
    client: () => 'Signe la déclaration préalable (il reste le déclarant) ; le dépôt est fait pour lui par mandat.',
    installateur: (ctx) => `${ctx.societe} monte le dossier (Cerfa 16702, DP1, DP2, DP4, DP6, DP7/DP8, fiches techniques) et le dépose en mairie ou en ligne.`,
    delaiCle: () => null,
    applicable: () => true,
  },
  {
    code: 'INSTRUCTION_DP', libelle: 'Instruction', tiers: 'Mairie, ABF',
    client: () => 'Transmet tout courrier de la mairie.',
    installateur: (ctx) => `${ctx.societe} répond aux demandes de pièces et adapte le projet aux prescriptions de l’Architecte des Bâtiments de France.`,
    delaiCle: (ctx) => ctx.instructionCle,
    applicable: () => true,
  },
  {
    code: 'ACCORD_AFFICHAGE', libelle: 'Accord et affichage', tiers: null,
    client: () => 'Affiche l’accord sur le terrain, visible de la rue, pendant tout le chantier.',
    installateur: (ctx) => `${ctx.societe} commande le matériel et planifie le chantier.`,
    delaiCle: () => 'recours_tiers',
    applicable: () => true,
  },
  {
    code: 'RACCORDEMENT_ENEDIS', libelle: 'Raccordement Enedis', tiers: 'Enedis',
    client: (ctx) => (surplus(ctx)
      ? 'Valide l’offre de raccordement. Les frais Enedis sont avancés puis refacturés selon le devis.'
      : 'Aucune action : la convention d’autoconsommation sans injection est signée par mandat.'),
    installateur: (ctx) => (surplus(ctx)
      ? `${ctx.societe} dépose par mandat la demande complète de raccordement avec option obligation d’achat sur Enedis Connect.`
      : `${ctx.societe} signe par mandat la convention CACSI (autoconsommation sans injection) sur Enedis Connect.`),
    delaiCle: (ctx) => ctx.enedisCle,
    applicable: () => true,
  },
  {
    code: 'INSTALLATION', libelle: 'Installation', tiers: null,
    client: () => 'Donne accès à la toiture et au tableau électrique. Signe le procès-verbal de réception.',
    installateur: (ctx) => `${ctx.societe} pose les panneaux, l’onduleur et la batterie éventuelle, puis réalise les essais.`,
    delaiCle: () => 'duree_pose',
    applicable: () => true,
  },
  {
    code: 'CONSUEL', libelle: 'Contrôle Consuel', tiers: 'Consuel',
    client: () => null,
    installateur: (ctx) => `${ctx.societe} obtient l’attestation Consuel (visa bleu, ou violet avec batterie).`,
    delaiCle: () => 'consuel',
    applicable: () => true,
  },
  {
    code: 'MISE_EN_SERVICE', libelle: 'Mise en service', tiers: 'Enedis',
    client: () => 'Présent si Enedis doit intervenir sur le compteur.',
    installateur: (ctx) => `${ctx.societe} transmet l’attestation Consuel à Enedis.`,
    delaiCle: () => 'mise_en_service',
    applicable: () => true,
  },
  {
    code: 'CONTRAT_CLOTURE', libelle: 'Contrat et clôture', tiers: 'EDF OA, Mairie',
    client: (ctx) => (surplus(ctx)
      ? 'Signe le contrat de rachat du surplus (EDF OA). Envoie la DAACT (Cerfa 13408) à la mairie.'
      : 'Envoie la DAACT (Cerfa 13408) à la mairie.'),
    installateur: (ctx) => `${ctx.societe} fournit l’attestation S21 et remet le dossier d’ouvrage (garanties, schémas, PV, attestations).`,
    delaiCle: () => null,
    applicable: () => true,
  },
];
