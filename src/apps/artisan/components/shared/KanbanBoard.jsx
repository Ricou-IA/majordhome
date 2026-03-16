/**
 * KanbanBoard.jsx - Majord'home Artisan
 * ============================================================================
 * Generic Kanban board component with optional drag & drop.
 *
 * Extracts the common patterns from LeadKanban, ChantierKanban, and
 * EntretienSAVKanban into a single reusable component.
 *
 * Features:
 * - Configurable columns (array of { id, label, color })
 * - Items grouped by a configurable field (groupBy)
 * - Optional drag & drop via @hello-pangea/dnd (pass onDragEnd to enable)
 * - Client-side search filtering via searchFilter callback
 * - Custom card rendering via renderCard
 * - Column header with count, optional amount sum, color dot
 * - Optional headerExtra render prop per column
 * - Scrollable columns with consistent sizing
 *
 * @version 1.0.0
 * ============================================================================
 */

import { useState, useMemo } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { Search, X } from 'lucide-react';
import { formatEuro } from '@/lib/utils';

// ============================================================================
// COLUMN (INTERNAL)
// ============================================================================

/**
 * Single kanban column — renders either as a Droppable (DnD mode) or a plain
 * div (static mode). The caller decides which wrapper to use.
 */
function ColumnContent({
  column,
  items,
  onCardClick,
  renderCard,
  emptyMessage,
  columnAmount,
  headerExtra,
  // DnD props — only present when DnD is enabled
  droppableProvided,
  isDraggingOver,
}) {
  const count = items.length;
  const amount = columnAmount ? columnAmount(items) : null;

  return (
    <div
      className={`
        flex flex-col bg-gray-50 rounded-xl min-w-0 flex-1 basis-0
        border transition-colors
        ${isDraggingOver ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200'}
      `}
    >
      {/* Header */}
      <div className="px-3 py-3 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="w-3 h-3 rounded-full shrink-0"
              style={{ backgroundColor: column.color }}
            />
            <h3 className="font-semibold text-sm text-gray-800 truncate">
              {column.label}
            </h3>
          </div>
          <span className="text-xs font-medium bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">
            {count}
          </span>
        </div>
        {amount !== null && (
          <p className={`text-xs mt-1 ${amount > 0 ? 'text-gray-500' : 'text-gray-300'}`}>
            {formatEuro(amount)}
          </p>
        )}
        {headerExtra && (
          <div className="mt-1">
            {headerExtra(column, items)}
          </div>
        )}
      </div>

      {/* Cards area */}
      <div
        ref={droppableProvided?.innerRef}
        {...(droppableProvided?.droppableProps || {})}
        className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[100px] max-h-[calc(100vh-280px)]"
      >
        {droppableProvided
          ? /* DnD mode — wrap each card in a Draggable */
            items.map((item, index) => (
              <Draggable key={item.id} draggableId={item.id} index={index}>
                {(dragProvided, snapshot) => (
                  <div
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    onClick={() => onCardClick?.(item)}
                    className={snapshot.isDragging ? 'opacity-90 rotate-1 shadow-lg' : ''}
                  >
                    {renderCard(item)}
                  </div>
                )}
              </Draggable>
            ))
          : /* Static mode — plain cards */
            items.map((item) => (
              <div key={item.id} onClick={() => onCardClick?.(item)}>
                {renderCard(item)}
              </div>
            ))
        }

        {droppableProvided?.placeholder}

        {count === 0 && (
          <p className="text-xs text-gray-400 text-center py-6 italic">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

/**
 * @param {Object} props
 * @param {Array}    props.items           - All items to display
 * @param {Array}    props.columns         - Column definitions: [{ id, label, color }]
 * @param {string}   props.groupBy         - Field name to group items into columns
 * @param {Function} props.renderCard      - (item) => JSX for the card
 * @param {Function} [props.onCardClick]   - (item) => void when a card is clicked
 * @param {Function} [props.onDragEnd]     - (result) => void — pass to enable DnD, null/undefined to disable
 * @param {string}   [props.searchPlaceholder] - Placeholder for the search input
 * @param {Function} [props.searchFilter]  - (item, query) => boolean — client-side filter
 * @param {Function} [props.columnAmount]  - (items) => number — optional amount to display per column
 * @param {Function} [props.headerExtra]   - (column, items) => JSX — extra content in column header
 * @param {string}   [props.emptyMessage]  - Message when a column is empty
 * @param {React.ReactNode} [props.children] - Extra content rendered after the board (modals, etc.)
 * @param {React.ReactNode} [props.headerLeft] - Content on the left of the header bar
 * @param {React.ReactNode} [props.headerRight] - Extra buttons on the right of the header bar (before search)
 */
export function KanbanBoard({
  items,
  columns,
  groupBy,
  renderCard,
  onCardClick,
  onDragEnd,
  searchPlaceholder = 'Rechercher...',
  searchFilter,
  columnAmount,
  headerExtra,
  emptyMessage = 'Aucun element',
  children,
  headerLeft,
  headerRight,
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const dndEnabled = typeof onDragEnd === 'function';

  // --- Client-side search filtering ---
  const filteredItems = useMemo(() => {
    if (!searchFilter || !searchTerm.trim()) return items;
    const query = searchTerm.trim();
    return items.filter((item) => searchFilter(item, query));
  }, [items, searchTerm, searchFilter]);

  // --- Group items by the groupBy field ---
  const columnData = useMemo(() => {
    const map = {};
    for (const col of columns) {
      map[col.id] = [];
    }
    for (const item of filteredItems) {
      const key = item[groupBy];
      if (map[key]) {
        map[key].push(item);
      }
    }
    return map;
  }, [columns, filteredItems, groupBy]);

  // --- Render a single column ---
  const renderColumn = (column) => {
    const colItems = columnData[column.id] || [];

    if (dndEnabled) {
      return (
        <Droppable key={column.id} droppableId={column.id}>
          {(provided, snapshot) => (
            <ColumnContent
              column={column}
              items={colItems}
              onCardClick={onCardClick}
              renderCard={renderCard}
              emptyMessage={emptyMessage}
              columnAmount={columnAmount}
              headerExtra={headerExtra}
              droppableProvided={provided}
              isDraggingOver={snapshot.isDraggingOver}
            />
          )}
        </Droppable>
      );
    }

    return (
      <ColumnContent
        key={column.id}
        column={column}
        items={colItems}
        onCardClick={onCardClick}
        renderCard={renderCard}
        emptyMessage={emptyMessage}
        columnAmount={columnAmount}
        headerExtra={headerExtra}
        isDraggingOver={false}
      />
    );
  };

  // --- Board content (columns) ---
  const boardContent = (
    <div className="flex gap-3 pb-4 overflow-x-auto">
      {columns.map(renderColumn)}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header bar */}
      {(searchFilter || headerLeft || headerRight) && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {headerLeft ?? (
              <p className="text-sm text-gray-500">
                {searchTerm.trim()
                  ? `${filteredItems.length} / ${items.length} element${items.length !== 1 ? 's' : ''}`
                  : `${items.length} element${items.length !== 1 ? 's' : ''}`}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {headerRight}
            {searchFilter && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-[220px] pl-9 pr-8 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-colors min-h-[40px]"
                  placeholder={searchPlaceholder}
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Board */}
      {dndEnabled ? (
        <DragDropContext onDragEnd={onDragEnd}>
          {boardContent}
        </DragDropContext>
      ) : (
        boardContent
      )}

      {/* Extra content (modals, prompts, etc.) */}
      {children}
    </div>
  );
}

export default KanbanBoard;
