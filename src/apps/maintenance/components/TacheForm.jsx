// src/apps/maintenance/components/TacheForm.jsx
// Création / modification d'une tâche : libellé, consigne, fréquence (jours cochés OU tous
// les N jours/semaines/mois), date de début — avec APERÇU de la prochaine échéance calculé
// par echeances.js (même règle que la borne) pour vérifier avant d'enregistrer.
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { FormField, TextInput, TextArea, SelectInput } from '@apps/artisan/components/FormFields';
import { prochaineEcheance, decrireFrequence, jourParis } from '@/lib/maintenance/echeances';

const JOURS = [
  { iso: 1, court: 'L' }, { iso: 2, court: 'M' }, { iso: 3, court: 'M' }, { iso: 4, court: 'J' },
  { iso: 5, court: 'V' }, { iso: 6, court: 'S' }, { iso: 7, court: 'D' },
];
const UNITES = [
  { value: 'day', label: 'jour(s)' },
  { value: 'week', label: 'semaine(s)' },
  { value: 'month', label: 'mois' },
];
const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

function formInitial(tache, unitId) {
  return {
    id: tache?.id,
    unit_id: tache?.unit_id || unitId,
    label: tache?.label || '',
    instructions: tache?.instructions || '',
    frequency_kind: tache?.frequency_kind || 'weekdays',
    weekdays: tache?.weekdays || [1, 2, 3, 4, 5],
    interval_unit: tache?.interval_unit || 'week',
    interval_count: tache?.interval_count || 1,
    start_date: tache?.start_date || jourParis(new Date()),
  };
}

/**
 * @param {{ open: boolean, onOpenChange: (v:boolean)=>void, tache?: object, unitId: string,
 *   dernierLog?: object|null, onEnregistrer: (task: object) => Promise<unknown> }} props
 */
export default function TacheForm({ open, onOpenChange, tache, unitId, dernierLog, onEnregistrer }) {
  const [f, setF] = useState(() => formInitial(tache, unitId));
  const [envoi, setEnvoi] = useState(false);
  const maj = (cle) => (v) => setF((p) => ({ ...p, [cle]: v }));

  const basculerJour = (iso) => setF((p) => {
    const jours = p.weekdays.includes(iso) ? p.weekdays.filter((j) => j !== iso) : [...p.weekdays, iso];
    return { ...p, weekdays: jours.sort((a, b) => a - b) };
  });

  const count = Number(f.interval_count);
  const valide = f.label.trim().length > 0 && !!f.start_date
    && (f.frequency_kind === 'weekdays' ? f.weekdays.length > 0 : Number.isInteger(count) && count >= 1 && count <= 366);

  const apercu = useMemo(() => {
    if (!valide) return null;
    const t = { ...f, interval_count: count, archived_at: null };
    const echeance = prochaineEcheance(t, dernierLog || null);
    if (!echeance) return null;
    const [a, m, j] = echeance.split('-').map(Number);
    return { frequence: decrireFrequence(t), echeance: DATE_LONGUE.format(new Date(Date.UTC(a, m - 1, j))) };
  }, [f, count, valide, dernierLog]);

  const enregistrer = async () => {
    setEnvoi(true);
    try {
      await onEnregistrer({
        ...f,
        label: f.label.trim(),
        instructions: f.instructions.trim() || null,
        interval_count: f.frequency_kind === 'interval' ? count : null,
      });
      toast.success(tache ? 'Tâche modifiée' : 'Tâche créée');
      onOpenChange(false);
    } catch (err) {
      toast.error(`Enregistrement impossible : ${err?.message || 'erreur inconnue'}`);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tache ? 'Modifier la tâche' : 'Nouvelle tâche'}
      description=""
      confirmLabel="Enregistrer"
      variant="default"
      size="lg"
      loading={envoi}
      confirmDisabled={!valide}
      onConfirm={enregistrer}
    >
      <div className="space-y-4 text-left">
        <FormField label="Libellé" required>
          <TextInput value={f.label} onChange={maj('label')} placeholder="Ex. Graissage des glissières" />
        </FormField>
        <FormField label="Consigne (affichée sur la borne)">
          <TextArea value={f.instructions} onChange={maj('instructions')} rows={2} placeholder="Facultatif" />
        </FormField>

        <FormField label="Fréquence" required>
          <div className="flex gap-2">
            {[{ v: 'weekdays', l: 'Jours de la semaine' }, { v: 'interval', l: 'Tous les N…' }].map((o) => (
              <button key={o.v} type="button" onClick={() => maj('frequency_kind')(o.v)}
                className={`px-3 py-1.5 rounded-lg text-sm border ${f.frequency_kind === o.v
                  ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-secondary-300 text-secondary-700'}`}>
                {o.l}
              </button>
            ))}
          </div>
        </FormField>

        {f.frequency_kind === 'weekdays' ? (
          <div className="flex gap-2">
            {JOURS.map((j) => (
              <button key={j.iso} type="button" onClick={() => basculerJour(j.iso)}
                aria-pressed={f.weekdays.includes(j.iso)}
                className={`w-10 h-10 rounded-full text-sm font-semibold border ${f.weekdays.includes(j.iso)
                  ? 'bg-primary-600 border-primary-600 text-white' : 'border-secondary-300 text-secondary-600'}`}>
                {j.court}
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-secondary-700">Tous les</span>
            <div className="w-24">
              <TextInput type="number" min={1} max={366} value={String(f.interval_count)} onChange={maj('interval_count')} />
            </div>
            <div className="w-40">
              <SelectInput value={f.interval_unit} onChange={(v) => maj('interval_unit')(v || 'week')} options={UNITES} />
            </div>
          </div>
        )}

        <FormField label="À partir du" required>
          <TextInput type="date" value={f.start_date} onChange={maj('start_date')} />
        </FormField>

        <div className="rounded-lg bg-secondary-50 p-3 text-sm text-secondary-700">
          {apercu ? (
            <>
              <span className="font-medium">{apercu.frequence}</span> — prochaine échéance : {apercu.echeance}
              {f.frequency_kind === 'interval' && (
                <p className="mt-1 text-secondary-500">L&apos;échéance suivante se compte depuis la date de réalisation effective.</p>
              )}
            </>
          ) : 'Complétez la fréquence pour voir la prochaine échéance.'}
        </div>
      </div>
    </ConfirmDialog>
  );
}
