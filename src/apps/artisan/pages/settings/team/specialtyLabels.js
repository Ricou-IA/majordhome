// src/apps/artisan/pages/settings/team/specialtyLabels.js
// Libellés des catégories d'équipement (compétences techniciens). Hors composant
// pour rester compatible Fast Refresh (react-refresh/only-export-components).
const LABELS = {
  climatisation: 'Clim',
  poele: 'Poêle',
  pac_air_air: 'PAC air/air',
  pac_air_eau: 'PAC air/eau',
  chaudiere_gaz: 'Chaudière gaz',
  chaudiere_fioul: 'Chaudière fioul',
  chaudiere_bois: 'Chaudière bois',
  chaudiere_granules: 'Chaudière granulés',
  vmc: 'VMC',
  chauffe_eau_thermo: 'Chauffe-eau thermo',
  ballon_ecs: 'Ballon ECS',
  autre: 'Autre',
};

export const specialtyLabel = (cat) => LABELS[cat] || cat;
