import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, Sparkles, Filter, BarChart3 } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import EditorTab from '@apps/artisan/components/mailing/EditorTab';
import SegmentsTab from '@apps/artisan/components/mailing/SegmentsTab';
import StatsTab from '@apps/artisan/components/mailing/StatsTab';
import PageMail from '@apps/artisan/components/mailing/page/PageMail';

const ONGLETS = ['campagnes', 'stats', 'segments'];

/** Onglet demandé par l'adresse. Les anciens liens (`send`, `editor`) mènent aux Campagnes. */
const ongletDe = (demande) => (ONGLETS.includes(demande) ? demande : 'campagnes');

export default function Mailing() {
  const { isOrgAdmin } = useAuth();
  // ?mail=<id> | nouveau : la page d'un mail, à la place des onglets (droits vérifiés par la page).
  // ?tab=editor&edit=<clé> (Réglages → E-mails & SMS, « Modifier le texte ») : ouvre ce mail depuis les Campagnes.
  const [searchParams, setSearchParams] = useSearchParams();
  const ongletDemande = searchParams.get('tab');
  const mailId = searchParams.get('mail');
  const [tab, setTab] = useState(() => ongletDe(ongletDemande));
  useEffect(() => {
    setTab(ongletDe(ongletDemande));
  }, [ongletDemande]);

  if (mailId) {
    return (
      <PageMail
        mailId={mailId}
        onRetour={() => { setTab('campagnes'); setSearchParams({}); }}
        onCree={(id) => setSearchParams({ mail: id }, { replace: true })}
      />
    );
  }

  // Stats et Segments : administrateur seul ; un autre rôle n'a que les Campagnes (celles qu'il peut envoyer).
  const onglet = isOrgAdmin ? tab : 'campagnes';

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 flex items-center gap-3">
          <Mail className="w-7 h-7 text-secondary-400" />
          Mailing
        </h1>
      </div>

      {isOrgAdmin && (
        <div className="flex gap-1 border-b">
          <TabButton active={onglet === 'campagnes'} onClick={() => setTab('campagnes')}>
            <Sparkles className="w-4 h-4 mr-2" />
            Campagnes
          </TabButton>
          <TabButton active={onglet === 'stats'} onClick={() => setTab('stats')}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Stats
          </TabButton>
          <TabButton active={onglet === 'segments'} onClick={() => setTab('segments')}>
            <Filter className="w-4 h-4 mr-2" />
            Segments
          </TabButton>
        </div>
      )}

      {onglet === 'campagnes' && <EditorTab />}
      {onglet === 'stats' && <StatsTab />}
      {onglet === 'segments' && <SegmentsTab />}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? 'border-primary-600 text-primary-700'
          : 'border-transparent text-secondary-500 hover:text-secondary-700'
      }`}
    >
      {children}
    </button>
  );
}
