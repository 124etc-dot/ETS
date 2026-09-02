import React, { useState, useEffect } from 'react';
import { 
  Folder, 
  FolderSync, 
  RefreshCw, 
  AlertCircle, 
  Clock,
  Sparkles,
  CheckCircle2,
  SlidersHorizontal,
  LogIn
} from 'lucide-react';
import { GoogleDriveService } from '../services/googleDrive';
import { googleAuth, GoogleAuthService } from '../services/googleAuth';
import { GoogleDriveFolder } from '../types';

interface Props {
  accessToken: string | null;
  currentFolderId: string;
  onSelectFolder: (folderId: string, folderName?: string) => void;
  onFetchFiles: (folderId: string) => Promise<void>;
  isLoading: boolean;
  totalFilesInFolder: number;
  // Auto-sync and Auto-OCR settings
  autoSyncIntervalMinutes: number;
  onChangeAutoSyncInterval: (minutes: number) => void;
  autoOcrEnabled: boolean;
  onToggleAutoOcr: (enabled: boolean) => void;
  lastAutoSyncTime: Date | null;
  nextAutoSyncSeconds: number;
  isAutoSyncing: boolean;
}

export const DriveFolderBar: React.FC<Props> = ({
  accessToken,
  currentFolderId,
  onSelectFolder,
  onFetchFiles,
  isLoading,
  totalFilesInFolder,
  autoSyncIntervalMinutes,
  onChangeAutoSyncInterval,
  autoOcrEnabled,
  onToggleAutoOcr,
  lastAutoSyncTime,
  nextAutoSyncSeconds,
  isAutoSyncing,
}) => {
  const [folderInput, setFolderInput] = useState(currentFolderId);
  const [recentFolders, setRecentFolders] = useState<GoogleDriveFolder[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [isRefreshingAuth, setIsRefreshingAuth] = useState(false);
  const [currentFolderName, setCurrentFolderName] = useState<string>('');
  const [showAutoSettings, setShowAutoSettings] = useState(false);

  useEffect(() => {
    setFolderInput(currentFolderId);
    if (currentFolderId && accessToken) {
      loadFolderName(currentFolderId);
    }
  }, [currentFolderId, accessToken]);

  const loadFolderName = async (fId: string) => {
    try {
      const clean = GoogleDriveService.extractFolderId(fId);
      const details = await GoogleDriveService.getFolder(clean, accessToken!);
      setCurrentFolderName(details.name);
    } catch {
      setCurrentFolderName('Папка Google Drive');
    }
  };

  const loadRecentFolders = async () => {
    if (!accessToken) return;
    setLoadingFolders(true);
    setFolderError(null);
    try {
      const folders = await GoogleDriveService.listRecentFolders(accessToken);
      setRecentFolders(folders);
    } catch (err: any) {
      setFolderError(err.message || 'Не вдалося завантажити список папок.');
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleApplyFolder = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!folderInput.trim()) return;

    setFolderError(null);
    const cleanId = GoogleDriveService.extractFolderId(folderInput);
    onSelectFolder(cleanId);
    if (accessToken) {
      try {
        await onFetchFiles(cleanId);
      } catch (err: any) {
        const isAuthErr = GoogleAuthService.isAuthError(err);
        setFolderError(
          isAuthErr
            ? 'Сесія Google закінчилася (термін дії Google-токена — 1 год). Поновіть сесію нижче в 1 клік.'
            : err.message
        );
      }
    }
  };

  const handleRefreshGoogleSession = async () => {
    setIsRefreshingAuth(true);
    try {
      await googleAuth.refreshSession();
      setFolderError(null);
      if (folderInput.trim()) {
        const cleanId = GoogleDriveService.extractFolderId(folderInput);
        setTimeout(() => {
          onFetchFiles(cleanId);
        }, 300);
      }
    } catch (err: any) {
      setFolderError('Не вдалося поновити сесію: ' + (err.message || 'Спробуйте увійти знову.'));
    } finally {
      setIsRefreshingAuth(false);
    }
  };

  // Helper formatting minutes to readable countdown
  const formatCountdown = (totalSecs: number) => {
    if (totalSecs <= 0) return 'зараз...';
    const m = Math.floor(totalSecs / 60);
    const s = totalSecs % 60;
    if (m > 0) return `${m} хв ${s > 0 ? `${s}с` : ''}`;
    return `${s}с`;
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700">
              <Folder className="w-4 h-4 text-indigo-600" />
            </div>
            <h3 className="text-xs uppercase font-bold tracking-widest text-slate-400">
              Джерело Google Drive
            </h3>
          </div>

          <div className="flex items-center space-x-3">
            {accessToken && (
              <button
                type="button"
                onClick={loadRecentFolders}
                className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                {loadingFolders ? 'Завантаження...' : 'Вибрати зі списку папок'}
              </button>
            )}
          </div>
        </div>

        <form onSubmit={handleApplyFolder} className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              value={folderInput}
              onChange={(e) => setFolderInput(e.target.value)}
              placeholder="Посилання на папку Google Drive або Folder ID"
              className="w-full text-xs font-mono pl-3 pr-8 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-800"
            />
            {currentFolderName && (
              <span className="absolute right-2.5 top-2 text-[10px] font-sans font-semibold text-slate-600 bg-slate-200 px-1.5 py-0.5 rounded">
                {currentFolderName}
              </span>
            )}
          </div>

          <button
            type="submit"
            disabled={isLoading || !folderInput.trim()}
            className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center space-x-1.5 shrink-0 disabled:opacity-50"
          >
            {isLoading ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FolderSync className="w-3.5 h-3.5" />
            )}
            <span>Зчитати файли</span>
          </button>
        </form>
      </div>

      {/* Auto-sync and Auto-OCR control strip */}
      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Auto OCR toggle */}
          <button
            type="button"
            onClick={() => onToggleAutoOcr(!autoOcrEnabled)}
            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors flex items-center space-x-1.5 ${
              autoOcrEnabled
                ? 'bg-indigo-50 border-indigo-200 text-indigo-900'
                : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-slate-100'
            }`}
            title="Автоматично запускати Gemini OCR для нових файлів одразу після зчитування"
          >
            <Sparkles className={`w-3.5 h-3.5 ${autoOcrEnabled ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>Авто-розпізнавання: {autoOcrEnabled ? 'УВІМКНЕНО' : 'ВИМКНЕНО'}</span>
          </button>

          {/* Periodic auto-fetch dropdown */}
          <div className="flex items-center space-x-1.5 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg text-slate-700">
            <Clock className={`w-3.5 h-3.5 ${isAutoSyncing ? 'text-indigo-600 animate-spin' : 'text-slate-500'}`} />
            <span className="text-[11px] font-medium text-slate-600">Авто-зчитування:</span>
            <select
              value={autoSyncIntervalMinutes}
              onChange={(e) => onChangeAutoSyncInterval(Number(e.target.value))}
              className="bg-transparent text-xs font-bold text-slate-900 focus:outline-none cursor-pointer"
            >
              <option value={15}>кожні 15 хв</option>
              <option value={30}>кожні 30 хв</option>
              <option value={60}>кожну 1 год</option>
              <option value={120}>кожні 2 год</option>
              <option value={0}>вимкнено</option>
            </select>
          </div>
        </div>

        {/* Auto sync status countdown */}
        {autoSyncIntervalMinutes > 0 && currentFolderId && (
          <div className="text-[11px] text-slate-500 flex items-center space-x-1">
            {isAutoSyncing ? (
              <span className="inline-flex items-center text-indigo-600 font-semibold">
                <RefreshCw className="w-3 h-3 animate-spin mr-1" />
                Оновлення папки...
              </span>
            ) : (
              <span>
                Наступна перевірка: <strong className="text-slate-700">{formatCountdown(nextAutoSyncSeconds)}</strong>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Recent Folders Quick Selection Dropdown */}
      {recentFolders.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 mb-1.5">
            Нещодавні папки:
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
            {recentFolders.map((rf) => (
              <button
                key={rf.id}
                onClick={() => {
                  setFolderInput(rf.id);
                  onSelectFolder(rf.id, rf.name);
                  if (accessToken) onFetchFiles(rf.id);
                }}
                className={`text-xs px-2.5 py-1 rounded-lg border transition-colors flex items-center space-x-1 ${
                  currentFolderId === rf.id
                    ? 'bg-indigo-50 border-indigo-300 text-indigo-900 font-bold'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Folder className="w-3 h-3 text-indigo-500 shrink-0" />
                <span className="truncate max-w-[160px]">{rf.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {folderError && (
        <div className="mt-2.5 text-xs text-rose-800 bg-rose-50 border border-rose-200 p-3 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
          <div className="flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>{folderError}</span>
          </div>
          {GoogleAuthService.isAuthError(folderError) && (
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
