// src/apps/solaire/lib/demarches/mandatModel.js
// Modèle PUR du mandat de représentation (mairie + Enedis), texte issu du brouillon
// docs/solaire/2026-10-08-mandat-representation-pv-brouillon.md. Les parties, le site et
// les signatures viennent des blocs du dossier (declarant, cadastre, consent) et de
// buildCompanyInfo(settings). Aucun calcul ; le PDF (MandatPDF.jsx) ne fait que rendre.
// ⚠️ Texte rendu en Helvetica : pas de ≤ ≥ → ni de cases Unicode (cases rendues « [x] » / « [ ] »).

/** @typedef {{ code: string, niveau: 'info'|'avertissement'|'bloquant', message: string }} Alerte */

function joinNonEmpty(parts, sep = ' ') {
  return parts.filter((p) => typeof p === 'string' && p.trim()).map((p) => p.trim()).join(sep);
}

/** ISO (date ou datetime) → JJ/MM/AAAA, '' si absent. */
function dateCourte(iso) {
  if (!iso || typeof iso !== 'string') return '';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

function adresseLigne(a) {
  if (!a) return '';
  if (typeof a === 'string') return a;
  return joinNonEmpty([joinNonEmpty([a.numero, a.voie]), a.lieudit, joinNonEmpty([a.code_postal, a.localite])], ', ');
}

/**
 * @param {object} p
 * @param {object} p.declarant  pv_dossiers.declarant (civilite, nom, prenom, date_naissance, naissance_commune, naissance_departement)
 * @param {object|string} p.adresseDeclarant adresse structurée (healAddress) ou libellé
 * @param {{ adresse: string, code_postal: string, commune: string }} p.site
 * @param {object|null} p.cadastre pv_dossiers.cadastre
 * @param {{ puissance_kwc: number, mode_valorisation: string }} p.projet
 * @param {object} p.company buildCompanyInfo(settings)
 * @param {object|null} p.consent pv_dossiers.consent
 * @param {{ numero?: string, date?: string }} p.devis
 * @param {string} p.dateLabel date d'édition (repli des dates de signature)
 */
export function buildMandatModel({ declarant, adresseDeclarant, site, cadastre, projet, company, consent, devis, dateLabel }) {
  const alertes = [];
  const soc = company?.legalName || company?.name || 'Votre entreprise';
  const surplus = projet?.mode_valorisation !== 'autoconso_totale';
  const kwc = String(projet?.puissance_kwc ?? '').replace('.', ',');

  const signataireOk = Boolean(company?.signatoryName);
  if (!signataireOk) alertes.push({ code: 'signataire_manquant', niveau: 'avertissement', message: 'Signataire de l’entreprise non renseigné (Paramètres → Organisation → Identité) : Enedis exige les deux signatures.' });
  const devisOk = Boolean(devis?.numero);
  if (!devisOk) alertes.push({ code: 'devis_manquant', niveau: 'avertissement', message: 'Numéro du devis de référence absent : le mandat ne pourra pas être rattaché à l’offre acceptée.' });
  const consentOk = Boolean(consent?.signed_at);
  if (!consentOk) alertes.push({ code: 'consentement_manquant', niveau: 'avertissement', message: 'Consentement non signé : le mandat est édité sans signature du mandant.' });

  const mandantNom = joinNonEmpty([declarant?.civilite, declarant?.prenom, declarant?.nom]);
  const naissance = joinNonEmpty([
    declarant?.date_naissance ? `né(e) le ${dateCourte(declarant.date_naissance)}` : '',
    declarant?.naissance_commune ? `à ${declarant.naissance_commune}` : '',
    declarant?.naissance_departement ? `(${declarant.naissance_departement})` : '',
  ]);
  const parcelles = cadastre?.parcelles?.length
    ? `${cadastre.parcelles.map((p) => joinNonEmpty([p.section, p.numero])).join(', ')}${cadastre.commune_insee ? ` (commune INSEE ${cadastre.commune_insee})` : ''}`
    : 'références cadastrales à préciser';
  const devisTxt = devisOk ? `n° ${devis.numero}${devis.date ? ` du ${dateCourte(devis.date)}` : ''}` : 'devis à préciser';
  const siege = joinNonEmpty([company?.address, joinNonEmpty([company?.postalCode, company?.city])], ', ');

  const articles = [
    {
      numero: 1,
      titre: 'Objet du mandat',
      paragraphes: [
        `Par le présent mandat, le Mandant donne pouvoir au Mandataire, et à lui seul, pour réaliser en son nom et pour son compte, en lien avec le projet désigné ci-dessus, les démarches, éditions de documents et signatures nécessaires auprès des administrations compétentes pour :`,
        `[x] la déclaration préalable de travaux auprès de la mairie de ${site?.commune || 'la commune du site'} (établissement du dossier, dépôt en mairie ou par le guichet numérique, réponse aux demandes de pièces complémentaires, adaptation du projet aux prescriptions éventuelles de l’Architecte des Bâtiments de France) ;`,
        surplus
          ? `[x] la demande complète de raccordement de l’installation auprès d’Enedis, gestionnaire du Réseau Public de Distribution d’électricité, avec option obligation d’achat, ainsi que la mise en service de l’installation.`
          : `[x] la convention d’autoconsommation sans injection (CACSI) auprès d’Enedis, gestionnaire du Réseau Public de Distribution d’électricité, ainsi que la mise en service de l’installation.`,
      ],
    },
    {
      numero: 2,
      titre: 'Pouvoirs du Mandataire auprès d’Enedis',
      paragraphes: [
        `Le Mandataire devient l’interlocuteur d’Enedis pour toutes les étapes du raccordement. À ce titre, il est seul destinataire des documents relatifs au déroulement de l’opération de raccordement ; Enedis se réserve toutefois le droit de prévenir le Mandant en cas de risque de sortie de file d’attente, en particulier à l’approche de l’échéance de l’offre de raccordement.`,
        `Dans le cadre de ce mandat, le Mandant donne pouvoir au Mandataire, pour le site désigné ci-dessus, de :`,
      ],
      cases: [
        { cochee: true, texte: `signer en son nom et pour son compte tout document contractuel relatif au raccordement : Proposition de Raccordement (PDR), Proposition Technico-Financière, Convention de Raccordement, Convention de Raccordement Directe, Convention d’Autoconsommation Sans Injection (CACSI), ainsi que, pour une installation de production de puissance de raccordement inférieure ou égale à 36 kVA, le Contrat d’Accès au réseau et d’Exploitation (CAE). Ces documents demeurent rédigés au nom du Mandant ; le Mandataire prend toute disposition pour assurer la pleine information du Mandant sur les clauses particulières afférentes au projet ;` },
        { cochee: true, texte: `procéder en son nom et pour son compte aux règlements financiers relatifs au raccordement. À ce titre, Enedis adressera tous documents financiers (factures, relances) au Mandataire, étant entendu que ceux-ci demeureront émis au nom du Mandant. Les frais ainsi avancés sont refacturés au Mandant selon les conditions du devis ;` },
        { cochee: false, texte: `en cas de recours à l’article L.342-2 du Code de l’énergie, exécuter le contrat de mandat et ses annexes au nom et pour le compte du Mandant.` },
      ],
      apres: [
        `En considération du présent mandat, le Mandataire pourra notamment demander auprès des services compétents d’Enedis la communication de toute information confidentielle concernant le Mandant, au sens de l’article R.111-26 du Code de l’énergie, relatif à la confidentialité des informations détenues par les gestionnaires de réseaux publics de transport ou de distribution d’électricité. Les informations communiquées ne peuvent concerner que les seules informations utiles à l’étude et à la réalisation du raccordement du site désigné, à l’exclusion de toute autre utilisation. Le Mandataire pourra également mettre fin à l’affaire de raccordement, en accord avec le Mandant.`,
      ],
    },
    {
      numero: 3,
      titre: 'Obligations qui restent à la charge du Mandant',
      paragraphes: [
        `Le Mandant est informé qu’il reste lui-même responsable des obligations annexes à sa demande d’autorisation d’urbanisme, et notamment de l’affichage sur le terrain de l’autorisation obtenue, visible depuis la voie publique, pendant toute la durée du chantier et jusqu’à la fin du délai de recours des tiers ; de l’envoi de la déclaration attestant l’achèvement et la conformité des travaux (DAACT) à la mairie à l’issue des travaux ;${surplus ? ' de la signature du contrat d’achat de l’électricité (obligation d’achat) ;' : ''} et de la transmission immédiate au Mandataire de tout courrier ou toute demande de pièces reçus directement des administrations concernées.`,
        `Le Mandant déclare être propriétaire du site ou disposer des droits nécessaires pour y réaliser les travaux et, en copropriété ou en lotissement, avoir obtenu les accords requis.`,
      ],
    },
    {
      numero: 4,
      titre: 'Protection des données',
      paragraphes: [
        `Le Mandataire utilise les informations personnelles du Mandant aux seules fins pour lesquelles elles lui ont été communiquées et ne les transmet qu’aux organismes et administrations auxquels elles sont destinées par l’objet même du mandat. Le Mandataire s’engage à respecter la réglementation relative à la protection des données personnelles (RGPD).${company?.websiteUrl ? ` Information : ${company.websiteUrl}` : ''}`,
      ],
    },
    {
      numero: 5,
      titre: 'Prise d’effet, durée et fin du mandat',
      paragraphes: [
        `Le présent mandat est donné pour le seul site désigné ci-dessus. Il est signé à l’occasion de la remise de l’offre et ne produit effet qu’à compter de l’acceptation par le Mandant du devis ${devisTxt} (ou de tout devis qui s’y substituerait pour le même site). À défaut d’acceptation du devis dans un délai de douze mois à compter de sa signature, il est caduc de plein droit.`,
        `Il est valable pour les demandes exprimées dans l’année qui suit sa prise d’effet et prend fin lors de la mise en service de l’installation de production, ou de la modification de sa puissance de raccordement, ou de la mise à disposition par Enedis des ouvrages de raccordement. Le Mandant peut y mettre fin à tout moment par écrit ; en cas de changement de mandataire en cours de traitement d’une demande de raccordement, il en informe Enedis par écrit.`,
      ],
    },
    {
      numero: 6,
      titre: 'Responsabilité',
      paragraphes: [
        `Le Mandataire ne peut être tenu pour responsable des délais de réponse et d’exécution des administrations et organismes impliqués (mairie, Architecte des Bâtiments de France, Enedis ou ses prestataires, Consuel, acheteur obligé), ni des conséquences d’informations erronées qui lui auraient été communiquées, ni du tarif d’achat appliqué par l’acheteur obligé à l’électricité produite, celui-ci étant seul décisionnaire en la matière.`,
        `Le présent mandat n’emporte pas pouvoir de représenter le Mandant en justice ni de former un recours contre une décision administrative.`,
      ],
    },
  ];

  const dateSignature = consentOk ? dateCourte(consent.signed_at) : dateLabel;
  return {
    titre: 'Mandat spécial de représentation',
    sousTitre: 'pour les démarches administratives relatives à l’installation photovoltaïque et au raccordement du site au Réseau Public de Distribution d’électricité',
    mandant: {
      nom: mandantNom || 'Mandant à préciser',
      naissance,
      domicile: adresseLigne(adresseDeclarant),
    },
    mandataire: {
      denomination: joinNonEmpty([soc, company?.legalForm ? `(${company.legalForm}${company?.capital ? `, capital de ${company.capital} €` : ''})` : '']),
      siege,
      rcs: joinNonEmpty([company?.rcs ? `RCS ${company.rcs}` : '', company?.siret ? `SIRET ${company.siret}` : ''], ' — '),
      signataire: signataireOk
        ? joinNonEmpty([company.signatoryName, company.signatoryRole ? `en qualité de ${company.signatoryRole}` : ''], ', ')
        : 'représentant à renseigner',
    },
    site: {
      adresse: joinNonEmpty([site?.adresse, joinNonEmpty([site?.code_postal, site?.commune])], ', '),
      parcelles,
      nature: `raccordement de logement individuel d’une installation de production photovoltaïque en toiture, puissance crête ${kwc} kWc, ${surplus ? 'autoconsommation avec vente du surplus' : 'autoconsommation totale sans injection'}`,
      devis: `Devis de référence : ${devisTxt}`,
    },
    articles,
    signatures: {
      mandant: { nom: consent?.signataire_nom || mandantNom, lieu: consent?.lieu || '', date: dateSignature },
      mandataire: { nom: signataireOk ? company.signatoryName : '', lieu: company?.city || '', date: dateSignature },
    },
    mentionExemplaires: 'Fait en deux exemplaires originaux, dont un est remis à chacune des Parties, qui reconnaît en avoir reçu communication.',
    alertes,
  };
}
