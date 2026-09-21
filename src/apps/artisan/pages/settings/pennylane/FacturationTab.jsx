// src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx
// ============================================================================
// Réglages `settings.pennylane` : { enabled, invoice: { deadline_days, mode,
// ledger_accounts: { by_category: { [categoryId]: ledgerAccountId }, parts } } }.
// `org_update_settings` merge le JSONB au niveau 1 → on renvoie TOUJOURS l'objet
// `pennylane` complet (jamais un sous-objet partiel), cf. Module Solaire.
// Lecture côté métier : `usePennylaneEnabled()` et `pennylaneInvoiceSettings()`
// (src/shared/hooks/useOrgSettings.js).
//
// Comptes comptables (Eric, 2026-09-21) : la « famille » d'une ligne de facture
// pour les stats = son compte de vente Pennylane (706xxx), choisi PAR CATÉGORIE
// d'équipement + un compte pour les pièces. Les comptes viennent de Pennylane
// (`useLedgerAccounts`, GET /ledger_accounts 706*) : rien n'est créé côté PL.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings, pennylaneInvoiceSettings, pennylaneChart } from '@hooks/useOrgSettings';
import { useLedgerAccounts } from '@hooks/usePennylane';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

function pickForm(settings) {
  const inv = pennylaneInvoiceSettings(settings);
  const byCategory = {};
  for (const [catId, id] of Object.entries(inv.ledgerAccounts.byCategory)) {
    if (id) byCategory[catId] = String(id);
  }
  return {
    enabled: Boolean(settings?.pennylane?.enabled),
    deadline_days: String(inv.deadlineDays),
    mode: inv.mode,
    ledger_by_category: byCategory,
    ledger_parts: inv.ledgerAccounts.parts ? String(inv.ledgerAccounts.parts) : '',
  };
}

/** Forme stockée : NUMÉROS de compte (chaînes), sans les vides. */
function ledgerAccountsForSave(form) {
  const by_category = {};
  for (const [catId, num] of Object.entries(form.ledger_by_category || {})) {
    if (num) by_category[catId] = String(num);
  }
  return { by_category, parts: form.ledger_parts ? String(form.ledger_parts) : null };
}

function validate(form) {
  const errors = {};
  const n = Number(form.deadline_days);
  if (!Number.isInteger(n) || n < 0 || n > 120) errors.deadline_days = 'Entre 0 et 120 jours';
  return errors;
}

export default function FacturationTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickForm({}));
  const [initial, setInitial] = useState(() => pickForm({}));
  const { categories } = useEquipmentReferential();
  const { accounts, isLoading: loadingAccounts, error: accountsError } = useLedgerAccounts();
  // Pennylane décline chaque compte par taux de TVA (70601 × any / 10 % / 5,5 % / 20 %) :
  // on paramètre le NUMÉRO, une fois ; la facture choisit la déclinaison du taux de la ligne.
  // Options = plan comptable de GESTION, contexte « contrat » (Settings → Plan comptable) ;
  // s'il est vide, toute la classe 7 de Pennylane, un numéro une fois. Libellés = Pennylane.
  const chart = useMemo(() => pennylaneChart(settings, 'contrat'), [settings]);
  const accountOptions = useMemo(() => {
    const byNumber = new Map();
    for (const a of accounts || []) {
      if (!byNumber.has(a.number)) byNumber.set(a.number, { number: a.number, label: a.label });
    }
    if (chart.length > 0) {
      return chart.map((c) => ({ number: c.number, label: byNumber.get(c.number)?.label || '' }));
    }
    return [...byNumber.values()].sort((a, b) => a.number.localeCompare(b.number));
  }, [accounts, chart]);
  // Anciens réglages stockés par id → convertis en numéro dès que le catalogue est là
  useEffect(() => {
    if (!accounts?.length) return;
    const toNumber = (v) => {
      if (!v) return v;
      if (accounts.some((a) => a.number === String(v))) return String(v);
      const hit = accounts.find((a) => String(a.id) === String(v));
      return hit ? hit.number : v;
    };
    setForm((f) => {
      const by = Object.fromEntries(Object.entries(f.ledger_by_category || {}).map(([k, v]) => [k, toNumber(v)]));
      const parts = toNumber(f.ledger_parts);
      const same = parts === f.ledger_parts && JSON.stringify(by) === JSON.stringify(f.ledger_by_category);
      return same ? f : { ...f, ledger_by_category: by, ledger_parts: parts };
    });
  }, [accounts]);
  const setLedgerForCategory = (catId, value) =>
    setForm((f) => ({ ...f, ledger_by_category: { ...f.ledger_by_category, [catId]: value } }));

  useEffect(() => {
    const picked = pickForm(settings);
    setForm(picked);
    setInitial(picked);
  }, [settings]);

  const errors = useMemo(() => validate(form), [form]);
  const isDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);
  const isValid = Object.keys(errors).length === 0;

  const handleSave = async () => {
    if (!isValid) return;
    try {
      // Objet `pennylane` COMPLET : on préserve les clés qu'on n'édite pas ici.
      const pennylane = {
        ...(settings?.pennylane || {}),
        enabled: form.enabled,
        invoice: {
          ...(settings?.pennylane?.invoice || {}),
          deadline_days: Number(form.deadline_days),
          mode: form.mode,
          ledger_accounts: ledgerAccountsForSave(form),
        },
      };
      await save({ pennylane });
      toast.success('Facturation Pennylane enregistrée');
      setInitial(form);
    } catch (err) {
      toast.error(err.message || "Erreur lors de l'enregistrement");
    }
  };

  if (isLoading) {
    return <div className="card text-sm text-secondary-500">Chargement…</div>;
  }

  return (
    <div className="card space-y-8">
      <section>
        <h3 className={SECTION_TITLE}>Intégration</h3>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            className="mt-0.5 h-4 w-4 rounded border-secondary-300 text-primary-600 focus:ring-primary-500"
          />
          <span>
            <span className="block text-sm font-medium text-secondary-900">Pennylane est activé pour cette organisation</span>
            <span className="block text-xs text-secondary-500">
              Pilote le pipeline par les devis Pennylane, l&apos;explorateur de devis et le bouton « Facturer » des cartes entretien.
            </span>
          </span>
        </label>
      </section>

      <section className={form.enabled ? '' : 'opacity-50 pointer-events-none'}>
        <h3 className={SECTION_TITLE}>Factures d&apos;entretien créées depuis les cartes</h3>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className={LABEL_CLASS}>Échéance de paiement (jours)</label>
            <input
              type="number"
              min="0"
              max="120"
              value={form.deadline_days}
              onChange={(e) => setForm({ ...form, deadline_days: e.target.value })}
              className={INPUT_CLASS}
            />
            {errors.deadline_days && <p className={ERROR_CLASS}>{errors.deadline_days}</p>}
            <p className={HINT_CLASS}>Date d&apos;échéance = date de la facture + ce délai.</p>
          </div>
          <div>
            <label className={LABEL_CLASS}>Mode de création</label>
            <select
              value={form.mode}
              onChange={(e) => setForm({ ...form, mode: e.target.value })}
              className={INPUT_CLASS}
            >
              <option value="draft">Brouillon — à finaliser dans Pennylane</option>
              <option value="final">Finalisée — numérotée immédiatement</option>
            </select>
            <p className={HINT_CLASS}>
              Commencez en brouillon : vous relisez et envoyez depuis Pennylane. Une facture finalisée est un document légal, irréversible (avoir).
            </p>
          </div>
        </div>
      </section>

      <section className={form.enabled ? '' : 'opacity-50 pointer-events-none'}>
        <h3 className={SECTION_TITLE}>Contrats d&apos;entretien — compte de vente par catégorie d&apos;équipement</h3>
        <p className="text-xs text-secondary-500 mb-3">
          Contexte « contrat » : chaque ligne d&apos;une facture d&apos;entretien est comptabilisée sur le compte de sa catégorie
          d&apos;équipement, la famille que votre comptable retrouvera dans les statistiques Pennylane. Sans compte, Pennylane
          applique son compte par défaut. Les devis (articles du catalogue) et les travaux auront leur propre affectation.
          {chart.length === 0 && (
            <> Aucun compte coché en colonne « Contrat » du plan comptable : toute la classe 7 est proposée (Paramètres → Plan comptable pour la réduire).</>
          )}
        </p>
        {accountsError && (
          <p className={`${ERROR_CLASS} mb-3`}>Comptes Pennylane indisponibles : {accountsError.message || 'erreur'}</p>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
          {categories.map((cat) => (
            <div key={cat.id}>
              <label className={LABEL_CLASS}>{cat.label}</label>
              <select
                value={form.ledger_by_category?.[cat.id] || ''}
                onChange={(e) => setLedgerForCategory(cat.id, e.target.value)}
                disabled={loadingAccounts}
                className={INPUT_CLASS}
              >
                <option value="">— Compte par défaut Pennylane —</option>
                {accountOptions.map((a) => (
                  <option key={a.number} value={a.number}>{a.number} · {a.label}</option>
                ))}
              </select>
            </div>
          ))}
          <div>
            <label className={LABEL_CLASS}>Pièces de rechange</label>
            <select
              value={form.ledger_parts || ''}
              onChange={(e) => setForm({ ...form, ledger_parts: e.target.value })}
              disabled={loadingAccounts}
              className={INPUT_CLASS}
            >
              <option value="">— Compte par défaut Pennylane —</option>
              {accountOptions.map((a) => (
                <option key={a.id} value={String(a.id)}>{a.number} · {a.label}</option>
              ))}
            </select>
            <p className={HINT_CLASS}>Pièces facturées avec l&apos;entretien (certificat).</p>
          </div>
        </div>
        {categories.length === 0 && (
          <p className={HINT_CLASS}>Aucune catégorie d&apos;équipement active (Paramètres → Équipements).</p>
        )}
      </section>

      <div className="flex justify-end gap-2 pt-4 border-t border-secondary-200">
        <button
          type="button"
          onClick={() => setForm(initial)}
          disabled={!isDirty || isSaving}
          className="px-4 py-2 text-sm text-secondary-600 hover:bg-secondary-50 rounded-md disabled:opacity-50"
        >
          Annuler
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || !isValid || isSaving}
          className="px-4 py-2 text-sm bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50"
        >
          {isSaving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  );
}
