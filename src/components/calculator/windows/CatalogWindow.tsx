import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  GripVertical,
  Plus,
  ChevronRight,
  ChevronDown,
  Layers,
  Sparkles,
  Settings,
  Folder,
  FolderOpen,
  FolderTree,
  FileSpreadsheet,
  Scissors,
  RefreshCw,
  Database,
} from 'lucide-react';
import { MaterialItem, MaterialCategory, MATERIAL_CATEGORIES } from '../../../types/calculator';

interface Props {
  materials: MaterialItem[];
  onOpenMasterData: () => void;
  onOpenImportPrice?: () => void;
  onAddMaterial: (mat: MaterialItem) => void;
  onRefreshMaterials?: () => Promise<void> | void;
  isRefreshing?: boolean;
  collapseSignal?: number;
}

// 5 Main Branches defined in technical requirements
interface CatalogBranch {
  id: string;
  name: string;
  icon: string;
  subcategories: Array<{
    name: string;
    matcher: (m: MaterialItem) => boolean;
  }>;
}

const CATALOG_BRANCHES: CatalogBranch[] = [
  {
    id: 'metal',
    name: 'Металопрокат',
    icon: 'Box',
    subcategories: [
      {
        name: 'Чорний метал (Лист, Проф. труба, Кутник, Круг, Квадрат, Арматура)',
        matcher: (m) =>
          (m.category === 'metal_profile' || m.category === 'sheet_metal' || m.parentCategory === 'Металопрокат') &&
          !m.subcategory?.toLowerCase().includes('нержав') &&
          !m.subcategory?.toLowerCase().includes('алюмін') &&
          !m.name.toLowerCase().includes('нержав') &&
          !m.name.toLowerCase().includes('aisi') &&
          !m.name.toLowerCase().includes('алюмін') &&
          !m.name.toLowerCase().includes('т-паз'),
      },
      {
        name: 'Нержавіючий метал (AISI 304)',
        matcher: (m) =>
          (m.category === 'metal_profile' || m.category === 'sheet_metal' || m.parentCategory === 'Металопрокат') &&
          (m.subcategory === 'Нержавіючий метал' ||
            m.subcategory?.toLowerCase().includes('нержав') ||
            m.name.toLowerCase().includes('нержав') ||
            m.name.toLowerCase().includes('aisi')),
      },
      {
        name: 'Алюміній (Профіль, Лист, Бокс)',
        matcher: (m) =>
          (m.category === 'metal_profile' || m.category === 'sheet_metal' || m.parentCategory === 'Металопрокат') &&
          (m.subcategory === 'Алюміній' ||
            m.subcategory?.toLowerCase().includes('алюмін') ||
            m.name.toLowerCase().includes('алюмін') ||
            m.name.toLowerCase().includes('т-паз')),
      },
    ],
  },
  {
    id: 'plate_wood',
    name: 'Плитні матеріали',
    icon: 'Grid',
    subcategories: [
      {
        name: 'ДСП (Egger, Kronospan, Кромка)',
        matcher: (m) =>
          m.category === 'plate_wood' &&
          (m.subcategory === 'ДСП' ||
            m.name.toLowerCase().includes('дсп') ||
            m.name.toLowerCase().includes('кромка')),
      },
      {
        name: 'МДФ (Шліфований, Вологостійкий, Фасади)',
        matcher: (m) =>
          m.category === 'plate_wood' &&
          (m.subcategory === 'МДФ' || m.name.toLowerCase().includes('мдф')),
      },
      {
        name: 'Фанера (ФСФ березова)',
        matcher: (m) =>
          m.category === 'plate_wood' &&
          (m.subcategory === 'Фанера' || m.name.toLowerCase().includes('фанер')),
      },
    ],
  },
  {
    id: 'glass_mirror',
    name: 'Скло та дзеркала',
    icon: 'Sparkles',
    subcategories: [
      {
        name: 'Скло (Гартоване Optiwhite, Тоноване, Триплекс)',
        matcher: (m) =>
          m.category === 'glass_mirror' &&
          (m.subcategory === 'Скло' || m.name.toLowerCase().includes('скло')),
      },
      {
        name: 'Дзеркало (Срібло армоване, Бронза, Графіт)',
        matcher: (m) =>
          m.category === 'glass_mirror' &&
          (m.subcategory === 'Дзеркало' || m.name.toLowerCase().includes('дзеркал')),
      },
    ],
  },
  {
    id: 'hardware_lighting',
    name: 'Фурнітура та Електрика',
    icon: 'Wrench',
    subcategories: [
      {
        name: 'Фурнітура (Blum завіси, Movento, Опори, Замки SISO, Метизи)',
        matcher: (m) => m.category === 'hardware',
      },
      {
        name: 'Електрика (LED COB 24V, Mean Well, Профіль врізний, Димер)',
        matcher: (m) => m.category === 'lighting',
      },
    ],
  },
  {
    id: 'services',
    name: 'Послуги підрядників та цеху',
    icon: 'Hammer',
    subcategories: [
      {
        name: 'Порізка (Лазерна порізка, Розкрій плит)',
        matcher: (m) =>
          m.category === 'services' &&
          (m.subcategory === 'Порізка' ||
            m.name.toLowerCase().includes('лазер') ||
            m.name.toLowerCase().includes('розкрій') ||
            m.name.toLowerCase().includes('порізка')),
      },
      {
        name: 'Фарбування (Порошкове RAL, Емаль 2K, Анодування)',
        matcher: (m) =>
          m.category === 'coating' ||
          (m.category === 'services' &&
            (m.subcategory === 'Фарбування' || m.name.toLowerCase().includes('фарбуван'))),
      },
      {
        name: 'Гнуття та обробка (Гнуття ЧПК, Зварювання, Кромкування, Складання)',
        matcher: (m) =>
          m.category === 'services' &&
          !m.name.toLowerCase().includes('лазер') &&
          !m.name.toLowerCase().includes('розкрій') &&
          !m.name.toLowerCase().includes('порізка') &&
          !m.name.toLowerCase().includes('фарбуван'),
      },
    ],
  },
];

export const CatalogWindow: React.FC<Props> = ({
  materials,
  onOpenMasterData,
  onOpenImportPrice,
  onAddMaterial,
  onRefreshMaterials,
  isRefreshing = false,
  collapseSignal,
}) => {
  const [search, setSearch] = useState('');
  const [localRefreshing, setLocalRefreshing] = useState(false);
  // Default: tree of materials in Window 2 is completely collapsed on program launch
  const [openBranches, setOpenBranches] = useState<Record<string, boolean>>({
    metal: false,
    plate_wood: false,
    glass_mirror: false,
    hardware_lighting: false,
    services: false,
  });

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Reset/collapse all branches and groups when a new calculation is initiated or collapseSignal triggered
  useEffect(() => {
    if (collapseSignal !== undefined && collapseSignal > 0) {
      setOpenBranches({
        metal: false,
        plate_wood: false,
        glass_mirror: false,
        hardware_lighting: false,
        services: false,
      });
      setOpenGroups({});
    }
  }, [collapseSignal]);

  const allBranchesCollapsed = useMemo(() => {
    return CATALOG_BRANCHES.every((b) => !openBranches[b.id]);
  }, [openBranches]);

  const handleToggleAllBranches = () => {
    if (allBranchesCollapsed) {
      const allOpen: Record<string, boolean> = {};
      CATALOG_BRANCHES.forEach((b) => {
        allOpen[b.id] = true;
      });
      setOpenBranches(allOpen);
    } else {
      const allClosed: Record<string, boolean> = {};
      CATALOG_BRANCHES.forEach((b) => {
        allClosed[b.id] = false;
      });
      setOpenBranches(allClosed);
      setOpenGroups({});
    }
  };

  const handleManualRefresh = async () => {
    if (!onRefreshMaterials) return;
    setLocalRefreshing(true);
    try {
      await onRefreshMaterials();
    } finally {
      setTimeout(() => setLocalRefreshing(false), 400);
    }
  };

  const refreshingState = isRefreshing || localRefreshing;

  const toggleBranch = (id: string) => {
    setOpenBranches((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const handleDragStart = (e: React.DragEvent, mat: MaterialItem) => {
    e.dataTransfer.setData('application/json', JSON.stringify(mat));
    e.dataTransfer.setData('text/plain', mat.name);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // Filtered materials by search
  const isSearchActive = search.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!isSearchActive) return [];
    const query = search.toLowerCase().trim();
    return materials.filter(
      (m) =>
        m.name.toLowerCase().includes(query) ||
        m.supplier?.toLowerCase().includes(query) ||
        m.subcategory?.toLowerCase().includes(query) ||
        m.groupHeader?.toLowerCase().includes(query) ||
        m.notes?.toLowerCase().includes(query)
    );
  }, [materials, search, isSearchActive]);

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs flex flex-col h-full min-h-[460px] overflow-hidden">
      {/* Window Header */}
      <div className="px-4 py-3 border-b border-slate-200/90 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            02
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-bold text-slate-900 tracking-tight">
                Ієрархічний Каталог (Master Catalog)
              </h2>
              <span
                className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200"
                title="Реальна кількість позицій у БД"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                БД: {materials.length} поз.
              </span>
            </div>
            <p className="text-[10px] text-slate-500">
              Перетягуйте картки матеріалів у Вікно 1 (BOM Editor) або тисніть «+»
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleToggleAllBranches}
            className="p-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 transition flex items-center gap-1 cursor-pointer shadow-2xs"
            title={allBranchesCollapsed ? 'Розгорнути всі гілки каталогу' : 'Згорнути всі гілки каталогу'}
          >
            <FolderTree className="w-3.5 h-3.5 text-slate-600" />
            <span className="hidden md:inline text-[11px]">
              {allBranchesCollapsed ? 'Розгорнути' : 'Згорнути'}
            </span>
          </button>

          {onRefreshMaterials && (
            <button
              type="button"
              onClick={handleManualRefresh}
              disabled={refreshingState}
              className="p-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 transition flex items-center gap-1 cursor-pointer shadow-2xs disabled:opacity-50"
              title="Синхронізувати з базою даних (GET /api/materials)"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-slate-600 ${refreshingState ? 'animate-spin text-emerald-600' : ''}`} />
              <span className="hidden md:inline text-[11px]">Оновити</span>
            </button>
          )}

          {onOpenImportPrice && (
            <button
              type="button"
              onClick={onOpenImportPrice}
              className="px-2.5 py-1 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded-lg border border-emerald-200 transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
              title="Імпорт прайс-листа металопрокату (PDF Метал Холдінг / Excel / CSV) та генерація дерева"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span className="hidden sm:inline">Імпорт прайсу</span>
            </button>
          )}

          <button
            type="button"
            onClick={onOpenMasterData}
            className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 rounded-lg border border-slate-200 transition flex items-center gap-1 cursor-pointer shadow-2xs"
            title="Редагувати довідник цін та коефіцієнтів відходу"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500" />
            <span className="hidden sm:inline">Довідник</span>
          </button>
        </div>
      </div>

      {/* Search Input Bar */}
      <div className="p-3 border-b border-slate-200 bg-white shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Швидкий пошук у каталозі (напр. 40х40, Egger, Blum, лазер)..."
            className="w-full pl-8.5 pr-8 py-1.5 border border-slate-300 rounded-xl text-xs font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Catalog Body: Either Search Results or Hierarchical Tree */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {isSearchActive ? (
          /* Search Results Flat List */
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-1 pb-1">
              <span>Знайдено за запитом «{search}»:</span>
              <span className="font-mono font-bold text-slate-700">{searchResults.length} поз.</span>
            </div>

            {searchResults.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">
                За запитом «{search}» матеріалів не знайдено
              </div>
            ) : (
              searchResults.map((mat) => (
                <div
                  key={mat.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, mat)}
                  className="p-2.5 bg-white hover:bg-emerald-50/60 rounded-xl border border-slate-200/90 hover:border-emerald-300 transition-all flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing shadow-2xs group"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-500 shrink-0" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 truncate">
                        {mat.name}
                      </div>
                      <div className="text-[10px] text-slate-400 flex flex-wrap items-center gap-1.5 mt-0.5">
                        <span>{MATERIAL_CATEGORIES[mat.category]?.name}</span>
                        {mat.subcategory && <span>• {mat.subcategory}</span>}
                        {mat.groupHeader && (
                          <span className="text-slate-600 bg-slate-100 px-1.5 py-0.2 rounded font-medium">
                            📁 {mat.groupHeader}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <span className="font-mono font-bold text-xs text-slate-900">
                        {mat.basePrice.toLocaleString('uk-UA')} ₴
                      </span>
                      <span className="text-[10px] text-slate-400 ml-1">/ {mat.unit}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onAddMaterial(mat)}
                      className="p-1.5 rounded-lg bg-emerald-100 hover:bg-emerald-600 text-emerald-800 hover:text-white transition cursor-pointer"
                      title="Додати у специфікацію"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* Hierarchical Accordion Tree */
          CATALOG_BRANCHES.map((branch) => {
            const isOpen = openBranches[branch.id] ?? false;
            // Total items in branch
            const branchItemsCount = branch.subcategories.reduce(
              (acc, sub) => acc + materials.filter(sub.matcher).length,
              0
            );

            return (
              <div
                key={branch.id}
                className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/30"
              >
                {/* Branch Header */}
                <button
                  type="button"
                  onClick={() => toggleBranch(branch.id)}
                  className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/90 text-left flex items-center justify-between gap-2 transition cursor-pointer select-none"
                >
                  <div className="flex items-center gap-2">
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-slate-500" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    )}
                    <span className="text-xs font-bold text-slate-900">{branch.name}</span>
                  </div>

                  <span className="text-[10px] font-mono font-semibold text-slate-500 bg-white px-2 py-0.5 rounded-md border border-slate-200">
                    {branchItemsCount}
                  </span>
                </button>

                {/* Subcategories list */}
                {isOpen && (
                  <div className="p-2 space-y-2 bg-white border-t border-slate-200/80">
                    {branch.subcategories.map((sub, sIdx) => {
                      const subItems = materials.filter(sub.matcher);

                      return (
                        <div key={sIdx} className="space-y-1 pl-1">
                          {/* Subcategory Label */}
                          <div className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5 pt-1 pb-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            <span className="truncate">{sub.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono">({subItems.length})</span>
                          </div>

                          {/* Items Cards or Nested Group Folders */}
                          <div className="space-y-1">
                            {subItems.length === 0 ? (
                              <div className="text-[10px] text-slate-400 italic pl-3">
                                Позицій немає
                              </div>
                            ) : subItems.some((m) => !!m.groupHeader) ? (
                              /* Grouped by Group Header (e.g. Арматура мірної довжини, Труба профільна, etc.) */
                              (() => {
                                const groupsMap = new Map<string, MaterialItem[]>();
                                subItems.forEach((m) => {
                                  const gName = m.groupHeader || 'Основний сортамент';
                                  if (!groupsMap.has(gName)) groupsMap.set(gName, []);
                                  groupsMap.get(gName)!.push(m);
                                });

                                return Array.from(groupsMap.entries()).map(([gName, gItems]) => {
                                  const groupKey = `${branch.id}_${sIdx}_${gName}`;
                                  const isGroupOpen = Boolean(openGroups[groupKey]); // collapsed by default

                                  return (
                                    <div
                                      key={gName}
                                      className="border border-slate-200/80 rounded-lg overflow-hidden bg-slate-50/50 mb-1"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => toggleGroup(groupKey)}
                                        className="w-full px-2.5 py-1.5 bg-slate-100/70 hover:bg-slate-200/70 text-left flex items-center justify-between gap-1.5 transition cursor-pointer select-none text-[11px] font-semibold text-slate-800"
                                      >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          {isGroupOpen ? (
                                            <FolderOpen className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                          ) : (
                                            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                                          )}
                                          <span className="truncate">{gName}</span>
                                        </div>
                                        <div className="flex items-center gap-1 shrink-0">
                                          <span className="text-[9px] font-mono font-bold bg-white text-slate-600 px-1.5 py-0.2 rounded border border-slate-200">
                                            {gItems.length}
                                          </span>
                                          {isGroupOpen ? (
                                            <ChevronDown className="w-3 h-3 text-slate-400" />
                                          ) : (
                                            <ChevronRight className="w-3 h-3 text-slate-400" />
                                          )}
                                        </div>
                                      </button>

                                      {isGroupOpen && (
                                        <div className="p-1.5 space-y-1 bg-white">
                                          {gItems.map((mat) => (
                                            <div
                                              key={mat.id}
                                              draggable
                                              onDragStart={(e) => handleDragStart(e, mat)}
                                              className="p-1.5 bg-white hover:bg-emerald-50/50 rounded-lg border border-slate-200 hover:border-emerald-300 transition flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing group shadow-2xs"
                                            >
                                              <div className="flex items-center gap-1.5 min-w-0">
                                                <GripVertical className="w-3 h-3 text-slate-300 group-hover:text-emerald-500 shrink-0" />
                                                <div className="min-w-0">
                                                  <div className="text-xs font-medium text-slate-900 truncate">
                                                    {mat.name}
                                                  </div>
                                                  <div className="flex items-center gap-1.5 text-[9px] text-slate-400">
                                                    {mat.supplier && <span>{mat.supplier}</span>}
                                                  </div>
                                                </div>
                                              </div>

                                              <div className="flex items-center gap-1 shrink-0">
                                                <span className="font-mono font-bold text-[11px] text-slate-800">
                                                  {mat.basePrice.toLocaleString('uk-UA')} ₴
                                                </span>
                                                <span className="text-[9px] text-slate-400">/{mat.unit}</span>

                                                <button
                                                  type="button"
                                                  onClick={() => onAddMaterial(mat)}
                                                  className="p-1 rounded-md bg-slate-100 hover:bg-emerald-600 text-slate-600 hover:text-white transition cursor-pointer ml-1"
                                                  title="Додати у виріб"
                                                >
                                                  <Plus className="w-3 h-3" />
                                                </button>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                });
                              })()
                            ) : (
                              /* Flat List */
                              subItems.map((mat) => (
                                <div
                                  key={mat.id}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, mat)}
                                  className="p-2 bg-white hover:bg-emerald-50/50 rounded-lg border border-slate-200 hover:border-emerald-300 transition flex items-center justify-between gap-2 cursor-grab active:cursor-grabbing group shadow-2xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <GripVertical className="w-3.5 h-3.5 text-slate-300 group-hover:text-emerald-500 shrink-0" />
                                    <div className="min-w-0">
                                      <div className="text-xs font-medium text-slate-900 truncate">
                                        {mat.name}
                                      </div>
                                      <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                        {mat.supplier && <span>{mat.supplier}</span>}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1.5 shrink-0">
                                    <span className="font-mono font-bold text-[11px] text-slate-800">
                                      {mat.basePrice.toLocaleString('uk-UA')} ₴
                                    </span>
                                    <span className="text-[10px] text-slate-400">/{mat.unit}</span>

                                    <button
                                      type="button"
                                      onClick={() => onAddMaterial(mat)}
                                      className="p-1 rounded-md bg-slate-100 hover:bg-emerald-600 text-slate-600 hover:text-white transition cursor-pointer ml-1"
                                      title="Додати у виріб"
                                    >
                                      <Plus className="w-3 h-3" />
                                    </button>
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
