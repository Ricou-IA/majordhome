/**
 * CertificatConformeDialog.jsx — Majord'home Artisan
 * ============================================================================
 * Confirmation du certificat « Conforme » allégé, posé par le bureau quand le
 * technicien n'a pas rempli le certificat sur place
 * (spec docs/superpowers/specs/2026-11-16-certificat-conforme-allege-design.md).
 *
 * Trois choses à confirmer : la date de passage, qui est passé, et — pour un
 * appareil à conduit de fumée — si le ramonage a été fait. Ce composant ne
 * décide rien : blocage et avertissement lui arrivent calculés
 * (`blocageConforme` / `brouillonRemplace` de src/lib/certificatConformeModel.js).
 * ============================================================================
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, XCircle } from 'lucide-react';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { inputClass, selectClass } from '@/apps/artisan/components/FormFields';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {(open: boolean) => void} props.onOpenChange
 * @param {string} props.equipmentLabel  ex. « Poêle à granulés · PALAZZETTI eco fire »
 * @param {string} props.defaultDate  `YYYY-MM-DD`, déjà bornée à aujourd'hui
 * @param {string} props.today  `YYYY-MM-DD`
 * @param {{ id: string, display_name: string }[]} props.technicians
 * @param {string|null} props.defaultTechnicianId
 * @param {boolean} props.loadingTechnician  RDV encore en lecture : on ne devine pas qui est passé
 * @param {boolean} props.showRamonage  appareil à conduit de fumée
 * @param {string|null} props.blocage  motif qui interdit le geste (affiché, confirmation bloquée)
 * @param {boolean} props.remplaceBrouillon  un brouillon du technicien sera remplacé
 * @param {boolean} props.loading
 * @param {(v: { date: string, technicienId: string, ramonage: boolean }) => void} props.onConfirm
 */
export function CertificatConformeDialog({
  open, onOpenChange, equipmentLabel, defaultDate, today, technicians = [], defaultTechnicianId = null,
  loadingTechnician = false, showRamonage = false, blocage = null, remplaceBrouillon = false, loading = false, onConfirm,
}) {
  const [date, setDate] = useState(defaultDate);
  const [technicienId, setTechnicienId] = useState(defaultTechnicianId || '');
  const [ramonage, setRamonage] = useState(false);

  // Réinitialisée à l'ouverture ; le technicien du RDV arrive après (requête), sans écraser un choix.
  useEffect(() => {
    if (!open) return;
    setDate(defaultDate);
    setRamonage(false);
    setTechnicienId(defaultTechnicianId || '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (open && defaultTechnicianId) setTechnicienId((prev) => prev || defaultTechnicianId);
  }, [open, defaultTechnicianId]);

  const dateValide = /^\d{4}-\d{2}-\d{2}$/.test(date || '') && date <= today;
  const pret = !blocage && dateValide && !!technicienId && !loadingTechnician;

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Certificat conforme"
      description={`${equipmentLabel} — entretien fait, rien d'anormal. Le client reçoit un certificat d'une page avec sa facture.`}
      confirmLabel="Enregistrer"
      variant="default"
      onConfirm={() => onConfirm({ date, technicienId, ramonage })}
      loading={loading}
      confirmDisabled={!pret}
    >
      <div className="mt-4 space-y-4">
        {blocage && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{blocage}</span>
          </p>
        )}
        {!blocage && remplaceBrouillon && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>Le technicien a commencé un certificat sans le terminer : il sera remplacé par celui-ci.</span>
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Date de passage</span>
            <input
              type="date"
              value={date || ''}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className={inputClass}
              disabled={!!blocage || loading}
            />
            {!dateValide && <span className="mt-1 block text-xs text-red-700">Date absente ou dans le futur.</span>}
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-gray-700">Intervention réalisée par</span>
            <select
              value={technicienId}
              onChange={(e) => setTechnicienId(e.target.value)}
              className={selectClass}
              disabled={!!blocage || loading || loadingTechnician}
            >
              <option value="">{loadingTechnician ? 'Lecture du RDV…' : 'Choisir…'}</option>
              {technicians.map((t) => (
                <option key={t.id} value={t.id}>{String(t.display_name || '').trim()}</option>
              ))}
            </select>
          </label>
        </div>

        {showRamonage && (
          <label className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-sm">
            <input
              type="checkbox"
              checked={ramonage}
              onChange={(e) => setRamonage(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300"
              disabled={!!blocage || loading}
            />
            <span>
              <span className="font-medium text-gray-900">Ramonage effectué</span>
              <span className="mt-0.5 block text-gray-600">
                Le client recevra aussi l&apos;attestation de ramonage, qui écrit que le conduit est vacant
                après test. À cocher seulement si le conduit a bien été ramoné.
              </span>
            </span>
          </label>
        )}
      </div>
    </ConfirmDialog>
  );
}
