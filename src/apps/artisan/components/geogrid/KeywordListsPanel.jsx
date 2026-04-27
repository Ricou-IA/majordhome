import { useState } from 'react';
import { Plus, Edit2, Trash2, X, Save, ListChecks, Hash } from 'lucide-react';
import {
  useKeywordLists,
  useCreateKeywordList,
  useUpdateKeywordList,
  useDeleteKeywordList,
} from '@hooks/useGeoGrid';

export default function KeywordListsPanel({ orgId }) {
  const [editingList, setEditingList] = useState(null); // null = none, {} = creating new, { id, ... } = editing existing
  const { data: lists, isLoading } = useKeywordLists(orgId);
  const createList = useCreateKeywordList();
  const updateList = useUpdateKeywordList();
  const deleteList = useDeleteKeywordList();

  const handleNew = () => {
    setEditingList({ name: '', description: '', keywords: [] });
  };

  const handleEdit = (list) => {
    setEditingList({ ...list });
  };

  const handleCancel = () => {
    setEditingList(null);
  };

  const handleSave = async () => {
    if (!editingList.name.trim() || !editingList.keywords.length) return;

    if (editingList.id) {
      await updateList.mutateAsync({
        listId: editingList.id,
        orgId,
        name: editingList.name.trim(),
        description: editingList.description?.trim() || null,
        keywords: editingList.keywords,
      });
    } else {
      await createList.mutateAsync({
        orgId,
        name: editingList.name.trim(),
        description: editingList.description?.trim() || null,
        keywords: editingList.keywords,
      });
    }
    setEditingList(null);
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cette liste ? Les benchmarks associés seront aussi supprimés.')) return;
    await deleteList.mutateAsync(id);
  };

  const handleKeywordsChange = (text) => {
    const keywords = text
      .split('\n')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
    setEditingList((prev) => ({ ...prev, keywords }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-secondary-600">
          Listes de mots-clés réutilisables pour les benchmarks. Une liste = un thermomètre cohérent à mesurer dans le temps.
        </p>
        {!editingList && (
          <button
            onClick={handleNew}
            className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700"
          >
            <Plus className="w-4 h-4" />
            Nouvelle liste
          </button>
        )}
      </div>

      {/* Editor (création ou édition) */}
      {editingList && (
        <div className="bg-white rounded-lg border-2 border-primary-200 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-secondary-900">
              {editingList.id ? 'Modifier la liste' : 'Nouvelle liste'}
            </h3>
            <button onClick={handleCancel} className="text-secondary-400 hover:text-secondary-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">Nom</label>
            <input
              type="text"
              value={editingList.name}
              onChange={(e) => setEditingList((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Ex: Mayer SEO 2026"
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">Description (optionnel)</label>
            <textarea
              value={editingList.description || ''}
              onChange={(e) => setEditingList((prev) => ({ ...prev, description: e.target.value }))}
              placeholder="Contexte de cette liste, sources des keywords, objectif..."
              rows={2}
              className="w-full px-3 py-1.5 text-sm border rounded-md focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-secondary-600 mb-1">
              Keywords <span className="text-secondary-400">(1 par ligne)</span>
              <span className="ml-2 text-primary-600 font-medium">{editingList.keywords.length} keywords</span>
            </label>
            <textarea
              value={editingList.keywords.join('\n')}
              onChange={(e) => handleKeywordsChange(e.target.value)}
              placeholder={`installation climatisation\nramoneur autour de moi\npoele a granulés\n...`}
              rows={12}
              className="w-full px-3 py-1.5 text-sm border rounded-md font-mono focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-sm font-medium text-secondary-700 hover:bg-secondary-100 rounded-md"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={!editingList.name.trim() || !editingList.keywords.length || createList.isPending || updateList.isPending}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary-600 text-white text-sm font-medium rounded-md hover:bg-primary-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {editingList.id ? 'Enregistrer' : 'Créer'}
            </button>
          </div>
        </div>
      )}

      {/* Liste des listes existantes */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 bg-secondary-100 rounded animate-pulse" />
          ))}
        </div>
      ) : !lists?.length ? (
        <div className="bg-white rounded-lg border p-8 text-center">
          <ListChecks className="w-12 h-12 text-secondary-300 mx-auto mb-3" />
          <p className="text-sm text-secondary-500">Aucune liste créée. Crée ta première liste pour lancer un benchmark.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {lists.map((list) => (
            <div key={list.id} className="bg-white rounded-lg border p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="font-semibold text-secondary-900">{list.name}</h4>
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-primary-100 text-primary-700 flex items-center gap-0.5">
                      <Hash className="w-3 h-3" />
                      {list.keyword_count || 0}
                    </span>
                  </div>
                  {list.description && (
                    <p className="text-xs text-secondary-500 mt-1 line-clamp-2">{list.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={() => handleEdit(list)}
                    className="p-1.5 rounded hover:bg-primary-100 text-primary-600"
                    title="Éditer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(list.id)}
                    className="p-1.5 rounded hover:bg-red-100 text-red-500"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {list.keywords?.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {list.keywords.slice(0, 8).map((kw) => (
                    <span key={kw} className="text-[10px] px-1.5 py-0.5 bg-secondary-100 text-secondary-700 rounded">
                      {kw}
                    </span>
                  ))}
                  {list.keywords.length > 8 && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-secondary-50 text-secondary-500 rounded">
                      +{list.keywords.length - 8}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
