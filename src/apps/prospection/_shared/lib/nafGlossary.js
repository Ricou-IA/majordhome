/**
 * nafGlossary.js — Glossaire NAF organisé par sections
 * Codes pertinents pour la prospection artisans BTP/CVC et secteurs connexes.
 * Source : INSEE NAF Rev.2
 */

// ============================================================================
// GLOSSAIRE PAR SECTIONS
// ============================================================================

export const NAF_SECTIONS = [
  {
    code: 'F',
    label: 'Construction / BTP',
    icon: '🏗️',
    groups: [
      {
        label: 'Génie climatique & Plomberie',
        highlightFor: ['cedants'], // Cédants : concurrents / cibles d'acquisition
        codes: [
          { code: '43.22A', label: 'Travaux d\'installation d\'eau et de gaz' },
          { code: '43.22B', label: 'Travaux d\'installation d\'équipements thermiques et de climatisation' },
          { code: '43.21A', label: 'Travaux d\'installation électrique dans tous locaux' },
          { code: '43.21B', label: 'Travaux d\'installation électrique sur la voie publique' },
          { code: '43.29A', label: 'Travaux d\'isolation' },
        ],
      },
      {
        label: 'Construction de bâtiments',
        highlightFor: ['commercial'], // Commercial : promoteurs = clients potentiels
        codes: [
          { code: '41.20A', label: 'Construction de maisons individuelles' },
          { code: '41.20B', label: 'Construction d\'autres bâtiments' },
          { code: '41.10A', label: 'Promotion immobilière de logements' },
          { code: '41.10B', label: 'Promotion immobilière de bureaux' },
          { code: '41.10C', label: 'Promotion immobilière d\'autres bâtiments' },
          { code: '41.10D', label: 'Supports juridiques de programmes' },
        ],
      },
      {
        label: 'Génie civil',
        codes: [
          { code: '42.11Z', label: 'Construction de routes et autoroutes' },
          { code: '42.12Z', label: 'Construction de voies ferrées et de métro' },
          { code: '42.13A', label: 'Construction d\'ouvrages d\'art' },
          { code: '42.13B', label: 'Construction et entretien de tunnels' },
          { code: '42.21Z', label: 'Construction de réseaux pour fluides' },
          { code: '42.22Z', label: 'Construction de réseaux électriques et de télécommunications' },
          { code: '42.91Z', label: 'Construction d\'ouvrages maritimes et fluviaux' },
          { code: '42.99Z', label: 'Construction d\'autres ouvrages de génie civil n.c.a.' },
        ],
      },
      {
        label: 'Travaux de finition',
        codes: [
          { code: '43.31Z', label: 'Travaux de plâtrerie' },
          { code: '43.32A', label: 'Travaux de menuiserie bois et PVC' },
          { code: '43.32B', label: 'Travaux de menuiserie métallique et serrurerie' },
          { code: '43.32C', label: 'Agencement de lieux de vente' },
          { code: '43.33Z', label: 'Travaux de revêtement des sols et des murs' },
          { code: '43.34Z', label: 'Travaux de peinture et vitrerie' },
          { code: '43.39Z', label: 'Autres travaux de finition' },
        ],
      },
      {
        label: 'Autres travaux spécialisés',
        codes: [
          { code: '43.11Z', label: 'Travaux de démolition' },
          { code: '43.12A', label: 'Travaux de terrassement courants et travaux préparatoires' },
          { code: '43.12B', label: 'Travaux de terrassement spécialisés ou de grande masse' },
          { code: '43.13Z', label: 'Forages et sondages' },
          { code: '43.29B', label: 'Autres travaux d\'installation n.c.a.' },
          { code: '43.91A', label: 'Travaux de charpente' },
          { code: '43.91B', label: 'Travaux de couverture par éléments' },
          { code: '43.99A', label: 'Travaux d\'étanchéification' },
          { code: '43.99B', label: 'Travaux de montage de structures métalliques' },
          { code: '43.99C', label: 'Travaux de maçonnerie générale et gros œuvre de bâtiment' },
          { code: '43.99D', label: 'Autres travaux spécialisés de construction' },
          { code: '43.99E', label: 'Location avec opérateur de matériel de construction' },
        ],
      },
    ],
  },
  {
    code: 'G',
    label: 'Commerce',
    icon: '🏪',
    groups: [
      {
        label: 'Commerce de gros matériel CVC / sanitaire',
        highlightFor: ['cedants'], // Cédants : filière amont à acquérir
        codes: [
          { code: '46.43Z', label: 'Commerce de gros d\'appareils électroménagers' },
          { code: '46.74A', label: 'Commerce de gros de quincaillerie' },
          { code: '46.74B', label: 'Commerce de gros de fournitures pour la plomberie et le chauffage' },
          { code: '46.69B', label: 'Commerce de gros de fournitures et équipements industriels divers' },
          { code: '46.69C', label: 'Commerce de gros de fournitures et équipements divers pour le commerce et les services' },
        ],
      },
      {
        label: 'Commerce de détail bricolage / équipement',
        codes: [
          { code: '47.52A', label: 'Commerce de détail de quincaillerie, peintures et verres' },
          { code: '47.52B', label: 'Commerce de détail de bricolage' },
          { code: '47.54Z', label: 'Commerce de détail d\'appareils électroménagers' },
          { code: '47.59B', label: 'Commerce de détail d\'autres équipements du foyer' },
        ],
      },
    ],
  },
  {
    code: 'M',
    label: 'Activités scientifiques & techniques',
    icon: '📐',
    groups: [
      {
        label: 'Architecture & ingénierie',
        highlightFor: ['commercial'], // Commercial : prescripteurs qui recommandent des artisans CVC
        codes: [
          { code: '71.11Z', label: 'Activités d\'architecture' },
          { code: '71.12A', label: 'Activité des géomètres' },
          { code: '71.12B', label: 'Ingénierie, études techniques' },
          { code: '71.20A', label: 'Contrôle technique automobile' },
          { code: '71.20B', label: 'Analyses, essais et inspections techniques' },
        ],
      },
    ],
  },
  {
    code: 'L',
    label: 'Activités immobilières',
    icon: '🏠',
    groups: [
      {
        label: 'Immobilier',
        highlightFor: ['commercial'], // Commercial : syndics, gestionnaires = clients CVC
        codes: [
          { code: '68.10Z', label: 'Activités des marchands de biens immobiliers' },
          { code: '68.20A', label: 'Location de logements' },
          { code: '68.20B', label: 'Location de terrains et d\'autres biens immobiliers' },
          { code: '68.31Z', label: 'Agences immobilières' },
          { code: '68.32A', label: 'Administration d\'immeubles et autres biens immobiliers' },
          { code: '68.32B', label: 'Supports juridiques de gestion de patrimoine immobilier' },
        ],
      },
    ],
  },
  {
    code: 'C',
    label: 'Industrie manufacturière',
    icon: '🏭',
    groups: [
      {
        label: 'Fabrication équipements CVC',
        highlightFor: ['cedants'], // Cédants : intégration verticale
        codes: [
          { code: '25.21Z', label: 'Fabrication de radiateurs et de chaudières pour le chauffage central' },
          { code: '27.51Z', label: 'Fabrication d\'appareils électroménagers' },
          { code: '28.25Z', label: 'Fabrication d\'équipements aérauliques et frigorifiques industriels' },
          { code: '28.21Z', label: 'Fabrication de fours et brûleurs' },
        ],
      },
    ],
  },
  {
    code: 'N',
    label: 'Services administratifs & soutien',
    icon: '📋',
    groups: [
      {
        label: 'Location matériel / nettoyage',
        codes: [
          { code: '77.32Z', label: 'Location et location-bail de machines et équipements pour la construction' },
          { code: '81.22Z', label: 'Autres activités de nettoyage des bâtiments et nettoyage industriel' },
          { code: '81.29A', label: 'Désinfection, désinsectisation, dératisation' },
          { code: '81.29B', label: 'Autres activités de nettoyage n.c.a.' },
        ],
      },
    ],
  },
];

// ============================================================================
// FLAT LIST (pour recherche rapide)
// ============================================================================

/** Liste plate de tous les codes NAF avec leur libellé */
export const NAF_FLAT_LIST = NAF_SECTIONS.flatMap((section) =>
  section.groups.flatMap((group) =>
    group.codes.map((c) => ({
      code: c.code,
      label: c.label,
      section: section.label,
      group: group.label,
      highlightFor: group.highlightFor || [],
    }))
  )
);

/** Map code → libellé pour lookup rapide */
export const NAF_LABELS = Object.fromEntries(
  NAF_FLAT_LIST.map((c) => [c.code, c.label])
);

/**
 * Recherche dans le glossaire NAF (code ou libellé).
 * @param {string} query - Terme de recherche
 * @returns {Array} Résultats filtrés
 */
export function searchNafCodes(query) {
  if (!query || query.length < 2) return [];
  const q = query.toLowerCase();
  return NAF_FLAT_LIST.filter(
    (c) => c.code.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)
  );
}
