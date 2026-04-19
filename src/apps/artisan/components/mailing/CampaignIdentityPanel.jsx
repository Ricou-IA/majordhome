import { useState } from 'react';
import { ChevronDown, ChevronUp, Info, Users, MessageSquare, Clock, FileText } from 'lucide-react';

/**
 * Panneau repliable affichant la carte d'identité d'une campagne.
 * Montre purpose / audience / tone / trigger / notes, issus de la DB.
 */
export default function CampaignIdentityPanel({ campaign, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);

  if (!campaign) return null;

  const {
    purpose,
    audience,
    tone,
    trigger_description: trigger,
    notes,
  } = campaign;

  const hasContent = purpose || audience || tone || trigger || notes;
  if (!hasContent) return null;

  return (
    <div className="card p-4">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full text-sm font-medium text-secondary-700"
      >
        <span className="flex items-center gap-2">
          <Info className="w-4 h-4 text-primary-600" />
          Carte d'identité
        </span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {open && (
        <div className="mt-3 space-y-3 text-sm text-secondary-700">
          {purpose && (
            <Row icon={<MessageSquare className="w-3.5 h-3.5" />} label="Objectif" value={purpose} />
          )}
          {audience && (
            <Row icon={<Users className="w-3.5 h-3.5" />} label="Cible" value={audience} />
          )}
          {tone && (
            <Row icon={<MessageSquare className="w-3.5 h-3.5" />} label="Ton" value={tone} />
          )}
          {trigger && (
            <Row icon={<Clock className="w-3.5 h-3.5" />} label="Déclencheur" value={trigger} />
          )}
          {notes && (
            <Row icon={<FileText className="w-3.5 h-3.5" />} label="Notes" value={notes} />
          )}
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, value }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-24 flex items-center gap-1 text-xs uppercase tracking-wide text-secondary-500">
        {icon}
        {label}
      </div>
      <p className="flex-1 leading-relaxed">{value}</p>
    </div>
  );
}
