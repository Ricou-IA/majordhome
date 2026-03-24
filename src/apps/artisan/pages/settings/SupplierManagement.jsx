/**
 * SupplierManagement.jsx — Gestion fournisseurs et catalogue produits
 * ============================================================================
 * Page paramètres : CRUD fournisseurs + catalogue produits par fournisseur.
 * Accessible aux org_admin uniquement.
 * ============================================================================
 */

import { useState, useCallback, useRef } from 'react';
import { useAuth } from '@contexts/AuthContext';
import { useSuppliers, useSupplierMutations, useSupplierProducts, useProductMutations } from '@hooks/useSuppliers';
import { PRODUCT_CATEGORIES, PRODUCT_UNITS } from '@services/suppliers.service';
import { suppliersService } from '@services/suppliers.service';
import { TVA_RATES } from '@services/devis.service';
import { FormField, TextInput, PhoneInput, SelectInput, TextArea, SectionTitle } from '../../components/FormFields';
import { formatEuro } from '@/lib/utils';
import * as XLSX from 'xlsx';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Package,
  ChevronRight,
  Building2,
  Search,
  X,
  Loader2,
  Upload,
  FileSpreadsheet,
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

// =============================================================================
// MODAL FOURNISSEUR
// =============================================================================

function SupplierFormModal({ supplier, onClose, onSave, isSaving }) {
  const [form, setForm] = useState({
    name: supplier?.name || '',
    contactName: supplier?.contact_name || '',
    contactEmail: supplier?.contact_email || '',
    contactPhone: supplier?.contact_phone || '',
    address: supplier?.address || '',
    postalCode: supplier?.postal_code || '',
    city: supplier?.city || '',
    siret: supplier?.siret || '',
    notes: supplier?.notes || '',
  });

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Le nom du fournisseur est requis');
      return;
    }
    onSave(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-secondary-900 mb-4">
            {supplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <FormField label="Nom" required>
              <TextInput value={form.name} onChange={(v) => setField('name', v)} placeholder="Nom du fournisseur" />
            </FormField>

            <SectionTitle>Contact</SectionTitle>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Nom contact">
                <TextInput value={form.contactName} onChange={(v) => setField('contactName', v)} />
              </FormField>
              <FormField label="Email">
                <TextInput value={form.contactEmail} onChange={(v) => setField('contactEmail', v)} type="email" />
              </FormField>
            </div>
            <FormField label="Téléphone">
              <PhoneInput value={form.contactPhone} onChange={(v) => setField('contactPhone', v)} />
            </FormField>

            <SectionTitle>Adresse</SectionTitle>
            <FormField label="Adresse">
              <TextInput value={form.address} onChange={(v) => setField('address', v)} />
            </FormField>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Code postal">
                <TextInput value={form.postalCode} onChange={(v) => setField('postalCode', v)} />
              </FormField>
              <FormField label="Ville">
                <TextInput value={form.city} onChange={(v) => setField('city', v)} />
              </FormField>
            </div>

            <FormField label="SIRET">
              <TextInput value={form.siret} onChange={(v) => setField('siret', v)} placeholder="123 456 789 00012" />
            </FormField>

            <FormField label="Notes">
              <TextArea value={form.notes} onChange={(v) => setField('notes', v)} rows={2} />
            </FormField>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button type="button" onClick={onClose} className="btn-secondary">
                Annuler
              </button>
              <button type="submit" disabled={isSaving} className="btn-primary">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {supplier ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// MODAL PRODUIT
// =============================================================================

function ProductFormModal({ product, onClose, onSave, isSaving }) {
  const [form, setForm] = useState({
    category: product?.category || '',
    codeFamille: product?.code_famille || '',
    gamme: product?.gamme || '',
    name: product?.name || '',
    reference: product?.reference || '',
    codeEan: product?.code_ean || '',
    tarifPublic: product?.tarif_public?.toString() || '',
    tauxRemise: product?.taux_remise?.toString() || '',
    sellingPriceHt: product?.selling_price_ht?.toString() || '',
    diametre: product?.diametre || '',
    defaultTvaRate: product?.default_tva_rate?.toString() || '20',
    description: product?.description || '',
  });

  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error('Le libellé article est requis');
      return;
    }
    onSave(form);
  };

  // Calcul prix achat = tarif public × (1 - remise%)
  const computedPurchase = form.tarifPublic
    ? Math.round(parseFloat(form.tarifPublic) * (1 - (parseFloat(form.tauxRemise) || 0) / 100) * 100) / 100
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-secondary-900 mb-4">
            {product ? 'Modifier le produit' : 'Nouveau produit'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Identification */}
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Catégorie">
                <SelectInput
                  value={form.category}
                  onChange={(v) => setField('category', v)}
                  options={PRODUCT_CATEGORIES}
                  placeholder="— Choisir —"
                />
              </FormField>
              <FormField label="Code Famille">
                <TextInput value={form.codeFamille} onChange={(v) => setField('codeFamille', v)} />
              </FormField>
            </div>

            <FormField label="Gamme">
              <TextInput value={form.gamme} onChange={(v) => setField('gamme', v)} />
            </FormField>

            <FormField label="Libellé Article" required>
              <TextInput value={form.name} onChange={(v) => setField('name', v)} placeholder="Désignation du produit" />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Référence Fournisseur">
                <TextInput value={form.reference} onChange={(v) => setField('reference', v)} />
              </FormField>
              <FormField label="Code EAN">
                <TextInput value={form.codeEan} onChange={(v) => setField('codeEan', v)} placeholder="Code-barres" />
              </FormField>
            </div>

            <SectionTitle>Tarification</SectionTitle>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Tarif Public HT">
                <TextInput
                  value={form.tarifPublic}
                  onChange={(v) => setField('tarifPublic', v)}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0,00"
                />
              </FormField>
              <FormField label="Taux de Remise (%)">
                <TextInput
                  value={form.tauxRemise}
                  onChange={(v) => setField('tauxRemise', v)}
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  placeholder="0"
                />
              </FormField>
            </div>

            {computedPurchase !== null && (
              <p className="text-xs text-secondary-500">
                Prix d'achat HT calculé : <span className="font-medium text-secondary-700">{formatEuro(computedPurchase)}</span>
              </p>
            )}

            <FormField label="Prix de vente HT">
              <TextInput
                value={form.sellingPriceHt}
                onChange={(v) => setField('sellingPriceHt', v)}
                type="number"
                step="0.01"
                min="0"
                placeholder="0,00"
              />
            </FormField>

            <div className="grid grid-cols-2 gap-3">
              <FormField label="Diamètre">
                <TextInput value={form.diametre} onChange={(v) => setField('diametre', v)} placeholder="Ex: 80mm" />
              </FormField>
              <FormField label="TVA par défaut">
                <SelectInput
                  value={form.defaultTvaRate}
                  onChange={(v) => setField('defaultTvaRate', v)}
                  options={TVA_RATES.map((t) => ({ value: t.value.toString(), label: t.label }))}
                />
              </FormField>
            </div>

            <FormField label="Description">
              <TextArea value={form.description} onChange={(v) => setField('description', v)} rows={2} />
            </FormField>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button type="button" onClick={onClose} className="btn-secondary">
                Annuler
              </button>
              <button type="submit" disabled={isSaving} className="btn-primary">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                {product ? 'Enregistrer' : 'Créer'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// CATALOGUE PRODUITS D'UN FOURNISSEUR
// =============================================================================

// =============================================================================
// IMPORT / EXPORT EXCEL
// =============================================================================

/** Colonnes du template — ordre d'affichage */
const TEMPLATE_COLUMNS = [
  'Catégorie',
  'Code Famille',
  'Gamme',
  'Libellé Article',
  'Référence Fournisseurs',
  'Code EAN',
  'Tarif Public',
  'Taux de Remise',
  'Diamètre',
];

/** Supprime accents + lowercase + trim + espaces multiples → un seul */
function normalizeHeader(str) {
  return str
    .toString()
    .normalize('NFD')                      // décompose é → e + ́
    .replace(/[\u0300-\u036f]/g, '')       // supprime les diacritiques
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')            // remplace tout non-alphanum par espace
    .replace(/\s+/g, ' ')                  // espaces multiples → un seul
    .trim();
}

/** Mapping normalisé → champ app */
const EXCEL_COLUMN_MAP = {
  'categorie': 'category',
  'code famille': 'codeFamille',
  'gamme': 'gamme',
  'libelle article': 'name',
  'libelle': 'name',
  'designation': 'name',
  'reference fournisseurs': 'reference',
  'reference fournisseur': 'reference',
  'reference': 'reference',
  'ref': 'reference',
  'code ean': 'codeEan',
  'ean': 'codeEan',
  'tarif public': 'tarifPublic',
  'prix public': 'tarifPublic',
  'taux de remise': 'tauxRemise',
  'taux remise': 'tauxRemise',
  'remise': 'tauxRemise',
  'diametre': 'diametre',
  'prix de vente': 'sellingPriceHt',
  'prix vente ht': 'sellingPriceHt',
  'pv ht': 'sellingPriceHt',
  'tva': 'defaultTvaRate',
};

function normalizeCategory(raw) {
  if (!raw) return null;
  const n = normalizeHeader(raw);
  const mapping = {
    'poele': 'poele', 'poeles': 'poele',
    'climatisation': 'climatisation', 'clim': 'climatisation',
    'chauffage': 'chauffage',
    'fumisterie': 'fumisterie',
  };
  return mapping[n] || null;
}

function parseExcelRows(worksheet) {
  const jsonRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
  if (!jsonRows.length) return [];

  // Map headers with normalized matching
  const firstRow = jsonRows[0];
  const headerMap = {};
  const unmapped = [];
  for (const key of Object.keys(firstRow)) {
    const normalized = normalizeHeader(key);
    if (EXCEL_COLUMN_MAP[normalized]) {
      headerMap[key] = EXCEL_COLUMN_MAP[normalized];
    } else {
      unmapped.push(key);
    }
  }

  console.log('[Import Excel] Colonnes mappées:', Object.fromEntries(Object.entries(headerMap).map(([k, v]) => [k, v])));
  if (unmapped.length) console.log('[Import Excel] Colonnes ignorées:', unmapped);

  if (Object.keys(headerMap).length === 0) {
    console.error('[Import Excel] Aucune colonne reconnue. Colonnes trouvées:', Object.keys(firstRow));
    return [];
  }

  return jsonRows.map((row) => {
    const mapped = {};
    for (const [excelKey, appKey] of Object.entries(headerMap)) {
      mapped[appKey] = row[excelKey]?.toString().trim() || '';
    }
    if (mapped.category) mapped.category = normalizeCategory(mapped.category);
    return mapped;
  }).filter((r) => r.name);
}

function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS]);
  // Largeurs colonnes
  ws['!cols'] = TEMPLATE_COLUMNS.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Produits');
  XLSX.writeFile(wb, 'template_produits_fournisseur.xlsx');
}

// =============================================================================
// CATALOGUE PRODUITS D'UN FOURNISSEUR
// =============================================================================

function ProductCatalog({ supplier, orgId, onBack }) {
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const { products, totalCount, isLoading, refetch } = useSupplierProducts(supplier.id, { search: debouncedSearch, page, pageSize });
  const { createProduct, updateProduct, deactivateProduct, isCreating, isUpdating } = useProductMutations(orgId, supplier.id);
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef(null);
  const searchTimerRef = useRef(null);

  const handleSearch = (value) => {
    setSearch(value);
    clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => {
      setDebouncedSearch(value);
      setPage(0);
    }, 400);
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  const handleSave = async (form) => {
    try {
      if (editProduct) {
        const result = await updateProduct(editProduct.id, form);
        if (result?.error) throw result.error;
        toast.success('Produit mis à jour');
      } else {
        const result = await createProduct(form);
        if (result?.error) throw result.error;
        toast.success('Produit créé');
      }
      setShowModal(false);
      setEditProduct(null);
    } catch (err) {
      toast.error(err?.message || 'Erreur lors de la sauvegarde');
    }
  };

  const handleDelete = async (product) => {
    if (!window.confirm(`Supprimer "${product.name}" ?`)) return;
    try {
      const result = await deactivateProduct(product.id);
      if (result?.error) throw result.error;
      toast.success('Produit supprimé');
    } catch (err) {
      toast.error(err?.message || 'Erreur lors de la suppression');
    }
  };

  const handleImportExcel = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';

    setImporting(true);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = parseExcelRows(firstSheet);

      if (rows.length === 0) {
        toast.error('Aucune ligne valide trouvée. Vérifiez que le fichier contient une colonne "Libellé Article". Utilisez le template pour le bon format.');
        return;
      }

      const result = await suppliersService.bulkCreateProducts(supplier.id, orgId, rows);
      if (result?.error) throw result.error;

      toast.success(`${result.data.imported} produit${result.data.imported > 1 ? 's' : ''} importé${result.data.imported > 1 ? 's' : ''}`);
      refetch();
    } catch (err) {
      console.error('[Import Excel]', err);
      toast.error(err?.message || 'Erreur lors de l\'import');
    } finally {
      setImporting(false);
    }
  };

  const categoryLabel = (code) => PRODUCT_CATEGORIES.find((c) => c.value === code)?.label || code || '—';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-secondary-100 rounded-lg">
          <ArrowLeft className="w-5 h-5 text-secondary-600" />
        </button>
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-secondary-900">{supplier.name}</h2>
          <p className="text-sm text-secondary-500">{totalCount} produit{totalCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-2">
          {/* Import Excel */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleImportExcel}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
            className="btn-secondary btn-sm"
          >
            {importing ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Upload className="w-4 h-4 mr-1" />}
            Import Excel
          </button>
          <button onClick={() => { setEditProduct(null); setShowModal(true); }} className="btn-primary btn-sm">
            <Plus className="w-4 h-4 mr-1" /> Produit
          </button>
        </div>
      </div>

      {/* Import info + template download */}
      <div className="flex items-center justify-between bg-secondary-50 rounded px-3 py-2">
        <p className="text-xs text-secondary-400">
          <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1" />
          Colonnes : Catégorie, Code Famille, Gamme, Libellé Article, Référence Fournisseurs, Code EAN, Tarif Public, Taux de Remise, Diamètre
        </p>
        <button onClick={downloadTemplate} className="text-xs text-primary-600 hover:text-primary-700 font-medium whitespace-nowrap ml-3">
          Télécharger template
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Rechercher un produit..."
          className="w-full pl-10 pr-8 py-2 border border-secondary-300 rounded-lg text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
        {search && (
          <button onClick={() => { setSearch(''); setDebouncedSearch(''); setPage(0); }} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-secondary-400" />
          </button>
        )}
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <div className="text-center py-12 text-secondary-500">
          <Package className="w-10 h-10 mx-auto mb-2 opacity-40" />
          <p>{search ? 'Aucun produit trouvé' : 'Aucun produit — ajoutez-en un ou importez un fichier Excel'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-secondary-200 text-left text-secondary-500">
                <th className="py-2 pr-3 font-medium">Catégorie</th>
                <th className="py-2 pr-3 font-medium">Famille</th>
                <th className="py-2 pr-3 font-medium">Libellé</th>
                <th className="py-2 pr-3 font-medium">Réf.</th>
                <th className="py-2 pr-3 font-medium text-right">Tarif Public</th>
                <th className="py-2 pr-3 font-medium text-right">Remise</th>
                <th className="py-2 pr-3 font-medium text-right">Achat HT</th>
                <th className="py-2 pr-3 font-medium text-right">Vente HT</th>
                <th className="py-2 font-medium w-16"></th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-b border-secondary-100 hover:bg-secondary-50">
                  <td className="py-2 pr-3 text-secondary-500 text-xs">{categoryLabel(product.category)}</td>
                  <td className="py-2 pr-3 text-secondary-500 text-xs">{product.code_famille || '—'}</td>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-secondary-900">{product.name}</div>
                    {product.gamme && <div className="text-xs text-secondary-400">{product.gamme}</div>}
                  </td>
                  <td className="py-2 pr-3 text-secondary-500 text-xs">{product.reference || '—'}</td>
                  <td className="py-2 pr-3 text-right text-secondary-500">{product.tarif_public ? formatEuro(product.tarif_public) : '—'}</td>
                  <td className="py-2 pr-3 text-right text-secondary-500">{product.taux_remise ? `${product.taux_remise}%` : '—'}</td>
                  <td className="py-2 pr-3 text-right text-secondary-600">{formatEuro(product.purchase_price_ht)}</td>
                  <td className="py-2 pr-3 text-right font-medium text-secondary-900">{formatEuro(product.selling_price_ht)}</td>
                  <td className="py-2 text-right">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={() => { setEditProduct(product); setShowModal(true); }}
                        className="p-1.5 hover:bg-secondary-100 rounded"
                        title="Modifier"
                      >
                        <Pencil className="w-3.5 h-3.5 text-secondary-500" />
                      </button>
                      <button
                        onClick={() => handleDelete(product)}
                        className="p-1.5 hover:bg-red-50 rounded"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-400" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-secondary-400">
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} sur {totalCount}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="px-3 py-1 text-sm border rounded hover:bg-secondary-50 disabled:opacity-30"
            >
              Préc.
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1 text-sm border rounded hover:bg-secondary-50 disabled:opacity-30"
            >
              Suiv.
            </button>
          </div>
        </div>
      )}

      {showModal && (
        <ProductFormModal
          product={editProduct}
          onClose={() => { setShowModal(false); setEditProduct(null); }}
          onSave={handleSave}
          isSaving={isCreating || isUpdating}
        />
      )}
    </div>
  );
}

// =============================================================================
// PAGE PRINCIPALE
// =============================================================================

export default function SupplierManagement() {
  const { organization } = useAuth();
  const orgId = organization?.id;

  const { suppliers, isLoading } = useSuppliers(orgId);
  const { createSupplier, updateSupplier, deactivateSupplier, isCreating, isUpdating } = useSupplierMutations(orgId);

  const [showModal, setShowModal] = useState(false);
  const [editSupplier, setEditSupplier] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);

  const handleSave = async (form) => {
    try {
      if (editSupplier) {
        const result = await updateSupplier(editSupplier.id, form);
        if (result?.error) throw result.error;
        toast.success('Fournisseur mis à jour');
      } else {
        const result = await createSupplier(form);
        if (result?.error) throw result.error;
        toast.success('Fournisseur créé');
      }
      setShowModal(false);
      setEditSupplier(null);
    } catch (err) {
      toast.error(err?.message || 'Erreur lors de la sauvegarde');
    }
  };

  const handleDelete = async (supplier) => {
    if (!window.confirm(`Supprimer "${supplier.name}" et tout son catalogue ?`)) return;
    try {
      const result = await deactivateSupplier(supplier.id);
      if (result?.error) throw result.error;
      toast.success('Fournisseur supprimé');
    } catch (err) {
      toast.error(err?.message || 'Erreur lors de la suppression');
    }
  };

  // Si un fournisseur est sélectionné → afficher son catalogue
  if (selectedSupplier) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-secondary-500">
          <Link to="/settings" className="hover:text-secondary-700">Paramètres</Link>
          <span>/</span>
          <button onClick={() => setSelectedSupplier(null)} className="hover:text-secondary-700">Fournisseurs</button>
          <span>/</span>
          <span className="text-secondary-900">{selectedSupplier.name}</span>
        </div>
        <div className="card">
          <ProductCatalog supplier={selectedSupplier} orgId={orgId} onBack={() => setSelectedSupplier(null)} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-secondary-500">
        <Link to="/settings" className="hover:text-secondary-700">Paramètres</Link>
        <span>/</span>
        <span className="text-secondary-900">Fournisseurs</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Fournisseurs</h1>
          <p className="text-secondary-600">Gérez vos fournisseurs et leurs catalogues produits</p>
        </div>
        <button onClick={() => { setEditSupplier(null); setShowModal(true); }} className="btn-primary">
          <Plus className="w-4 h-4 mr-2" /> Fournisseur
        </button>
      </div>

      {/* Liste */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-6 h-6 text-primary-600 animate-spin" />
        </div>
      ) : suppliers.length === 0 ? (
        <div className="card text-center py-12">
          <Building2 className="w-12 h-12 mx-auto text-secondary-300 mb-3" />
          <p className="text-secondary-500 mb-4">Aucun fournisseur</p>
          <button onClick={() => setShowModal(true)} className="btn-primary btn-sm mx-auto">
            <Plus className="w-4 h-4 mr-1" /> Ajouter un fournisseur
          </button>
        </div>
      ) : (
        <div className="grid gap-3">
          {suppliers.map((supplier) => (
            <div
              key={supplier.id}
              className="card-hover flex items-center gap-4 cursor-pointer"
              onClick={() => setSelectedSupplier(supplier)}
            >
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center flex-shrink-0">
                <Building2 className="w-5 h-5 text-primary-600" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-medium text-secondary-900">{supplier.name}</h3>
                <p className="text-sm text-secondary-500 truncate">
                  {[supplier.contact_name, supplier.city].filter(Boolean).join(' · ') || 'Aucun contact'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); setEditSupplier(supplier); setShowModal(true); }}
                  className="p-2 hover:bg-secondary-100 rounded-lg"
                  title="Modifier"
                >
                  <Pencil className="w-4 h-4 text-secondary-500" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(supplier); }}
                  className="p-2 hover:bg-red-50 rounded-lg"
                  title="Supprimer"
                >
                  <Trash2 className="w-4 h-4 text-red-400" />
                </button>
                <ChevronRight className="w-5 h-5 text-secondary-400" />
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <SupplierFormModal
          supplier={editSupplier}
          onClose={() => { setShowModal(false); setEditSupplier(null); }}
          onSave={handleSave}
          isSaving={isCreating || isUpdating}
        />
      )}
    </div>
  );
}
