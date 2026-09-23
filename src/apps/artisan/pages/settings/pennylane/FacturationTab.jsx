// src/apps/artisan/pages/settings/pennylane/FacturationTab.jsx
// ============================================================================
// Réglages `settings.pennylane` : { enabled, invoice: { deadline_days, mode,
// ledger_accounts: { by_category: { [categoryId]: ledgerAccountId }, parts },
// templates: { by_category } } }.
// `org_update_settings` merge le JSONB au niveau 1 → on renvoie TOUJOURS l'objet
// `pennylane` complet (jamais un sous-objet partiel), cf. Module Solaire.
// Lecture côté métier : `usePennylaneEnabled()` et `pennylaneInvoiceSettings()`
// (src/shared/hooks/useOrgSettings.js).
//
// Comptes comptables (Eric, 2026-09-21) : la « famille » d'une ligne de facture
// pour les stats = son compte de vente Pennylane (706xxx), choisi PAR CATÉGORIE
// d'équipement + un compte pour les pièces. Les comptes viennent de Pennylane
// (`useLedgerAccounts`, GET /ledger_accounts 706*) : rien n'est créé côté PL.
//
// Gabarits (Eric, 2026-09-23) : libellé de ligne, objet de facture et ligne
// offerte, PAR CATÉGORIE d'équipement. Présentationnel dans `TemplatesSection`,
// état ici (`form.templates_by_category`), consommés par `buildEntretienInvoice`.
// ============================================================================
import { useState, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { useOrgSettings, pennylaneInvoiceSettings, pennylaneChart } from '@hooks/useOrgSettings';
import { useLedgerAccounts, useJournals } from '@hooks/usePennylane';
import { pennylaneService } from '@services/pennylane.service';
import { useEquipmentReferential } from '@hooks/useEquipmentReferential';
import TemplatesSection, { EMPTY_TEMPLATE } from './TemplatesSection';

const SECTION_TITLE = 'text-xs font-semibold uppercase tracking-wide text-secondary-500 mb-3';
const INPUT_CLASS = 'w-full px-3 py-2 border border-secondary-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs font-medium text-secondary-600 mb-1';
const HINT_CLASS = 'mt-1 text-xs text-secondary-500';
const ERROR_CLASS = 'mt-1 text-xs text-red-600';

/**
 * Numéro de compte stocké → valeur de formulaire. Un ancien enregistrement a pu
 * sérialiser la chaîne "undefined" (option sans `value`) : on la traite comme vide,
 * sinon elle repartirait telle quelle à la sauvegarde.
 */
function ledgerValue(v) {
  if (v === undefined || v === null) return '';
  const s = String(v);
  return s === 'undefined' || s === 'null' ? '' : s;
}

function pickForm(settings) {
  const inv = pennylaneInvoiceSettings(settings);
  const byCategory = {};
  for (const [catId, id] of Object.entries(inv.ledgerAccounts.byCategory)) {
    const num = ledgerValue(id);
    if (num) byCategory[catId] = num;
  }
  const templatesByCategory = {};
  const raw = settings?.pennylane?.invoice?.templates?.by_category;
  if (raw && typeof raw === 'object') {
    for (const [catId, t] of Object.entries(raw)) {
      if (!t || typeof t !== 'object') continue;
      templatesByCategory[catId] = {
        label: ledgerValue(t.label),
        subject: ledgerValue(t.subject),
        offered_label: ledgerValue(t.offered?.label),
        offered_price_ht: ledgerValue(t.offered?.price_ht),
        offered_vat: ledgerValue(t.offered?.vat_rate) || '10',
      };
    }
  }
  return {
    enabled: Boolean(settings?.pennylane?.enabled),
    deadline_days: String(inv.deadlineDays),
    mode: inv.mode,
    journal_id: inv.journalId ? String(inv.journalId) : '',
    ledger_by_category: byCategory,
    ledger_parts: ledgerValue(inv.ledgerAccounts.parts),
    templates_by_category: templatesByCategory,
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

/** Forme stockée des gabarits : seules les catégories renseignées, jamais de "undefined". */
function templatesForSave(form) {
  const by_category = {};
  for (const [catId, t] of Object.entries(form.templates_by_category || {})) {
    const label = (t.label || '').trim();
    const subject = (t.subject || '').trim();
    const oLabel = (t.offered_label || '').trim();
    const oPrice = Number(t.offered_price_ht);
    const entry = {};
    if (label) entry.label = label;
    if (subject) entry.subject = subject;
    if (oLabel && oPrice > 0) entry.offered = { label: oLabel, price_ht: oPrice, vat_rate: Number(t.offered_vat) };
    if (Object.keys(entry).length > 0) by_category[catId] = entry;
  }
  return { by_category };
}

function validate(form) {
  const errors = {};
  const n = Number(form.deadline_days);
  if (!Number.isInteger(n) || n < 0 || n > 120) errors.deadline_days = 'Entre 0 et 120 jours';
  const templateErrors = {};
  for (const [catId, t] of Object.entries(form.templates_by_category || {})) {
    const oLabel = (t.offered_label || '').trim();
    const oPrice = Number(t.offered_price_ht);
    if (oLabel && !(oPrice > 0)) {
      templateErrors[catId] = 'Indiquez un prix HT supérieur à 0 pour la ligne offerte';
    } else if (oPrice > 0 && !oLabel) {
      templateErrors[catId] = 'Indiquez le libellé de la ligne offerte';
    }
  }
  if (Object.keys(templateErrors).length > 0) errors.templates = templateErrors;
  return errors;
}

export default function FacturationTab() {
  const { settings, save, isSaving, isLoading } = useOrgSettings();
  const [form, setForm] = useState(() => pickForm({}));
  const [initial, setInitial] = useState(() => pickForm({}));
  const { categories } = useEquipmentReferential();
  const { accounts, isLoading: loadingAccounts, error: accountsError } = useLedgerAccounts();
  const { journals, isLoading: loadingJournals, error: journalsError } = useJournals();
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
  const setTemplate = (catId, patch) =>
    setForm((f) => ({
      ...f,
      templates_by_category: {
        ...f.templates_by_category,
        [catId]: { ...(f.templates_by_category?.[catId] || EMPTY_TEMPLATE), ...patch },
      },
    }));

  // --- Spike écriture dans le journal (admin) ---
  const [testAccount411, setTestAccount411] = useState('');
  const [testAccount706, setTestAccount706] = useState('706');
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState('');
  const handleTestLedgerEntry = async () => {
    if (!form.journal_id || !testAccount411) return;
    if (!window.confirm('Pousser une écriture de test de 1,20 € dans ce journal Pennylane ? Elle devra être contrepassée.')) return;
    setTestRunning(true);
    setTestResult('');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const journal = journals.find((j) => String(j.id) === form.journal_id);
    const piece = `MDH-TEST-${stamp}`;
    const { data, error } = await pennylaneService.pushLedgerEntry({
      journal_id: Number(form.journal_id),
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      label: `TEST Majordhome ${piece} — écriture d’essai à contrepasser`,
      piece_number: piece,
      lines: [
        { account_number: testAccount411, debit: 1.2, credit: 0, label: `Client test ${piece}` },
        { account_number: testAccount706, vat_rate: 'FR_200', debit: 0, credit: 1.0, label: 'Prestation test' },
        { account_number: '44571', vat_rate: 'FR_200', debit: 0, credit: 0.2, label: 'TVA collectée 20 %' },
      ],
      test_pdf_text: `TEST Majordhome ${piece} - journal ${journal?.code || form.journal_id} - a contrepasser`,
    });
    setTestRunning(false);
    if (error) {
      setTestResult(JSON.stringify({ error: error.message, steps: error.steps || null }, null, 2));
      toast.error(error.message || 'Écriture de test refusée');
      return;
    }
    setTestResult(JSON.stringify(data, null, 2));
    toast.success(`Écriture ${piece} poussée — vérifiez dans Pennylane (journal ${journal?.code || ''})`);
  };

  // Test 2 : facture IMPORTÉE (PDF + montants exacts) puis déplacement de son écriture dans le journal.
  // Une facture importée est « créée via l'API » : c'est ce qui manquait à la voie « Facturer ».
  const [testCustomerId, setTestCustomerId] = useState('');
  const handleTestImportInvoice = async () => {
    if (!form.journal_id || !testCustomerId) return;
    if (!window.confirm('Importer une facture de test de 1,20 € (avec PDF) puis déplacer son écriture dans ce journal ? À annuler ensuite dans Pennylane.')) return;
    setTestRunning(true);
    setTestResult('');
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const journal = journals.find((j) => String(j.id) === form.journal_id);
    const number = `MDH-TEST-${stamp}`;
    const { data, error } = await pennylaneService.pushLedgerEntry({
      mode: 'import_invoice',
      journal_id: Number(form.journal_id),
      date: new Date().toISOString().slice(0, 10),
      due_date: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      label: `TEST Majordhome ${number} — facture importée d’essai`,
      invoice_number: number,
      external_reference: number,
      customer_id: Number(testCustomerId),
      currency_amount_before_tax: '1.00',
      currency_tax: '0.20',
      currency_amount: '1.20',
      invoice_lines: [
        { label: 'Prestation test', quantity: 1, unit: 'piece', raw_currency_unit_price: '1.00', vat_rate: 'FR_200', currency_amount: '1.20', currency_tax: '0.20', account_number: testAccount706 || '706' },
      ],
      test_pdf_text: `TEST Majordhome ${number} - facture importee d essai - journal ${journal?.code || form.journal_id}`,
      lines: [],
    });
    setTestRunning(false);
    if (error) {
      setTestResult(JSON.stringify({ error: error.message, steps: error.steps || null }, null, 2));
      toast.error(error.message || 'Import de test refusé');
      return;
    }
    setTestResult(JSON.stringify(data, null, 2));
    toast[data?.journal_moved ? 'success' : 'warning'](
      data?.journal_moved
        ? `Facture ${number} importée et écriture déplacée dans ${journal?.code || 'le journal'}`
        : `Facture ${number} importée, mais l’écriture n’a pas pu être déplacée — voir le détail`,
      { duration: 12000 },
    );
  };

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
          templates: templatesForSave(form),
          journal_id: form.journal_id ? Number(form.journal_id) : null,
          journal_code: form.journal_id ? (journals.find((j) => String(j.id) === form.journal_id)?.code || '') : '',
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
              <option value="hub">Émise par Majord&apos;home — numéro, PDF et avoir Majord&apos;home, comptabilisée dans Pennylane</option>
            </select>
            <p className={HINT_CLASS}>
              Brouillon : vous relisez et envoyez depuis Pennylane. Finalisée : document légal immédiat. Émise par Majord&apos;home :
              Majord&apos;home numérote (série continue par année, préfixe de l&apos;onglet Émission), produit le PDF, l&apos;archive, puis
              importe la facture terminée dans Pennylane pour la comptabiliser ; l&apos;avoir se fait depuis la carte. Le premier numéro
              de l&apos;année fige le préfixe.
            </p>
          </div>
          <div className="sm:col-span-2">
            <label className={LABEL_CLASS}>Journal des factures Majordhome</label>
            <select
              value={form.journal_id || ''}
              onChange={(e) => setForm({ ...form, journal_id: e.target.value })}
              disabled={loadingJournals}
              className={INPUT_CLASS}
            >
              <option value="">— Journal de ventes par défaut de Pennylane —</option>
              {journals.map((j) => (
                <option key={j.id} value={String(j.id)}>{j.code} · {j.label}{j.type ? ` (${j.type})` : ''}</option>
              ))}
            </select>
            {journalsError && <p className={ERROR_CLASS}>Journaux Pennylane indisponibles : {journalsError.message || 'erreur'}</p>}
            <p className={HINT_CLASS}>
              Réglage conservé pour mémoire : Pennylane n&apos;accepte pas de déplacer l&apos;écriture d&apos;une facture par l&apos;API (vérifié le 22/09/2026),
              les factures tombent dans le journal de ventes principal. Un changement de journal se fait dans Pennylane, à la main ou en masse.
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
                <option key={a.number} value={a.number}>{a.number} · {a.label}</option>
              ))}
            </select>
            <p className={HINT_CLASS}>Pièces facturées avec l&apos;entretien (certificat).</p>
          </div>
        </div>
        {categories.length === 0 && (
          <p className={HINT_CLASS}>Aucune catégorie d&apos;équipement active (Paramètres → Équipements).</p>
        )}
      </section>

      <section className={form.enabled ? '' : 'opacity-50 pointer-events-none'}>
        <h3 className={SECTION_TITLE}>Contrats d&apos;entretien — libellés et ligne offerte par catégorie</h3>
        <TemplatesSection
          categories={categories}
          value={form.templates_by_category}
          onChange={setTemplate}
          errors={errors.templates}
        />
      </section>

      {/* Spike 2026-09-22 (admin) : une écriture de vente poussée dans le journal choisi,
          avec un PDF, est-elle convertie en facture par Pennylane (voie « logiciel de
          facturation tiers », article 301073) ? Montant symbolique, à contrepasser. */}
      {form.enabled && form.journal_id && (
        <section>
          <h3 className={SECTION_TITLE}>Test d&apos;écriture dans le journal (administrateur)</h3>
          <p className="text-xs text-secondary-500 mb-3">
            Pousse une écriture de vente de 1,20 € TTC (1,00 € HT + 0,20 € de TVA à 20 %) dans le journal sélectionné, avec un PDF
            d&apos;essai, pour vérifier si Pennylane la convertit en facture. À contrepasser ensuite dans Pennylane.
          </p>
          <div className="grid sm:grid-cols-3 gap-4 items-end">
            <div>
              <label className={LABEL_CLASS}>Compte 411 du client de test</label>
              <input
                type="text"
                value={testAccount411}
                onChange={(e) => setTestAccount411(e.target.value.trim())}
                placeholder="411000197"
                className={INPUT_CLASS}
              />
              <p className={HINT_CLASS}>Numéro de compte auxiliaire du client (fiche client, « n° Pennylane »).</p>
            </div>
            <div>
              <label className={LABEL_CLASS}>Compte de vente</label>
              <input
                type="text"
                value={testAccount706}
                onChange={(e) => setTestAccount706(e.target.value.trim())}
                placeholder="706"
                className={INPUT_CLASS}
              />
            </div>
            <div>
              <button
                type="button"
                onClick={handleTestLedgerEntry}
                disabled={testRunning || !testAccount411 || !testAccount706}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 w-full"
              >
                {testRunning ? 'Envoi…' : 'Pousser l’écriture de test'}
              </button>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-4 items-end mt-4">
            <div>
              <label className={LABEL_CLASS}>Client Pennylane (identifiant) — test 2 : facture importée</label>
              <input
                type="text"
                value={testCustomerId}
                onChange={(e) => setTestCustomerId(e.target.value.trim())}
                placeholder="244601347"
                className={INPUT_CLASS}
              />
              <p className={HINT_CLASS}>Importe une facture de 1,20 € avec PDF, puis tente de déplacer son écriture dans le journal.</p>
            </div>
            <div className="sm:col-span-2">
              <button
                type="button"
                onClick={handleTestImportInvoice}
                disabled={testRunning || !testCustomerId}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50 w-full"
              >
                {testRunning ? 'Envoi…' : 'Importer une facture de test puis déplacer l’écriture'}
              </button>
            </div>
          </div>
          {testResult && (
            <pre className="mt-3 max-h-80 overflow-auto text-[11px] bg-secondary-50 border border-secondary-200 rounded-md p-3 whitespace-pre-wrap break-all">
              {testResult}
            </pre>
          )}
        </section>
      )}

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
