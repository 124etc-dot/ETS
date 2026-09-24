import React, { useState, useEffect, useRef } from 'react';
import { 
  FileSpreadsheet, 
  LogIn, 
  LogOut, 
  Building2, 
  FileText,
  Briefcase,
  Factory,
  BarChart3,
  TrendingUp,
  Eye,
  Calculator,
  ChevronDown,
  MoreHorizontal,
  Check
} from 'lucide-react';
import { AuthState } from '../services/googleAuth';
import { getUserPermissions } from '../services/permissions';
import { SheetConfig } from '../types';
import { APP_VERSION } from '../version';
import { OCRService } from '../services/ocrService';
import { ServerStatusModal } from './ServerStatusModal';

interface Props {
  authState: AuthState;
  sheetConfig: SheetConfig | null;
  activeTab: 'dashboard' | 'process' | 'sheet' | 'companies' | 'history' | 'projects' | 'calculator' | 'overhead' | 'cashflow';
  onSelectTab: (tab: 'dashboard' | 'process' | 'sheet' | 'companies' | 'history' | 'projects' | 'calculator' | 'overhead' | 'cashflow') => void;
  onOpenAuthModal: () => void;
  onLogout: () => void;
  totalPendingCount: number;
  totalReadyCount: number;
  overheadCount?: number;
}

export const Header: React.FC<Props> = ({
  authState,
  sheetConfig,
  activeTab,
  onSelectTab,
  onOpenAuthModal,
  onLogout,
  totalPendingCount,
  totalReadyCount,
  overheadCount,
}) => {
  const [isServerModalOpen, setIsServerModalOpen] = useState(false);
  const [isMoreOpen, setIsMoreOpen] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const [serverStatus, setServerStatus] = useState<{
    ok: boolean;
    hasGeminiKey: boolean;
    message?: string;
  }>({ ok: true, hasGeminiKey: true });

  useEffect(() => {
    let isMounted = true;
    const check = async () => {
      const res = await OCRService.checkServerHealth();
      if (isMounted) {
        setServerStatus(res);
      }
    };
    check();
    const interval = setInterval(check, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Handle outside click and Escape key for "More..." dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (moreMenuRef.current && !moreMenuRef.current.contains(event.target as Node)) {
        setIsMoreOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMoreOpen(false);
      }
    };
    if (isMoreOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreOpen]);

  // Secondary items configured for the dropdown menu
  const moreItems = [
    {
      id: 'overhead' as const,
      label: 'Витрати Цеху',
      shortLabel: 'Цех',
      icon: Factory,
      iconColor: 'text-amber-600',
      count: overheadCount && overheadCount > 0 ? overheadCount : 0,
      badgeBg: 'bg-rose-100 text-rose-800 border border-rose-300',
      description: 'Накладні виробничі витрати'
    },
    {
      id: 'process' as const,
      label: 'Черга обробки',
      shortLabel: 'Черга',
      icon: FileText,
      iconColor: 'text-indigo-600',
      count: totalPendingCount + totalReadyCount > 0 ? totalPendingCount + totalReadyCount : 0,
      badgeBg: 'bg-indigo-600 text-white',
      description: 'AI-розпізнавання рахунків та актів'
    },
    {
      id: 'companies' as const,
      label: 'Компанії & Постачальники',
      shortLabel: 'Компанії',
      icon: Building2,
      iconColor: 'text-slate-600',
      count: 0,
      badgeBg: '',
      description: 'Довідник контрагентів та реквізити'
    }
  ];

  const isMoreActive = moreItems.some((item) => item.id === activeTab);
  const activeMoreItem = moreItems.find((item) => item.id === activeTab);
  const totalMoreBadges = moreItems.reduce((acc, item) => acc + item.count, 0);

  return (
    <>
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs w-full">
        <div className="max-w-[1600px] w-full mx-auto px-2 sm:px-4 lg:px-6">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-1.5 sm:gap-3 lg:gap-4 w-full min-w-0">
            {/* Logo & ETS Branding with Combined Compact Version / OCR Badge */}
            <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0 min-w-0">
              <img
                src="/logo.png"
                alt="ETS PROJECTS"
                className="h-7 sm:h-8 max-w-[36px] sm:max-w-[42px] object-contain rounded-md shrink-0"
              />
              <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                <span className="text-sm sm:text-base lg:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
                  ETS <span className="text-indigo-600">PROJECTS</span>
                </span>
                
                {/* Unified Compact Version & Server Status Pill */}
                <button
                  type="button"
                  onClick={() => setIsServerModalOpen(true)}
                  className={`inline-flex items-center gap-1 sm:gap-1.5 px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-mono border transition-colors cursor-pointer shrink-0 ${
                    serverStatus.ok
                      ? 'bg-slate-100 hover:bg-slate-200/70 text-slate-700 border-slate-200 shadow-2xs'
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300 animate-pulse'
                  }`}
                  title={`Версія: ${APP_VERSION} | Сервер OCR: ${serverStatus.ok ? 'Бекенд OCR OK' : 'Потребує запуску (натисніть для довідки)'}`}
                >
                  <span className="font-bold text-slate-800 tracking-tight">{APP_VERSION}</span>
                  <span className="text-slate-300">|</span>
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${serverStatus.ok ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                  <span className="hidden xl:inline font-sans text-[10px] font-medium text-slate-600">
                    {serverStatus.ok ? 'OCR OK' : 'OCR Help'}
                  </span>
                </button>
              </div>
            </div>

            {/* Center Navigation Tabs (Desktop: lg screens and up) */}
            <nav className="hidden lg:flex items-center space-x-1 p-1 bg-slate-100/90 rounded-xl border border-slate-200/80 max-w-full overflow-x-auto no-scrollbar shrink-0">
              {/* Tab 1: Dashboard */}
              <button
                type="button"
                onClick={() => onSelectTab('dashboard')}
                title="Дашборд фінансової аналітики та проектів"
                className={`px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'dashboard'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>Дашборд</span>
              </button>

              {/* Tab 2: Projects */}
              <button
                type="button"
                onClick={() => onSelectTab('projects')}
                title="Управління проектами та замовленнями"
                className={`px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'projects'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                <span>Проекти</span>
              </button>

              {/* Tab 3: Calculator (High priority) */}
              <button
                type="button"
                onClick={() => onSelectTab('calculator')}
                title="Калькулятор металоконструкцій та кошториси"
                className={`px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'calculator'
                    ? 'bg-indigo-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-indigo-100/60'
                }`}
              >
                <Calculator className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'calculator' ? 'text-white' : 'text-indigo-600'}`} />
                <span>Калькулятор</span>
              </button>

              {/* Tab 4: Invoices & Payments */}
              <button
                type="button"
                onClick={() => onSelectTab('sheet')}
                title="Реєстр рахунків та оплат з Google Таблиці"
                className={`px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'sheet'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="hidden 2xl:inline">Рахунки & Оплати</span>
                <span className="2xl:hidden">Рахунки</span>
              </button>

              {/* Tab 5: Cashflow */}
              <button
                type="button"
                onClick={() => onSelectTab('cashflow')}
                title="Календар платежів та Cash Flow"
                className={`px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'cashflow'
                    ? 'bg-indigo-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <TrendingUp className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'cashflow' ? 'text-white' : 'text-indigo-600'}`} />
                <span className="hidden 2xl:inline">Календар платежів</span>
                <span className="2xl:hidden">Календар</span>
              </button>

              {/* Tab 6: Overhead (Visible inline on very wide 2xl screens) */}
              <button
                type="button"
                onClick={() => onSelectTab('overhead')}
                title="Накладні виробничі витрати цеху"
                className={`hidden 2xl:flex px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'overhead'
                    ? 'bg-amber-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-amber-100/60'
                }`}
              >
                <Factory className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'overhead' ? 'text-white' : 'text-amber-600'}`} />
                <span>Витрати Цеху</span>
                {overheadCount !== undefined && overheadCount > 0 && (
                  <span
                    className={`ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full ${
                      activeTab === 'overhead' ? 'bg-amber-800 text-white' : 'bg-rose-100 text-rose-800 border border-rose-300'
                    }`}
                    title={`Неоплачених рахунків цеху: ${overheadCount}`}
                  >
                    {overheadCount}
                  </span>
                )}
              </button>

              {/* Tab 7: Process Queue (Visible inline on very wide 2xl screens) */}
              <button
                type="button"
                onClick={() => onSelectTab('process')}
                title="Черга AI-розпізнавання рахунків та актів"
                className={`hidden 2xl:flex px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'process'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                <span>Черга обробки</span>
                {totalPendingCount + totalReadyCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full bg-indigo-600 text-white">
                    {totalPendingCount + totalReadyCount}
                  </span>
                )}
              </button>

              {/* Tab 8: Companies (Visible inline on very wide 2xl screens) */}
              <button
                type="button"
                onClick={() => onSelectTab('companies')}
                title="Довідник компаній та постачальників"
                className={`hidden 2xl:flex px-2 xl:px-2.5 2xl:px-3 py-1.5 rounded-lg text-xs font-semibold items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                  activeTab === 'companies'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
                <span>Компанії</span>
              </button>

              {/* Dropdown Menu "Ще..." for Medium/Laptop Screens (< 2xl) */}
              <div className="relative 2xl:hidden shrink-0" ref={moreMenuRef}>
                <button
                  type="button"
                  onClick={() => setIsMoreOpen((prev) => !prev)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer shrink-0 ${
                    isMoreActive
                      ? 'bg-white text-slate-900 shadow-xs font-bold border border-slate-300'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                  }`}
                  title="Додаткові розділи (Витрати Цеху, Черга обробки, Компанії)"
                  aria-expanded={isMoreOpen}
                >
                  {activeMoreItem ? (
                    <activeMoreItem.icon className={`w-3.5 h-3.5 shrink-0 ${activeMoreItem.iconColor}`} />
                  ) : (
                    <MoreHorizontal className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <span>{activeMoreItem ? activeMoreItem.shortLabel : 'Ще'}</span>
                  <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform ${isMoreOpen ? 'rotate-180' : ''}`} />
                  
                  {/* Notification badge if any item inside has alerts */}
                  {totalMoreBadges > 0 && !isMoreActive && (
                    <span className="w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white"></span>
                  )}
                  {activeMoreItem && activeMoreItem.count > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full bg-rose-100 text-rose-800 border border-rose-300">
                      {activeMoreItem.count}
                    </span>
                  )}
                </button>

                {/* Dropdown Menu Popup */}
                {isMoreOpen && (
                  <div className="absolute right-0 top-full mt-1.5 w-64 bg-white rounded-xl shadow-xl border border-slate-200 py-1.5 z-50 animate-in fade-in slide-in-from-top-1 duration-150">
                    <div className="px-3 py-1.5 border-b border-slate-100 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                      Додаткові розділи
                    </div>
                    {moreItems.map((item) => {
                      const Icon = item.icon;
                      const isCurrent = activeTab === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            onSelectTab(item.id);
                            setIsMoreOpen(false);
                          }}
                          className={`w-full px-3 py-2 text-left text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
                            isCurrent
                              ? 'bg-indigo-50/80 text-indigo-950 font-bold'
                              : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5 min-w-0">
                            <Icon className={`w-4 h-4 shrink-0 ${item.iconColor}`} />
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold">{item.label}</div>
                              <div className="text-[10px] text-slate-400 font-normal truncate">{item.description}</div>
                            </div>
                          </div>
                          <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                            {item.count > 0 && (
                              <span className={`px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full ${item.badgeBg}`}>
                                {item.count}
                              </span>
                            )}
                            {isCurrent && <Check className="w-3.5 h-3.5 text-indigo-600 ml-1" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </nav>

            {/* Right: Status Pills & Auth Actions */}
            <div className="flex items-center space-x-1.5 sm:space-x-2.5 shrink-0">
              {/* Drive Connection Status Pill (Visible only on 2xl to preserve space) */}
              {authState.isAuthenticated ? (
                <div 
                  className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200 text-xs font-semibold shrink-0"
                  title="Google Drive підключено"
                >
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                  <span>Drive OK</span>
                </div>
              ) : null}

              {/* Sheets Status Pill (Visible only on 2xl to preserve space) */}
              {sheetConfig?.isConfigured && (
                <div 
                  className="hidden 2xl:flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200 text-xs font-semibold shrink-0"
                  title={`Google Таблиця: ${sheetConfig.spreadsheetTitle}`}
                >
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                  <span className="truncate max-w-[100px]">{sheetConfig.spreadsheetTitle}</span>
                </div>
              )}

              {authState.isAuthenticated ? (() => {
                const userPerms = getUserPermissions(authState.userEmail);
                return (
                  <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
                    <div className="flex flex-col items-end">
                      <span className="hidden sm:inline-block text-xs font-semibold text-slate-800 max-w-[100px] xl:max-w-[140px] truncate" title={authState.userEmail || ''}>
                        {authState.userEmail}
                      </span>
                      {userPerms.isRestricted ? (
                        <span 
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300"
                          title={userPerms.roleDescription}
                        >
                          <Eye className="w-2.5 h-2.5 text-amber-600" />
                          <span>{userPerms.roleShortLabel}</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium hidden sm:inline-block">
                          {userPerms.roleShortLabel}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={onLogout}
                      title="Від'єднати токен Google"
                      className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                    </button>
                  </div>
                );
              })() : authState.isExpired ? (
                <button
                  onClick={onOpenAuthModal}
                  className="px-2.5 sm:px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 animate-pulse cursor-pointer shrink-0"
                  title="Сесія закінчилася. Натисніть для оновлення токена."
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Поновити сесію</span>
                  <span className="sm:hidden">Поновити</span>
                </button>
              ) : (
                <button
                  onClick={onOpenAuthModal}
                  className="px-2.5 sm:px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer shrink-0"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Підключити Google</span>
                  <span className="sm:hidden">Вхід</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Navigation Tabs Bar (< lg screens) */}
        <div className="lg:hidden border-t border-slate-200/80 bg-slate-50/90 backdrop-blur-xs px-2 sm:px-4 py-1.5 w-full max-w-full overflow-hidden">
          <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar scroll-smooth p-1 bg-slate-200/70 rounded-xl border border-slate-200/80 max-w-full">
            <button
              onClick={() => onSelectTab('dashboard')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <BarChart3 className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Дашборд</span>
            </button>

            <button
              onClick={() => onSelectTab('projects')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'projects'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>Проекти</span>
            </button>

            <button
              onClick={() => onSelectTab('calculator')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'calculator'
                  ? 'bg-indigo-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <Calculator className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'calculator' ? 'text-white' : 'text-indigo-600'}`} />
              <span>Калькулятор</span>
            </button>

            <button
              onClick={() => onSelectTab('sheet')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'sheet'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Рахунки</span>
            </button>

            <button
              onClick={() => onSelectTab('cashflow')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'cashflow'
                  ? 'bg-indigo-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <TrendingUp className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'cashflow' ? 'text-white' : 'text-indigo-600'}`} />
              <span>Cash Flow</span>
            </button>

            <button
              onClick={() => onSelectTab('overhead')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'overhead'
                  ? 'bg-amber-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <Factory className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'overhead' ? 'text-white' : 'text-amber-600'}`} />
              <span>Цех</span>
              {overheadCount !== undefined && overheadCount > 0 && (
                <span
                  className={`ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full shrink-0 ${
                    activeTab === 'overhead' ? 'bg-amber-800 text-white' : 'bg-rose-100 text-rose-800 border border-rose-300'
                  }`}
                  title={`Неоплачених рахунків цеху: ${overheadCount}`}
                >
                  {overheadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onSelectTab('process')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'process'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Черга</span>
              {totalPendingCount + totalReadyCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full bg-indigo-600 text-white shrink-0">
                  {totalPendingCount + totalReadyCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onSelectTab('companies')}
              className={`shrink-0 min-w-max px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'companies'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <Building2 className="w-3.5 h-3.5 text-slate-600 shrink-0" />
              <span>Компанії</span>
            </button>
          </nav>
        </div>
      </header>

      {/* Server Help Modal */}
      <ServerStatusModal
        isOpen={isServerModalOpen}
        onClose={() => setIsServerModalOpen(false)}
        serverStatus={serverStatus}
      />
    </>
  );
};
