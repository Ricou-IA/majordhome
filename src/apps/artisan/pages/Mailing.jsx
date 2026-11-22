import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Mail, Send, Sparkles, Filter, BarChart3 } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import SendTab from '@apps/artisan/components/mailing/SendTab';
import EditorTab from '@apps/artisan/components/mailing/EditorTab';
import SegmentsTab from '@apps/artisan/components/mailing/SegmentsTab';
import StatsTab from '@apps/artisan/components/mailing/StatsTab';
import PageMail from '@apps/artisan/components/mailing/page/PageMail';

const ONGLETS = ['send', 'stats', 'segments', 'editor'];

export default function Mailing() {
  const { isOrgAdmin } = useAuth();
  // ?tab=editor : ouverture directe de l'éditeur (lien « Modifier le texte » de Réglages → Emails).
  // ?mail=<id> | nouveau : la page d'un mail, à la place des onglets.
  const [searchParams, setSearchParams] = useSearchParams();
  const ongletDemande = searchParams.get('tab');
  const mailId = searchParams.get('mail');
  const [tab, setTab] = useState(() => (ongletDemande === 'editor' ? 'editor' : 'send'));
  useEffect(() => {
    if (ONGLETS.includes(ongletDemande)) setTab(ongletDemande);
  }, [ongletDemande]);

  if (isOrgAdmin && mailId) {
    return (
      <PageMail
        mailId={mailId}
        onRetour={() => { setTab('editor'); setSearchParams({ tab: 'editor' }); }}
        onCree={(id) => setSearchParams({ mail: id }, { replace: true })}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 flex items-center gap-3">
          <Mail className="w-7 h-7 text-primary-600" />
          Mailing
        </h1>
      </div>

      {/* Onglets */}
      {isOrgAdmin && (
        <div className="flex gap-1 border-b">
          <TabButton active={tab === 'send'} onClick={() => setTab('send')}>
            <Send className="w-4 h-4 mr-2" />
            Envoi
          </TabButton>
          <TabButton active={tab === 'stats'} onClick={() => setTab('stats')}>
            <BarChart3 className="w-4 h-4 mr-2" />
            Stats
          </TabButton>
          <TabButton active={tab === 'segments'} onClick={() => setTab('segments')}>
            <Filter className="w-4 h-4 mr-2" />
            Segments
          </TabButton>
          <TabButton active={tab === 'editor'} onClick={() => setTab('editor')}>
            <Sparkles className="w-4 h-4 mr-2" />
            Éditeur
          </TabButton>
        </div>
      )}

      {tab === 'send' && <SendTab />}
      {tab === 'stats' && isOrgAdmin && <StatsTab />}
      {tab === 'segments' && isOrgAdmin && <SegmentsTab />}
      {tab === 'editor' && isOrgAdmin && <EditorTab />}
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
