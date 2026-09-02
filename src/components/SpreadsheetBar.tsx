import React, { useState, useEffect } from 'react';
import { 
  FileSpreadsheet, 
  RefreshCw, 
  ExternalLink, 
  PlusCircle, 
  CheckCircle2, 
  AlertCircle,
  Building,
  Users,
  Bookmark,
  Sparkles,
  LogIn
} from 'lucide-react';
import { GoogleSheetsService } from '../services/googleSheets';
import { googleAuth, GoogleAuthService } from '../services/googleAuth';
import { SheetConfig, SheetCompanyLists } from '../types';

const RECENT_SHEETS_KEY = 'invoice_ocr_recent_sheets';

interface RecentSheetItem {
  id: string;
  title: string;
  url: string;
}

interface Props {
  accessToken: string | null;
  sheetConfig: SheetConfig | null;
  companyLists: SheetCompanyLists;
  onUpdateSheetConfig: (config: SheetConfig) => void;
  onRefreshData: () => Promise<void>;
  isLoading: boolean;
}

export const SpreadsheetBar: React.FC<Props> = ({
  accessToken,
  sheetConfig,
  companyLists,
  onUpdateSheetConfig,
  onRefreshData,
  isLoading,
}) => {
  const [sheetInput, setSheetInput] = useState(sheetConfig?.spreadsheetUrl || sheetConfig?.spreadsheetId || '');
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string; isAuthError?: boolean } | null>(null);
  const [isRefreshingAuth, setIsRefreshingAuth] = useState(false);
  const [settingUpTabs, setSettingUpTabs] = useState(false);
  const [recentSheets, setRecentSheets] = useState<RecentSheetItem[]>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(RECENT_SHEETS_KEY);
        if (stored) return JSON.parse(stored);
      } catch {
        // ignore
      }
    }
    return [];
  });

  useEffect(() => {
    if (sheetConfig) {
      setSheetInput(sheetConfig.spreadsheetUrl || sheetConfig.spreadsheetId);
    }
  }, [sheetConfig]);

  const connectByIdOrUrl = async (inputStr: string) => {
    if (!inputStr.trim() || !accessToken) return;
    setStatusMsg(null);
    const cleanId = GoogleSheetsService.extractSpreadsheetId(inputStr);

    try {
      const details = await GoogleSheetsService.getSpreadsheetDetails(cleanId, accessToken);
      
      const invoicesSheetName = GoogleSheetsService.resolveMatchingSheetTab(
        details.sheets,
        'Рахунки',
        ['рахунк', 'счет', 'інвойс', 'invoices', 'invoice', 'рахунки-фактури']
      );

      const paymentsSheetName = GoogleSheetsService.resolveMatchingSheetTab(
        details.sheets,
        'Платіжки',
        ['платіжк', 'платеж', 'оплат', 'платіжні доручення', 'виписк', 'банк', 'payments', 'payment']
      );

      const ourCompaniesSheetName = GoogleSheetsService.resolveMatchingSheetTab(
        details.sheets,
        'Наші компанії',
        ['наші компанії', 'наші', 'our companies', 'компанії', 'платники']
      );

      const suppliersSheetName = GoogleSheetsService.resolveMatchingSheetTab(
        details.sheets,
        'Постачальники',
        ['постачальники', 'поставщики', 'контрагенти', 'suppliers', 'одержувачі']
      );

      const newConfig: SheetConfig = {
        spreadsheetId: cleanId,
        spreadsheetTitle: details.title,
        spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${cleanId}/edit`,
        invoicesSheetName,
        paymentsSheetName,
        ourCompaniesSheetName,
        suppliersSheetName,
        availableSheets: details.sheets,
        isConfigured: true,
      };

      onUpdateSheetConfig(newConfig);

      // Save to recent sheets
      setRecentSheets((prev) => {
        const filtered = prev.filter((s) => s.id !== cleanId);
        const updated = [{ id: cleanId, title: details.title, url: newConfig.spreadsheetUrl }, ...filtered].slice(0, 5);
        if (typeof window !== 'undefined') {
          localStorage.setItem(RECENT_SHEETS_KEY, JSON.stringify(updated));
        }
        return updated;
      });

      await onRefreshData();

      setStatusMsg({
        type: 'success',
        text: `Підключено: "${details.title}". Вкладки: ${details.sheets.join(', ')}`,
      });
    } catch (err: any) {
      console.error('Error connecting sheet:', err);
      const isAuthErr = GoogleAuthService.isAuthError(err);
      setStatusMsg({
        type: 'error',
        isAuthError: isAuthErr,
        text: isAuthErr
          ? 'Сесія Google закінчилася (термін дії Google-токена — 1 год). Поновіть сесію в один клік нижче.'
          : err.message || 'Не вдалося підключити таблицю. Перевірте ID/URL та права доступу.',
      });
    }
  };

  const handleRefreshGoogleSession = async () => {
    setIsRefreshingAuth(true);
    try {
      await googleAuth.refreshSession();
      setStatusMsg({
        type: 'success',
        text: 'Сесію Google успішно поновлено! Перепідключаємо таблицю...',
      });
      // Re-try connection
      if (sheetInput) {
        setTimeout(() => {
          connectByIdOrUrl(sheetInput);
        }, 300);
      }
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        isAuthError: true,
        text: 'Не вдалося поновити сесію: ' + (err.message || 'Спробуйте увійти знову.'),
      });
    } finally {
      setIsRefreshingAuth(false);
    }
  };

  const handleConnectSheet = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    await connectByIdOrUrl(sheetInput);
  };

  const handleSetupStandardTabs = async () => {
    if (!accessToken || !sheetConfig?.spreadsheetId) return;
    setSettingUpTabs(true);
    setStatusMsg(null);
    try {
      await GoogleSheetsService.setupStandardTemplate(sheetConfig.spreadsheetId, accessToken);
      await onRefreshData();
      setStatusMsg({
        type: 'success',
        text: 'Стандартні вкладки ("Рахунки", "Платіжки", "Наші компанії", "Постачальники") успішно створено!',
      });
    } catch (err: any) {
      setStatusMsg({
        type: 'error',
        text: err.message || 'Помилка створення вкладок.',
      });
    } finally {
      setSettingUpTabs(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
              <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            </div>
            <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400">
              Цільова Google Таблиця
            </h3>
          </div>

          {sheetConfig?.spreadsheetUrl && (
            <a
              href={sheetConfig.spreadsheetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors flex items-center space-x-1"
            >
              <span>Відкрити в Sheets</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>

        <form onSubmit={handleConnectSheet} className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={sheetInput}
              onChange={(e) => setSheetInput(e.target.value)}
              placeholder="Посилання на Google Таблицю або Spreadsheet ID"
              className="w-full text-xs font-mono pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 text-slate-800"
            />
            {sheetConfig?.spreadsheetTitle && (
              <span className="absolute right-2.5 top-2 text-[10px] font-sans font-semibold text-emerald-800 bg-emerald-100/70 px-1.5 py-0.5 rounded">
                {sheetConfig.spreadsheetTitle}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !sheetInput.trim() || !accessToken}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center space-x-1.5 shrink-0 disabled:opacity-50"
          >
            {isLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" />
            )}
            <span>Підключити</span>
          </button>
        </form>

        {/* Recent / Saved spreadsheets shortcuts */}
        {recentSheets.length > 0 && (
          <div className="mt-2.5 flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center gap-1">
              <Bookmark className="w-3 h-3 text-emerald-600" />
              Закріплена:
            </span>
            {recentSheets.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setSheetInput(item.url || item.id);
                  connectByIdOrUrl(item.id);
                }}
                className={`text-[11px] px-2 py-0.5 rounded border transition-colors flex items-center space-x-1 ${
                  sheetConfig?.spreadsheetId === item.id
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 font-bold'
                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                }`}
              >
                <FileSpreadsheet className="w-3 h-3 text-emerald-600 shrink-0" />
                <span className="truncate max-w-[170px]">{item.title}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick stats & Auto-Setup */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <div className="flex items-center space-x-1.5">
            <Building className="w-3.5 h-3.5 text-indigo-600" />
            <span>Наші:</span>
            <strong className="text-slate-900 font-bold">{companyLists.ourCompanies.length}</strong>
          </div>
          <span className="text-slate-300">|</span>
          <div className="flex items-center space-x-1.5">
            <Users className="w-3.5 h-3.5 text-blue-600" />
            <span>Постачальники:</span>
            <strong className="text-slate-900 font-bold">{companyLists.suppliers.length}</strong>
          </div>
          <span className="text-slate-300">|</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            Лист1 захищено (без змін)
          </span>
        </div>

        <button
          type="button"
          onClick={handleSetupStandardTabs}
          disabled={settingUpTabs || !sheetConfig?.spreadsheetId || !accessToken}
          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-medium transition-colors flex items-center space-x-1.5 disabled:opacity-50"
          title="Створити відсутні робочі вкладки (Лист1 залишається незмінним)"
        >
          {settingUpTabs ? (
            <RefreshCw className="w-3 h-3 animate-spin text-slate-600" />
          ) : (
            <PlusCircle className="w-3 h-3 text-slate-600" />
          )}
          <span>Додати робочі вкладки</span>
        </button>
      </div>

      {statusMsg && (
        <div
          className={`mt-2.5 text-xs p-3 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 ${
            statusMsg.type === 'success'
              ? 'text-emerald-800 bg-emerald-50 border border-emerald-200'
              : 'text-rose-800 bg-rose-50 border border-rose-200'
          }`}
        >
          <div className="flex items-center space-x-2">
            {statusMsg.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            )}
            <span>{statusMsg.text}</span>
          </div>

          {statusMsg.isAuthError && (
            <button
              type="button"
              onClick={handleRefreshGoogleSession}
              disabled={isRefreshingAuth}
              className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 shrink-0 self-end sm:self-auto disabled:opacity-50"
            >
              {isRefreshingAuth ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogIn className="w-3.5 h-3.5" />
              )}
              <span>Поновити сесію Google</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
