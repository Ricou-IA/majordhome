import { useState } from 'react';
import { Mail, Send, Sparkles } from 'lucide-react';
import { useAuth } from '@contexts/AuthContext';
import SendTab from '@apps/artisan/components/mailing/SendTab';
import EditorTab from '@apps/artisan/components/mailing/EditorTab';

export default function Mailing() {
  const { isOrgAdmin } = useAuth();
  const [tab, setTab] = useState('send');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-secondary-900 flex items-center gap-3">
          <Mail className="w-7 h-7 text-primary-600" />
          Mailing
        </h1>
        <p className="text-secondary-500 mt-1">
          Composer et envoyer des campagnes email via le workflow N8N
        </p>
      </div>

      {/* Onglets */}
      {isOrgAdmin && (
        <div className="flex gap-1 border-b">
          <TabButton active={tab === 'send'} onClick={() => setTab('send')}>
            <Send className="w-4 h-4 mr-2" />
            Envoi
          </TabButton>
          <TabButton active={tab === 'editor'} onClick={() => setTab('editor')}>
            <Sparkles className="w-4 h-4 mr-2" />
            Éditeur
          </TabButton>
        </div>
      )}

      {tab === 'send' && <SendTab />}
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
