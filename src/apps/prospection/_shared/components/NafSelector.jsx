/**
 * NafSelector.jsx — Sélecteur NAF browsable avec sections, groupes et checkboxes
 * Permet de naviguer le glossaire NAF par sections et cocher les codes à utiliser.
 */

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  ChevronDown,
  ChevronRight,
  Check,
  X,
  Filter,
} from 'lucide-react';
import { NAF_SECTIONS, searchNafCodes, NAF_LABELS } from '../lib/nafGlossary';

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function NafSelector({ selectedCodes = [], onChange, module, defaultOpen = false }) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedSections, setExpandedSections] = useState(new Set(['F'])); // BTP ouvert par défaut
  const containerRef = useRef(null);

  // Fermer le panneau au clic en dehors
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Recherche dans le glossaire
  const searchResults = useMemo(() => {
    if (searchQuery.length < 2) return null;
    return searchNafCodes(searchQuery);
  }, [searchQuery]);

  // Toggle un code
  const toggleCode = useCallback((code) => {
    const newSet = new Set(selectedCodes);
    if (newSet.has(code)) {
      newSet.delete(code);
    } else {
      newSet.add(code);
    }
    onChange([...newSet]);
  }, [selectedCodes, onChange]);

  // Toggle tout un groupe
  const toggleGroup = useCallback((groupCodes) => {
    const allSelected = groupCodes.every((c) => selectedCodes.includes(c.code));
    const newSet = new Set(selectedCodes);
    if (allSelected) {
      groupCodes.forEach((c) => newSet.delete(c.code));
    } else {
      groupCodes.forEach((c) => newSet.add(c.code));
    }
    onChange([...newSet]);
  }, [selectedCodes, onChange]);

  // Toggle section expanded
  const toggleSection = useCallback((sectionCode) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionCode)) next.delete(sectionCode);
      else next.add(sectionCode);
      return next;
    });
  }, []);

  // Clear all
  const clearAll = useCallback(() => onChange([]), [onChange]);

  return (
    <div ref={containerRef} className="space-y-2">
      {/* Toggle button + selected pills */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`inline-flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors ${
            isOpen
              ? 'bg-[#2196F3]/10 border-[#2196F3] text-[#2196F3]'
              : 'border-secondary-300 text-secondary-600 hover:border-secondary-400 hover:bg-secondary-50'
          }`}
        >
          <Filter className="w-4 h-4" />
          Codes NAF
          {selectedCodes.length > 0 && (
            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#2196F3] text-white text-xs font-bold">
              {selectedCodes.length}
            </span>
          )}
          {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        {/* Selected code pills */}
        {selectedCodes.map((code) => (
          <span
            key={code}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium bg-[#2196F3]/10 text-[#1565C0] rounded-full"
          >
            {code}
            <button
              type="button"
              onClick={() => toggleCode(code)}
              className="p-0.5 hover:bg-[#2196F3]/20 rounded-full"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}

        {selectedCodes.length > 1 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-xs text-secondary-500 hover:text-secondary-700 underline"
          >
            Tout retirer
          </button>
        )}
      </div>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="border border-secondary-200 rounded-lg bg-white shadow-sm max-h-[420px] overflow-hidden flex flex-col">
          {/* Search within glossary */}
          <div className="p-3 border-b border-secondary-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-secondary-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrer les codes NAF (ex: plomberie, 43.22...)"
                className="w-full pl-8 pr-3 py-1.5 border border-secondary-200 rounded-md text-sm outline-none focus:ring-1 focus:ring-[#2196F3] focus:border-[#2196F3]"
              />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-2">
            {searchResults ? (
              // Search results mode
              searchResults.length > 0 ? (
                <div className="space-y-0.5">
                  {searchResults.map((item) => {
                    const isSelected = selectedCodes.includes(item.code);
                    return (
                      <NafCodeRow
                        key={item.code}
                        code={item.code}
                        label={item.label}
                        subtitle={`${item.section} › ${item.group}`}
                        isSelected={isSelected}
                        highlight={module && item.highlightFor?.includes(module)}
                        onToggle={() => toggleCode(item.code)}
                      />
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-secondary-400 text-center py-4">
                  Aucun code NAF pour « {searchQuery} »
                </p>
              )
            ) : (
              // Browse mode — sections & groups
              <div className="space-y-1">
                {NAF_SECTIONS.map((section) => {
                  const isExpanded = expandedSections.has(section.code);
                  const sectionSelectedCount = section.groups.reduce(
                    (sum, g) => sum + g.codes.filter((c) => selectedCodes.includes(c.code)).length,
                    0
                  );

                  return (
                    <div key={section.code}>
                      {/* Section header */}
                      <button
                        type="button"
                        onClick={() => toggleSection(section.code)}
                        className="w-full flex items-center gap-2 px-2 py-2 text-sm font-semibold text-secondary-700 hover:bg-secondary-50 rounded-md transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-secondary-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-secondary-400" />
                        )}
                        <span>{section.icon}</span>
                        <span className="flex-1 text-left">{section.label}</span>
                        {sectionSelectedCount > 0 && (
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-[#2196F3] text-white font-bold">
                            {sectionSelectedCount}
                          </span>
                        )}
                      </button>

                      {/* Groups & codes */}
                      {isExpanded && (
                        <div className="ml-4 space-y-2 pb-2">
                          {section.groups.map((group) => {
                            const groupSelected = group.codes.filter((c) =>
                              selectedCodes.includes(c.code)
                            ).length;
                            const allSelected = groupSelected === group.codes.length;

                            const isHighlighted = module && group.highlightFor?.includes(module);

                            return (
                              <div key={group.label}>
                                {/* Group header with "select all" */}
                                <button
                                  type="button"
                                  onClick={() => toggleGroup(group.codes)}
                                  className={`flex items-center gap-2 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider rounded-md w-full text-left transition-colors ${
                                    isHighlighted
                                      ? 'text-[#1565C0] bg-[#2196F3]/5 hover:bg-[#2196F3]/10'
                                      : 'text-secondary-500 hover:bg-secondary-50'
                                  }`}
                                >
                                  <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center flex-shrink-0 ${
                                    allSelected
                                      ? 'bg-[#2196F3] border-[#2196F3]'
                                      : groupSelected > 0
                                        ? 'bg-[#2196F3]/30 border-[#2196F3]'
                                        : 'border-secondary-300'
                                  }`}>
                                    {allSelected && <Check className="w-2.5 h-2.5 text-white" />}
                                  </span>
                                  <span className="flex-1">{group.label}</span>
                                  {groupSelected > 0 && (
                                    <span className="text-[10px] text-[#2196F3]">
                                      {groupSelected}/{group.codes.length}
                                    </span>
                                  )}
                                </button>

                                {/* Individual codes */}
                                <div className="ml-2 space-y-0.5 mt-0.5">
                                  {group.codes.map((c) => (
                                    <NafCodeRow
                                      key={c.code}
                                      code={c.code}
                                      label={c.label}
                                      isSelected={selectedCodes.includes(c.code)}
                                      highlight={isHighlighted}
                                      onToggle={() => toggleCode(c.code)}
                                    />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENT — NafCodeRow
// ============================================================================

function NafCodeRow({ code, label, subtitle, isSelected, highlight, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-colors ${
        isSelected
          ? 'bg-[#2196F3]/10'
          : 'hover:bg-secondary-50'
      }`}
    >
      <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${
        isSelected
          ? 'bg-[#2196F3] border-[#2196F3]'
          : 'border-secondary-300'
      }`}>
        {isSelected && <Check className="w-3 h-3 text-white" />}
      </span>
      <span className={`text-xs font-mono flex-shrink-0 ${
        highlight ? 'text-[#1565C0] font-semibold' : 'text-secondary-500'
      }`}>
        {code}
      </span>
      <span className="text-sm text-secondary-700 truncate">{label}</span>
      {subtitle && (
        <span className="text-[10px] text-secondary-400 truncate ml-auto flex-shrink-0">{subtitle}</span>
      )}
    </button>
  );
}
