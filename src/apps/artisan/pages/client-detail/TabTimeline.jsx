/**
 * TabTimeline.jsx — onglet Timeline de la fiche client : le traceur.
 * ============================================================================
 * Montre TOUTES les modifications de la fiche, de ses équipements, de son contrat,
 * de ses RDV et de ses cartes Entretien / SAV : qui, quand, quoi (avant → après),
 * par où. La source est le journal d'audit écrit par trigger en base
 * (`majordhome.audit_log`, migrations 20261116_5 et 20261117_1) — personne ne
 * déclare rien, donc rien n'est oublié.
 *
 * Seule chose sautée : la création et la purge des lignes par équipement d'un
 * entretien (`estEcritureMecanique`), posées et retirées par la planification.
 *
 * Les anciennes activités déclaratives (`client_activities` : « Client créé »,
 * « Équipement ajouté », documents de l'import) restent affichées : c'est tout ce
 * que l'on sait d'avant le journal. On n'ajoute plus de note ici (Eric
 * 2026-11-16) : les notes de la fiche vivent dans le Résumé (et le formulaire
 * « Modifier »), et leur modification est tracée comme le reste.
 *
 * Mise en forme : `useHistoriqueClient` (même dossier, partagé avec le Résumé),
 * qui s'appuie sur `buildAuditEntry` / `mergeTimeline` (src/lib/auditTrail.js, pur).
 * ============================================================================
 */

import {
  MessageSquare, Phone, Mail, FileText, User, Settings, Tag,
  Calendar, Wrench, ChevronRight, Clock, Pin, History,
  Loader2, AlertCircle, RefreshCw, ClipboardList,
} from 'lucide-react';
import { formatDateTimeFR } from '@/lib/utils';
import { AuditEntry } from '@/apps/artisan/components/shared/AuditEntry';
import { useHistoriqueClient } from './useHistoriqueClient';

const ACTIVITY_ICONS = {
  note: MessageSquare,
  comment: MessageSquare,
  phone_call: Phone,
  email_sent: Mail,
  email_received: Mail,
  document_added: FileText,
  client_created: User,
  client_updated: Settings,
  status_changed: Tag,
  appointment_created: Calendar,
  appointment_completed: Calendar,
  intervention_scheduled: Wrench,
  intervention_completed: Wrench,
  equipment_added: Wrench,
  equipment_updated: Wrench,
  contract_created: FileText,
  contract_renewed: FileText,
  lead_converted: ChevronRight,
};

/** Icône d'une écriture du journal, selon la table concernée. */
const AUDIT_ICONS = {
  clients: User,
  equipments: Wrench,
  contracts: FileText,
  contract_equipments: FileText,
  appointments: Calendar,
  interventions: ClipboardList,
};

const Pastille = ({ icon: Icon, className }) => (
  <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${className}`}>
    <Icon className="h-4 w-4" />
  </div>
);

/** Activité déclarative d'avant le journal (lecture seule). */
const ActivityItem = ({ activity }) => (
  <div className="min-w-0">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-secondary-900">{activity.title}</span>
      {activity.is_pinned && <Pin className="w-3 h-3 text-amber-500" />}
    </div>
    {activity.description && <p className="mt-0.5 text-sm text-secondary-600 line-clamp-2">{activity.description}</p>}
    <p className="mt-1 text-xs text-secondary-400">{formatDateTimeFR(activity.created_at)}</p>
  </div>
);

export const TabTimeline = ({ clientId, projectId }) => {
  const { timeline, truncated, isLoading, auditError, activitiesError, refresh } = useHistoriqueClient(clientId, projectId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
      </div>
    );
  }

  const enEchec = !!auditError || !!activitiesError;

  return (
    <div className="space-y-4">
      {/* Journal illisible : le dire. Une Timeline vide se lirait « rien n'a été modifié ». */}
      {enEchec && (
        <div className="flex items-start justify-between gap-3 p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="flex items-start gap-2 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {auditError
              ? 'Le journal des modifications n\'a pas pu être lu : ce qui suit est incomplet.'
              : 'L\'historique d\'avant le journal n\'a pas pu être lu : ce qui suit est incomplet.'}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-800 bg-white border border-red-200 rounded-lg hover:bg-red-100 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Réessayer
          </button>
        </div>
      )}

      {timeline.length === 0 ? (
        !enEchec && (
          <div className="text-center py-12">
            <History className="w-12 h-12 text-secondary-300 mx-auto" />
            <p className="mt-4 text-secondary-700 font-medium">Aucune modification enregistrée</p>
            <p className="mt-1 text-sm text-secondary-500">
              Chaque changement de la fiche, d&apos;un équipement, du contrat, d&apos;un RDV ou d&apos;une carte Entretien / SAV apparaîtra ici, avec son auteur.
            </p>
          </div>
        )
      ) : (
        <div className="relative">
          <div className="absolute bottom-0 left-4 top-0 w-px bg-secondary-200" />
          <div className="space-y-4">
            {timeline.map((entry) => (entry.kind === 'audit' ? (
              <div key={entry.id} className="relative flex gap-3">
                <Pastille icon={AUDIT_ICONS[entry.table] || History} className="bg-secondary-100 text-secondary-600" />
                <div className="flex-1 min-w-0 pt-0.5">
                  <AuditEntry entry={entry} showSubject />
                </div>
              </div>
            ) : (
              <div key={`activity-${entry.id}`} className="relative flex gap-3">
                <Pastille icon={ACTIVITY_ICONS[entry.activity_type] || Clock} className="bg-secondary-100 text-secondary-600" />
                <div className="flex-1 min-w-0 pt-0.5">
                  <ActivityItem activity={entry} />
                </div>
              </div>
            )))}
          </div>
        </div>
      )}

      {truncated && (
        <p className="text-xs text-secondary-500">
          Seules les 200 modifications les plus récentes sont affichées.
        </p>
      )}

      {/* Pas de rétroactif : dire depuis quand le journal existe, sinon un historique court se lit « rien avant ». */}
      <p className="border-t border-secondary-100 pt-3 text-xs text-secondary-400">
        Les modifications de la fiche, des équipements et du contrat sont enregistrées depuis le 16 novembre 2026,
        celles des cartes Entretien / SAV depuis le 17 novembre 2026, celles des RDV depuis le 16 septembre 2026.
        Ce qui a été modifié avant n&apos;a pas été enregistré.
      </p>
    </div>
  );
};
