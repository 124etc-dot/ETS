import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  Sparkles, 
  ShieldCheck, 
  LogIn, 
  LogOut, 
  Building2, 
  FileText,
  CheckCircle2,
  ExternalLink,
  FolderSync,
  Server,
  Briefcase,
  Factory,
  BarChart3
} from 'lucide-react';
import { AuthState } from '../services/googleAuth';
import { SheetConfig } from '../types';
import { APP_VERSION } from '../version';
import { OCRService } from '../services/ocrService';
import { ServerStatusModal } from './ServerStatusModal';

interface Props {
  authState: AuthState;
  sheetConfig: SheetConfig | null;
  activeTab: 'dashboard' | 'process' | 'sheet' | 'companies' | 'history' | 'projects' | 'overhead';
  onSelectTab: (tab: 'dashboard' | 'process' | 'sheet' | 'companies' | 'history' | 'projects' | 'overhead') => void;
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

  return (
    <>
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-xs">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-2 sm:gap-4 lg:gap-8">
            {/* Logo & ETS Branding with Release Version */}
            <div className="flex items-center space-x-2 sm:space-x-2.5 shrink-0 min-w-0">
              <img
                src="/logo.png"
                alt="ETS PROJECTS"
                className="h-7 sm:h-8 max-w-[42px] sm:max-w-[48px] object-contain rounded-md shrink-0"
              />
              <div className="flex items-center flex-wrap gap-x-1.5 sm:gap-x-2 gap-y-0.5 min-w-0">
                <span className="text-sm sm:text-base lg:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
                  ETS <span className="text-indigo-600">PROJECTS</span>
                </span>
                
                {/* Version Pill - Always visible on mobile and desktop */}
                <span 
                  className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] sm:text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs select-all shrink-0"
                  title={`Поточна версія релізу (з package.json): ${APP_VERSION}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-1 sm:mr-1.5"></span>
                  {APP_VERSION}
                </span>

                {/* Server Status Pill (Clickable for quick guide) */}
                <button
                  type="button"
                  onClick={() => setIsServerModalOpen(true)}
                  className={`inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors cursor-pointer shrink-0 ${
                    serverStatus.ok
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300 animate-pulse'
                  }`}
                  title="Натисніть для перегляду інструкції із запуску сервера"
                >
                  <span className={`w-1.5 h-1.5 rounded-full mr-1 sm:mr-1.5 ${serverStatus.ok ? 'bg-emerald-500' : 'bg-amber-600'}`}></span>
                  <span className="hidden sm:inline">{serverStatus.ok ? 'Бекенд OCR OK' : 'Сервер OCR: як запустити?'}</span>
                  <span className="sm:hidden">{serverStatus.ok ? 'OCR OK' : 'OCR Help'}</span>
                </button>
              </div>
            </div>

            {/* Center Navigation Tabs (Desktop: lg screens and up) */}
            <nav className="hidden lg:flex items-center space-x-1 xl:space-x-2 bg-slate-100 p-1 rounded-xl border border-slate-200 shrink-0">
              <button
                onClick={() => onSelectTab('dashboard')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  activeTab === 'dashboard'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5 text-indigo-600" />
                <span>Дашборд</span>
              </button>

              <button
                onClick={() => onSelectTab('projects')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  activeTab === 'projects'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Briefcase className="w-3.5 h-3.5 text-blue-600" />
                <span>Проекти</span>
              </button>

              <button
                onClick={() => onSelectTab('sheet')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  activeTab === 'sheet'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                <span>Рахунки & Оплати</span>
              </button>

              <button
                onClick={() => onSelectTab('overhead')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  activeTab === 'overhead'
                    ? 'bg-amber-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-amber-100/60'
                }`}
              >
                <Factory className={`w-3.5 h-3.5 ${activeTab === 'overhead' ? 'text-white' : 'text-amber-600'}`} />
                <span>Витрати Цеху</span>
                {overheadCount !== undefined && overheadCount > 0 && (
                  <span className={`ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full ${
                    activeTab === 'overhead' ? 'bg-amber-800 text-white' : 'bg-amber-100 text-amber-900'
                  }`}>
                    {overheadCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => onSelectTab('process')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  activeTab === 'process'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <FileText className="w-3.5 h-3.5 text-indigo-600" />
                <span>Черга обробки</span>
                {totalPendingCount + totalReadyCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full bg-indigo-600 text-white">
                    {totalPendingCount + totalReadyCount}
                  </span>
                )}
              </button>

              <button
                onClick={() => onSelectTab('companies')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors cursor-pointer ${
                  activeTab === 'companies'
                    ? 'bg-white text-slate-900 shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
              >
                <Building2 className="w-3.5 h-3.5 text-slate-600" />
                <span>Компанії & Постачальники</span>
              </button>
            </nav>

            {/* Right: Status Pills & Auth Actions */}
            <div className="flex items-center space-x-2 sm:space-x-3 shrink-0">
              {/* Drive Connection Status Pill */}
              {authState.isAuthenticated ? (
                <div className="hidden lg:flex items-center gap-1.5 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200 text-xs font-semibold">
                  <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                  <span>Google Drive Connected</span>
                </div>
              ) : null}

              {/* Sheets Status Pill */}
              {sheetConfig?.isConfigured && (
                <div className="hidden xl:flex items-center gap-1.5 px-3 py-1 bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200 text-xs font-semibold">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></div>
                  <span className="truncate max-w-[110px]">{sheetConfig.spreadsheetTitle}</span>
                </div>
              )}

              {authState.isAuthenticated ? (
                <div className="flex items-center space-x-1.5 sm:space-x-2">
                  <span className="hidden sm:inline-block text-xs font-medium text-slate-600 max-w-[140px] truncate" title={authState.userEmail || ''}>
                    {authState.userEmail}
                  </span>
                  <button
                    onClick={onLogout}
                    title="Від'єднати токен Google"
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              ) : authState.isExpired ? (
                <button
                  onClick={onOpenAuthModal}
                  className="px-2.5 sm:px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 animate-pulse cursor-pointer"
                  title="Сесія закінчилася. Натисніть для оновлення токена."
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Поновити сесію Google</span>
                  <span className="sm:hidden">Поновити</span>
                </button>
              ) : (
                <button
                  onClick={onOpenAuthModal}
                  className="px-2.5 sm:px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center space-x-1.5 cursor-pointer"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Підключити Google</span>
                  <span className="sm:hidden">Google Вхід</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Mobile Navigation Tabs Bar (< lg screens) */}
        <div className="lg:hidden border-t border-slate-200/80 bg-slate-50/90 backdrop-blur-xs px-2 sm:px-4 py-1.5">
          <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto no-scrollbar scroll-smooth p-1 bg-slate-200/70 rounded-xl border border-slate-200/80">
            <button
              onClick={() => onSelectTab('dashboard')}
              className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
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
              className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'projects'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>Проекти</span>
            </button>

            <button
              onClick={() => onSelectTab('sheet')}
              className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'sheet'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Рахунки</span>
            </button>

            <button
              onClick={() => onSelectTab('overhead')}
              className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'overhead'
                  ? 'bg-amber-600 text-white shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <Factory className={`w-3.5 h-3.5 shrink-0 ${activeTab === 'overhead' ? 'text-white' : 'text-amber-600'}`} />
              <span>Цех</span>
              {overheadCount !== undefined && overheadCount > 0 && (
                <span className={`ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full shrink-0 ${
                  activeTab === 'overhead' ? 'bg-amber-800 text-white' : 'bg-amber-100 text-amber-900'
                }`}>
                  {overheadCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onSelectTab('process')}
              className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
                activeTab === 'process'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/70'
              }`}
            >
              <FileText className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
              <span>Черга обробки</span>
              {totalPendingCount + totalReadyCount > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[10px] font-mono font-bold rounded-full bg-indigo-600 text-white shrink-0">
                  {totalPendingCount + totalReadyCount}
                </span>
              )}
            </button>

            <button
              onClick={() => onSelectTab('companies')}
              className={`flex-1 min-w-max px-3 py-2 rounded-lg text-xs font-semibold flex items-center justify-center space-x-1.5 transition-all cursor-pointer ${
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
