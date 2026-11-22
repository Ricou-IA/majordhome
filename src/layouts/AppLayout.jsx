import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@contexts/AuthContext';
import { useCanAccess } from '@hooks/usePermissions';
import { useOrgSettings } from '@hooks/useOrgSettings';
import { moduleActif, peutOuvrirParametres } from '@/lib/modules';
import { grouperMenu, lirePreferencesMenu, raccourcisBarre, cleMenuReplie } from '@/lib/menuGroupes';
import { actionsCreer } from '@/lib/rechercheGlobale';
import { RechercheGlobale } from '@components/navigation/RechercheGlobale';
import { BarreDuBas } from '@components/navigation/BarreDuBas';
import { BarreLaterale } from './BarreLaterale';
import { vocabulaire } from '@/lib/maintenance/vocabulaire';
import { AppUpdateWatcher } from '@components/AppUpdateWatcher';
import {
  LayoutDashboard,
  Calendar,
  Users,
  MapPin,
  Kanban,
  HardHat,
  Wrench,
  Factory,
  Target,
  Grid3x3,
  Mail,
  FileText,
  Megaphone,
  Sun,
  ShoppingCart,
  Thermometer,
  ClipboardCheck,
  Snowflake,
  ClipboardList,
  Search,
} from 'lucide-react';
import { chantierGaillacVisible } from '@apps/chantier-gaillac/config';

// =============================================================================
// CONFIGURATION NAVIGATION
// =============================================================================

// `groupe` = clé de GROUPES_MENU (src/lib/menuGroupes.js). Au-delà de 8 entrées visibles le
// menu se range en groupes repliables ; en dessous il reste cette liste, dans cet ordre.
// Toute nouvelle entrée porte son groupe (scripts/menu-groupes.test.mjs le vérifie).
const navigation = [
  { name: 'Accueil',    href: '/',           icon: LayoutDashboard, resource: 'dashboard', groupe: 'quotidien' },
  { name: 'Planning',   href: '/planning',   icon: Calendar,        resource: 'planning', groupe: 'quotidien' },
  { name: 'Clients',    href: '/clients',    icon: Users,           resource: 'clients', groupe: 'ventes' },
  { name: 'Carte',      href: '/territoire', icon: MapPin,          resource: 'territoire', groupe: 'outils' },
  { name: 'Leads',      href: '/pipeline',   icon: Kanban,          resource: 'pipeline', groupe: 'ventes' },
  { name: 'Boutique',   href: '/webshop',    icon: ShoppingCart,    resource: 'pipeline', module: 'webshop', groupe: 'ventes' },
  { name: 'Chantiers',  href: '/chantiers',  icon: HardHat,         resource: 'chantiers', groupe: 'terrain' },
  { name: 'Contrats',   href: '/contrats',   icon: FileText,        resource: 'entretiens', module: 'entretiens', groupe: 'ventes' },
  { name: 'Entretiens', href: '/entretiens', icon: Wrench,          resource: 'entretiens', module: 'entretiens', groupe: 'terrain' },
  { name: 'Cédants',    href: '/cedants',    icon: Factory,         resource: 'cedants', module: 'cedants', groupe: 'developpement' },
  { name: 'Prospection', href: '/prospection', icon: Target,        resource: 'prospection_commerciale', module: 'prospection', groupe: 'developpement' },
  { name: 'Visibilité locale', href: '/geogrid', icon: Grid3x3,     resource: 'settings', module: 'geogrid', groupe: 'outils' },
  { name: 'Messages',    href: '/mailing',     icon: Mail,          resource: 'settings', module: 'communication', groupe: 'ventes' },
  { name: 'Publicité',   href: '/meta-ads',    icon: Megaphone,     resource: 'meta_ads', module: 'meta_ads', groupe: 'outils' },
  { name: 'Solaire',     href: '/solaire',     icon: Sun,           resource: 'pv_calculator', module: 'solaire', groupe: 'etudes' },
  { name: 'Thermique',   href: '/thermique',   icon: Thermometer,   resource: 'thermal_study', module: 'thermique', groupe: 'etudes' },
  // Dimensionnement clim : module activable, ouvert à qui voit les devis.
  { name: 'Climatisation', href: '/clim',      icon: Snowflake,     resource: 'devis', module: 'climatisation', groupe: 'etudes' },
  // Tâches récurrentes : libellé = vocabulaire de l'org (« Maintenance », « Traçabilité »…).
  { name: 'Maintenance', href: '/maintenance', icon: ClipboardCheck, resource: 'maintenance', module: 'maintenance', groupe: 'terrain' },
  // Module PROVISOIRE : visible des membres Mayer tant que CHANTIER_GAILLAC_ACTIF (hors registre de droits)
  { name: 'Chantier Gaillac', href: '/chantier-gaillac', icon: ClipboardList, visible: chantierGaillacVisible, groupe: 'terrain' },
];

/**
 * Un item de navigation est-il affiché pour cette org ? Son module (catalogue
 * src/lib/modules.js, ouvert ou fermé depuis Baikal) doit être ouvert ; un item sans
 * `module` appartient au CRM artisan.
 */
const itemVisiblePourOrg = (item, settings) => moduleActif(settings, item.module || 'crm');

/** Choix de repli des groupes du menu, lus sur l'appareil (aucun si le stockage est indisponible). */
function lireReplisMenu(cle) {
  try {
    return lirePreferencesMenu(cle ? window.localStorage.getItem(cle) : null);
  } catch {
    return {};
  }
}

/** Badge du rôle sous le nom de l'entreprise (rien pour un rôle inconnu). */
const LIBELLES_ROLE = { org_admin: 'Admin', team_leader: 'Responsable', commercial: 'Commercial', technicien: 'Technicien' };

/** Menu replié (icônes seules) ? Lu sur l'appareil ; déplié si le stockage est indisponible. */
function lireMenuReplie(cle) {
  try {
    return Boolean(cle) && window.localStorage.getItem(cle) === 'true';
  } catch {
    return false;
  }
}

// =============================================================================
// APP LAYOUT
// =============================================================================

export default function AppLayout() {
  const navigate = useNavigate();
  const { user, profile, organization, effectiveRole, signOut } = useAuth();
  const { can } = useCanAccess();
  const { settings: orgSettings } = useOrgSettings();
  // Paramètres : admins, ou un rôle qui a une tuile à droit (team_leader → Fournisseurs & catalogue, Eric 2026-10-27)
  const peutOuvrirReglages = can('settings', 'view') || peutOuvrirParametres(orgSettings, { isOrgAdmin: false, can });

  // État sidebar mobile
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // État menu du profil (pied du menu, en bas à droite)
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Menu : entrées visibles pour cette personne, rangées en groupes au-delà d'un menu court.
  const { pathname } = useLocation();
  const entreesVisibles = navigation.filter((item) => (item.visible
    ? item.visible(organization)
    : itemVisiblePourOrg(item, orgSettings) && can(item.resource, 'view')));
  const groupesDuMenu = grouperMenu(entreesVisibles);
  // Groupes repliés ou dépliés par la personne, gardés sur son appareil (clé par utilisateur :
  // cette coque n'est montée qu'une fois la personne connue, et démontée à la déconnexion).
  const cleReplisMenu = user?.id ? `menu-groupes:${user.id}` : null;
  const [replisMenu, setReplisMenu] = useState(() => lireReplisMenu(cleReplisMenu));
  // Menu replié à 64 px (icônes seules) : ordinateur et tablette, choix gardé par utilisateur.
  const cleReplie = user?.id ? cleMenuReplie(user.id) : null;
  const [menuReplie, setMenuReplie] = useState(() => lireMenuReplie(cleReplie));
  const libelleEntree = (item) => (item.module === 'maintenance' ? vocabulaire(orgSettings).module : item.name);

  // Recherche globale (Ctrl K ou ⌘ K, bouton du menu) et menu « Créer ». Clients, leads et
  // RDV appartiennent au CRM : une entreprise sans ce module ne cherche que des pages.
  const [rechercheOuverte, setRechercheOuverte] = useState(false);
  const crmActif = moduleActif(orgSettings, 'crm');
  const pagesDuMenu = [
    ...groupesDuMenu.flatMap((groupe) => groupe.items).map((item) => ({
      name: libelleEntree(item),
      href: item.href,
    })),
    ...(peutOuvrirReglages ? [{ name: 'Paramètres', href: '/settings' }] : []),
  ];
  const creations = actionsCreer({
    rdv: crmActif && can('planning', 'create'),
    lead: crmActif && can('pipeline', 'create'),
    client: crmActif && can('clients', 'create'),
  });
  // Téléphone : pages du quotidien en accès direct dans la barre du bas, selon les droits.
  const raccourcis = raccourcisBarre(entreesVisibles, { avecCreer: creations.length > 0 }).map((item) => (
    item.module === 'maintenance' ? { ...item, name: vocabulaire(orgSettings).module } : item
  ));
  useEffect(() => {
    const surTouche = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setRechercheOuverte(true);
      }
    };
    window.addEventListener('keydown', surTouche);
    return () => window.removeEventListener('keydown', surTouche);
  }, []);

  // ===========================================================================
  // HANDLERS
  // ===========================================================================

  const basculerGroupe = (cle, ouvert) => {
    const suivant = { ...replisMenu, [cle]: !ouvert };
    setReplisMenu(suivant);
    try {
      if (cleReplisMenu) window.localStorage.setItem(cleReplisMenu, JSON.stringify(suivant));
    } catch {
      // Stockage indisponible (navigation privée) : le choix vaut pour cette visite.
    }
  };

  const basculerMenuReplie = () => {
    const suivant = !menuReplie;
    setMenuReplie(suivant);
    try {
      if (cleReplie) window.localStorage.setItem(cleReplie, String(suivant));
    } catch {
      // Stockage indisponible : le choix vaut pour cette visite.
    }
  };

  const ouvrirRecherche = () => {
    setSidebarOpen(false);
    setUserMenuOpen(false);
    setRechercheOuverte(true);
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  // Ferme le tiroir mobile ET le menu du profil (lien suivi, clic hors du tiroir)
  const closeSidebar = () => {
    setSidebarOpen(false);
    setUserMenuOpen(false);
  };

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  const getUserDisplayName = () => {
    if (profile?.full_name) return profile.full_name;
    if (user?.user_metadata?.full_name) return user.user_metadata.full_name;
    if (user?.email) return user.email.split('@')[0];
    return 'Utilisateur';
  };

  const getUserInitials = () => {
    const name = getUserDisplayName();
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // ===========================================================================
  // RENDER SIDEBAR
  // ===========================================================================

  const renderSidebar = (options = {}) => (
    <BarreLaterale
      groupes={groupesDuMenu}
      replisMenu={replisMenu}
      onBasculerGroupe={basculerGroupe}
      pathname={pathname}
      libelleEntree={libelleEntree}
      organization={organization}
      libelleRole={LIBELLES_ROLE[effectiveRole] || null}
      creations={creations}
      onOuvrirRecherche={ouvrirRecherche}
      onNaviguer={closeSidebar}
      peutOuvrirReglages={peutOuvrirReglages}
      profil={{ nom: getUserDisplayName(), initiales: getUserInitials(), email: user?.email }}
      menuProfilOuvert={userMenuOpen}
      onMenuProfil={setUserMenuOpen}
      onSeDeconnecter={handleSignOut}
      {...options}
    />
  );

  // ===========================================================================
  // RENDER
  // ===========================================================================

  return (
    <div className="min-h-screen bg-secondary-50">
      {/* Sidebar Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* Sidebar Mobile — tiroir, jamais plus large que 85 % de l'écran pour
          laisser l'overlay tapable (fermeture au doigt) */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        aria-hidden={!sidebarOpen}
        className={`fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-300 ease-out lg:hidden ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {renderSidebar()}
      </div>

      {/* Sidebar Desktop — repliable à 64 px (icônes seules) */}
      <div className={`hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-40 lg:block ${menuReplie ? 'lg:w-16' : 'lg:w-64'}`}>
        {renderSidebar({ replie: menuReplie, onBasculerReplie: basculerMenuReplie })}
      </div>

      {/* Main Content */}
      <div className={menuReplie ? 'lg:pl-16' : 'lg:pl-64'}>
        {/* Bandeau du haut : téléphone seulement — le nom de l'entreprise et la recherche. Le
            menu s'ouvre par « Plus » dans la barre du bas. Dès que le menu est affiché en
            permanence (lg, tablettes comprises), bandeau et barre disparaissent. */}
        <header className="sticky top-0 z-30 bg-white border-b border-secondary-200 lg:hidden">
          <div className="flex items-center justify-between h-14 px-3 sm:px-6">
            <p className="min-w-0 truncate px-1 text-sm font-semibold text-secondary-900">
              {organization?.name || 'Majord’home'}
            </p>
            <button
              onClick={ouvrirRecherche}
              aria-label="Rechercher un client, un lead, une page"
              className="h-11 w-11 -mr-1 flex items-center justify-center rounded-lg text-secondary-600 hover:bg-secondary-100"
            >
              <Search className="w-6 h-6" />
            </button>
          </div>
        </header>

        {/* Page Content — sur téléphone, marge basse = hauteur de la barre du bas plus la zone
            de sécurité iOS (barre d'accueil) : le bas de la page ne passe jamais dessous. */}
        <main className="p-4 sm:p-6 lg:p-8 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-8">
          <Outlet />
        </main>
      </div>

      {/* Téléphone : pages du quotidien, « Créer » et menu complet sous le pouce */}
      <BarreDuBas
        raccourcis={raccourcis}
        creations={creations}
        pathname={pathname}
        menuOuvert={sidebarOpen}
        onOuvrirMenu={() => setSidebarOpen(true)}
      />

      {rechercheOuverte && (
        <RechercheGlobale
          orgId={organization?.id}
          peutChercherClients={crmActif && can('clients', 'view')}
          peutChercherLeads={crmActif && can('pipeline', 'view')}
          pages={pagesDuMenu}
          onClose={() => setRechercheOuverte(false)}
        />
      )}

      {/* Nouvelle version déployée : bouton « Mettre à jour », rechargement au changement de page */}
      <AppUpdateWatcher />
    </div>
  );
}
