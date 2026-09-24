import React, { useState } from 'react';
import {
  FolderTree,
  Box,
  Truck,
  Wrench,
  Plus,
  Trash2,
  Copy,
  ChevronRight,
  ChevronDown,
  Check,
  Edit2,
  Package,
} from 'lucide-react';
import {
  ProjectAssemblyUnit,
  ProjectServicesConfig,
  ConstructiveItem,
} from '../../../types/calculator';

interface Props {
  units: ProjectAssemblyUnit[];
  activeUnitId: string;
  servicesConfig: ProjectServicesConfig;
  onSelectUnit: (unitId: string) => void;
  onAddUnit: (name: string) => void;
  onRenameUnit: (unitId: string, newName: string) => void;
  onDuplicateUnit: (unitId: string) => void;
  onDeleteUnit: (unitId: string) => void;
  onUpdateServicesConfig: (cfg: ProjectServicesConfig) => void;
}

export const ProjectTreeWindow: React.FC<Props> = ({
  units,
  activeUnitId,
  servicesConfig,
  onSelectUnit,
  onAddUnit,
  onRenameUnit,
  onDuplicateUnit,
  onDeleteUnit,
  onUpdateServicesConfig,
}) => {
  const [isAddingUnit, setIsAddingUnit] = useState(false);
  const [newUnitName, setNewUnitName] = useState('');
  const [editingUnitId, setEditingUnitId] = useState<string | null>(null);
  const [editingUnitName, setEditingUnitName] = useState('');

  // Expand state for groups
  const [isAssembliesOpen, setIsAssembliesOpen] = useState(true);
  const [isDeliveryOpen, setIsDeliveryOpen] = useState(true);
  const [isInstallationOpen, setIsInstallationOpen] = useState(true);

  // Delivery total calculation
  const deliveryTotal = servicesConfig.delivery.enabled
    ? (servicesConfig.delivery.trips || 1) * (servicesConfig.delivery.ratePerTrip || 0)
    : 0;

  // Installation total calculation
  const installationTotal = servicesConfig.installation.enabled
    ? (servicesConfig.installation.workers || 1) *
      (servicesConfig.installation.hours || 0) *
      (servicesConfig.installation.ratePerHour || 0)
    : 0;

  const handleCreateUnit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUnitName.trim()) return;
    onAddUnit(newUnitName.trim());
    setNewUnitName('');
    setIsAddingUnit(false);
  };

  const handleStartRename = (u: ProjectAssemblyUnit) => {
    setEditingUnitId(u.id);
    setEditingUnitName(u.name);
  };

  const handleSaveRename = (uId: string) => {
    if (editingUnitName.trim()) {
      onRenameUnit(uId, editingUnitName.trim());
    }
    setEditingUnitId(null);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs flex flex-col h-full min-h-[460px] overflow-hidden">
      {/* Window Header */}
      <div className="px-4 py-3 border-b border-slate-200/90 bg-slate-50/70 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-2xs">
            03
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold text-slate-900 tracking-tight">
              Структура замовлення (Project Tree)
            </h2>
            <p className="text-[10px] text-slate-500">
              Комплекти меблів, послуги доставки та монтажу на обʼєкті
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsAddingUnit(!isAddingUnit)}
            className="px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200/80 transition flex items-center gap-1 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Новий виріб</span>
          </button>
        </div>
      </div>

      {/* Quick Add Unit form */}
      {isAddingUnit && (
        <form
          onSubmit={handleCreateUnit}
          className="p-3 bg-blue-50/60 border-b border-blue-100 flex items-center gap-2 animate-in fade-in"
        >
          <input
            type="text"
            required
            autoFocus
            placeholder="Назва виробу (напр. Касова зона, Вітрина навісна)..."
            value={newUnitName}
            onChange={(e) => setNewUnitName(e.target.value)}
            className="flex-1 px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg text-xs font-medium focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg cursor-pointer"
          >
            Додати
          </button>
          <button
            type="button"
            onClick={() => setIsAddingUnit(false)}
            className="px-2 py-1.5 text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
          >
            Скасувати
          </button>
        </form>
      )}

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* GROUP 1: Комплект меблів (Вироби замовлення) */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/40">
          <div
            onClick={() => setIsAssembliesOpen(!isAssembliesOpen)}
            className="px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between cursor-pointer select-none border-b border-slate-200/80"
          >
            <div className="flex items-center gap-2">
              {isAssembliesOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
              <Package className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-bold text-slate-900">
                Комплект меблів та конструкцій ({units.length})
              </span>
            </div>

            <span className="text-[10px] text-indigo-600 font-semibold bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">
              Вироби
            </span>
          </div>

          {isAssembliesOpen && (
            <div className="p-2 space-y-1.5 bg-white">
              {units.map((unit, idx) => {
                const isActive = unit.id === activeUnitId;
                const isEditingThis = editingUnitId === unit.id;
                const unitCost = (unit.items || []).reduce((acc, i) => acc + (i.totalCost || 0), 0);
                const unitClient = (unit.items || []).reduce((acc, i) => acc + (i.clientPrice || 0), 0);

                return (
                  <div
                    key={unit.id}
                    onClick={() => onSelectUnit(unit.id)}
                    className={`p-2.5 rounded-xl border transition-all cursor-pointer ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-50/50 shadow-2xs'
                        : 'border-slate-200/80 bg-white hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`w-2 h-2 rounded-full shrink-0 ${
                            isActive ? 'bg-indigo-600 ring-2 ring-indigo-200' : 'bg-slate-300'
                          }`}
                        />

                        {isEditingThis ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="text"
                              value={editingUnitName}
                              onChange={(e) => setEditingUnitName(e.target.value)}
                              className="px-2 py-0.5 border border-indigo-400 rounded text-xs font-semibold text-slate-900 bg-white"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename(unit.id);
                                if (e.key === 'Escape') setEditingUnitId(null);
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveRename(unit.id)}
                              className="p-1 text-emerald-600 hover:text-emerald-800"
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <span className="text-xs font-bold text-slate-900 truncate block">
                              {idx + 1}. {unit.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {unit.items?.length || 0} деталей у специфікації
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <div className="text-right">
                          <span className="font-mono font-bold text-xs text-slate-900 block">
                            {unitClient.toLocaleString('uk-UA', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ₴
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            собів: {unitCost.toLocaleString('uk-UA', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} ₴
                          </span>
                        </div>

                        {/* Unit quick actions */}
                        <div className="flex items-center gap-0.5 opacity-60 hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => handleStartRename(unit)}
                            className="p-1 text-slate-400 hover:text-blue-600 rounded transition"
                            title="Перейменувати виріб"
                          >
                            <Edit2 className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDuplicateUnit(unit.id)}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded transition"
                            title="Дублювати виріб"
                          >
                            <Copy className="w-3 h-3" />
                          </button>
                          {units.length > 1 && (
                            <button
                              type="button"
                              onClick={() => onDeleteUnit(unit.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                              title="Видалити виріб із замовлення"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Active badge */}
                    {isActive && (
                      <div className="mt-1.5 pt-1.5 border-t border-indigo-100 flex items-center justify-between text-[10px] text-indigo-700 font-semibold">
                        <span>● Відкрито для редагування у Вікні 1 (BOM Editor)</span>
                        <span className="font-mono">{unit.items?.length || 0} позицій</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* GROUP 2: Послуги доставки */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/40">
          <div
            onClick={() => setIsDeliveryOpen(!isDeliveryOpen)}
            className="px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between cursor-pointer select-none border-b border-slate-200/80"
          >
            <div className="flex items-center gap-2">
              {isDeliveryOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
              <Truck className="w-4 h-4 text-amber-600" />
              <span className="text-xs font-bold text-slate-900">Послуги доставки</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-xs text-slate-900">
                {deliveryTotal.toLocaleString('uk-UA')} ₴
              </span>
              <input
                type="checkbox"
                checked={servicesConfig.delivery.enabled}
                onChange={(e) => {
                  e.stopPropagation();
                  onUpdateServicesConfig({
                    ...servicesConfig,
                    delivery: {
                      ...servicesConfig.delivery,
                      enabled: e.target.checked,
                    },
                  });
                }}
                className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500 cursor-pointer"
                title="Включити доставку в кошторис"
              />
            </div>
          </div>

          {isDeliveryOpen && (
            <div className="p-3 bg-white space-y-2.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                    Вид доставки
                  </label>
                  <input
                    type="text"
                    value={servicesConfig.delivery.name}
                    onChange={(e) =>
                      onUpdateServicesConfig({
                        ...servicesConfig,
                        delivery: { ...servicesConfig.delivery, name: e.target.value },
                      })
                    }
                    className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs"
                    placeholder="Вантажне авто по місту"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                    Кількість рейсів
                  </label>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    value={servicesConfig.delivery.trips}
                    onChange={(e) =>
                      onUpdateServicesConfig({
                        ...servicesConfig,
                        delivery: {
                          ...servicesConfig.delivery,
                          trips: Math.max(1, parseInt(e.target.value, 10) || 1),
                        },
                      })
                    }
                    className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                    Ставка за рейс (грн)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={servicesConfig.delivery.ratePerTrip}
                    onChange={(e) =>
                      onUpdateServicesConfig({
                        ...servicesConfig,
                        delivery: {
                          ...servicesConfig.delivery,
                          ratePerTrip: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                    className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* GROUP 3: Послуги монтажу */}
        <div className="border border-slate-200 rounded-xl overflow-hidden bg-slate-50/40">
          <div
            onClick={() => setIsInstallationOpen(!isInstallationOpen)}
            className="px-3 py-2 bg-slate-50 hover:bg-slate-100 flex items-center justify-between cursor-pointer select-none border-b border-slate-200/80"
          >
            <div className="flex items-center gap-2">
              {isInstallationOpen ? (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
              <Wrench className="w-4 h-4 text-emerald-600" />
              <span className="text-xs font-bold text-slate-900">Послуги монтажу</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-xs text-slate-900">
                {installationTotal.toLocaleString('uk-UA')} ₴
              </span>
              <input
                type="checkbox"
                checked={servicesConfig.installation.enabled}
                onChange={(e) => {
                  e.stopPropagation();
                  onUpdateServicesConfig({
                    ...servicesConfig,
                    installation: {
                      ...servicesConfig.installation,
                      enabled: e.target.checked,
                    },
                  });
                }}
                className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 cursor-pointer"
                title="Включити монтаж в кошторис"
              />
            </div>
          </div>

          {isInstallationOpen && (
            <div className="p-3 bg-white space-y-2.5 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                <div className="sm:col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                    Опис робіт
                  </label>
                  <input
                    type="text"
                    value={servicesConfig.installation.name}
                    onChange={(e) =>
                      onUpdateServicesConfig({
                        ...servicesConfig,
                        installation: {
                          ...servicesConfig.installation,
                          name: e.target.value,
                        },
                      })
                    }
                    className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs"
                    placeholder="Монтаж та підключення на обʼєкті"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                    Людей × Годин
                  </label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      step="1"
                      min="1"
                      value={servicesConfig.installation.workers}
                      onChange={(e) =>
                        onUpdateServicesConfig({
                          ...servicesConfig,
                          installation: {
                            ...servicesConfig.installation,
                            workers: Math.max(1, parseInt(e.target.value, 10) || 1),
                          },
                        })
                      }
                      className="w-12 px-1.5 py-1 border border-slate-200 rounded-lg text-xs font-mono font-bold text-center"
                      title="Кількість монтажників"
                    />
                    <span className="text-slate-400">×</span>
                    <input
                      type="number"
                      step="any"
                      min="0.5"
                      value={servicesConfig.installation.hours}
                      onChange={(e) =>
                        onUpdateServicesConfig({
                          ...servicesConfig,
                          installation: {
                            ...servicesConfig.installation,
                            hours: parseFloat(e.target.value) || 0,
                          },
                        })
                      }
                      className="w-14 px-1.5 py-1 border border-slate-200 rounded-lg text-xs font-mono font-bold text-center"
                      title="Кількість годин"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">
                    Ставка (₴/год)
                  </label>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={servicesConfig.installation.ratePerHour}
                    onChange={(e) =>
                      onUpdateServicesConfig({
                        ...servicesConfig,
                        installation: {
                          ...servicesConfig.installation,
                          ratePerHour: parseFloat(e.target.value) || 0,
                        },
                      })
                    }
                    className="w-full px-2.5 py-1 border border-slate-200 rounded-lg text-xs font-mono font-bold"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Window Footer: Summary of Order Tree elements */}
      <div className="px-4 py-2.5 border-t border-slate-200/90 bg-slate-50/70 flex items-center justify-between text-xs shrink-0 text-slate-600">
        <span>
          Всього складових: <b>{units.length} виробів</b>
          {servicesConfig.delivery.enabled && ' + доставка'}
          {servicesConfig.installation.enabled && ' + монтаж'}
        </span>

        <span className="font-mono font-bold text-slate-900">
          Логістика & Монтаж: {(deliveryTotal + installationTotal).toLocaleString('uk-UA')} ₴
        </span>
      </div>
    </div>
  );
};
