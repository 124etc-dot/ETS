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
  Server
} from 'lucide-react';
import { AuthState } from '../services/googleAuth';
import { SheetConfig } from '../types';
import { APP_VERSION } from '../version';
import { OCRService } from '../services/ocrService';
import { ServerStatusModal } from './ServerStatusModal';

interface Props {
  authState: AuthState;
  sheetConfig: SheetConfig | null;
  activeTab: 'process' | 'sheet' | 'companies' | 'history';
  onSelectTab: (tab: 'process' | 'sheet' | 'companies' | 'history') => void;
  onOpenAuthModal: () => void;
  onLogout: () => void;
  totalPendingCount: number;
  totalReadyCount: number;
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
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo & ETS Branding with Release Version */}
            <div className="flex items-center space-x-2.5">
              <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0 shadow-xs">
                <span className="text-white font-extrabold text-[11px] tracking-tight">ETS</span>
              </div>
              <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5">
                <span className="text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
                  ETS <span className="text-indigo-600">Invoice &amp; Payment</span>
                </span>
                
                {/* Version Pill */}
                <span 
                  className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-mono font-bold bg-slate-100 text-slate-700 border border-slate-200 shadow-2xs select-all"
                  title={`Поточна версія релізу (з package.json): ${APP_VERSION}`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 mr-1.5"></span>
                  {APP_VERSION}
                </span>

                {/* Server Status Pill (Clickable for quick guide) */}
                <button
                  type="button"
                  onClick={() => setIsServerModalOpen(true)}
                  className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium border transition-colors cursor-pointer ${
                    serverStatus.ok
                      ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-emerald-200'
                      : 'bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-300 animate-pulse'
                  }`}
                  title="Натисніть для перегляду інструкції із запуску сервера"
                >
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${serverStatus.ok ? 'bg-emerald-500' : 'bg-amber-600'}`}></span>
                  <span>{serverStatus.ok ? 'Бекенд OCR OK' : 'Сервер OCR: як запустити?'}</span>
                </button>
              </div>
            </div>

          {/* Center Navigation Tabs */}
          <nav className="flex items-center space-x-1 sm:space-x-2 bg-slate-100 p-1 rounded-xl border border-slate-200">
            <button
              onClick={() => onSelectTab('process')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
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
              onClick={() => onSelectTab('sheet')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
                activeTab === 'sheet'
                  ? 'bg-white text-slate-900 shadow-xs font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
              }`}
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
              <span>Google Таблиця</span>
            </button>

            <button
              onClick={() => onSelectTab('companies')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center space-x-1.5 transition-colors ${
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
          <div className="flex items-center space-x-3">
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
              <div className="flex items-center space-x-2">
                <span className="hidden sm:inline-block text-xs font-medium text-slate-600 max-w-[140px] truncate" title={authState.userEmail || ''}>
                  {authState.userEmail}
                </span>
                <button
                  onClick={onLogout}
                  title="Від'єднати токен Google"
                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : authState.isExpired ? (
              <button
                onClick={onOpenAuthModal}
                className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 animate-pulse"
                title="Сесія закінчилася. Натисніть для оновлення токена."
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Поновити сесію Google</span>
              </button>
            ) : (
              <button
                onClick={onOpenAuthModal}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center space-x-1.5"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Підключити Google</span>
              </button>
            )}
          </div>
        </div>
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
