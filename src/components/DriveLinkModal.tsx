import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  ExternalLink, 
  Trash2, 
  Save, 
  Loader2, 
  FileText, 
  Eye, 
  Check, 
  AlertCircle,
  Copy,
  FolderOpen
} from 'lucide-react';
import { GoogleDriveService } from '../services/googleDrive';
import { GoogleSheetsService } from '../services/googleSheets';

export interface DriveLinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  targetSheetName: string;
  targetColumn: string;
  rowIndex: number;
  initialLink?: string;
  localPreviewUrl?: string;
  fileName?: string;
  canEdit?: boolean;
  onSave: (newLink: string) => Promise<void>;
  onDelete?: () => Promise<void>;
}

export const DriveLinkModal: React.FC<DriveLinkModalProps> = ({
  isOpen,
  onClose,
  title,
  targetSheetName,
  targetColumn,
  rowIndex,
  initialLink = '',
  localPreviewUrl,
  fileName,
  canEdit = true,
  onSave,
  onDelete,
}) => {
  const [linkInput, setLinkInput] = useState(initialLink);
  const [activeTab, setActiveTab] = useState<'drive' | 'local'>('drive');
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setLinkInput(initialLink || '');
    setActionError(null);
    if (!initialLink && localPreviewUrl) {
      setActiveTab('local');
    } else {
      setActiveTab('drive');
    }
  }, [initialLink, localPreviewUrl, isOpen]);

  // Extract file ID from current input
  const fileId = useMemo(() => {
    return GoogleDriveService.extractFileId(linkInput);
  }, [linkInput]);

  const drivePreviewUrl = useMemo(() => {
    if (!fileId) return null;
    return `https://drive.google.com/file/d/${fileId}/preview`;
  }, [fileId]);

  const driveDirectViewUrl = useMemo(() => {
    if (!fileId) return linkInput.trim() || null;
    return `https://drive.google.com/file/d/${fileId}/view`;
  }, [fileId, linkInput]);

  if (!isOpen) return null;

  const handleCopyLink = () => {
    if (!driveDirectViewUrl) return;
    navigator.clipboard.writeText(driveDirectViewUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = async () => {
    setActionError(null);
    setIsSaving(true);
    try {
      const cleaned = GoogleSheetsService.cleanDriveUrl(linkInput.trim());
      await onSave(cleaned);
      onClose();
    } catch (err: any) {
      setActionError(err.message || 'Помилка збереження посилання');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!window.confirm(`Видалити посилання на Google Диск для цього рядка (${targetSheetName}, рядок ${rowIndex})?`)) {
      return;
    }
    setActionError(null);
    setIsDeleting(true);
    try {
      await onDelete();
      onClose();
    } catch (err: any) {
      setActionError(err.message || 'Помилка видалення посилання');
    } finally {
      setIsDeleting(false);
    }
  };

  const isChanged = (linkInput.trim() !== (initialLink || '').trim());

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl max-w-5xl w-full h-[90vh] max-h-[900px] flex flex-col shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3 min-w-0 pr-4">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center shrink-0">
              <FolderOpen className="w-4 h-4 text-indigo-300" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-bold text-white truncate">{title}</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-slate-800 text-indigo-300 border border-slate-700">
                  {targetSheetName} : рядок {rowIndex} (кол. {targetColumn})
                </span>
              </div>
              {fileName && (
                <p className="text-xs text-slate-400 truncate mt-0.5 font-mono">
                  Файл: {fileName}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {/* View Mode Tabs (if local preview is available) */}
            {localPreviewUrl && (
              <div className="flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
                <button
                  type="button"
                  onClick={() => setActiveTab('drive')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    activeTab === 'drive'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Google Диск
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('local')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    activeTab === 'local'
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  Локальний скан
                </button>
              </div>
            )}

            {driveDirectViewUrl && (
              <a
                href={driveDirectViewUrl}
                target="_blank"
                rel="noreferrer"
                className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white text-xs font-medium rounded-lg border border-slate-700 transition-colors inline-flex items-center space-x-1.5"
                title="Відкрити цей файл у повній версії Google Диск"
              >
                <span>У новій вкладці</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title="Закрити вікно (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Main Body: Preview */}
        <div className="flex-1 bg-slate-100 min-h-0 relative flex flex-col p-3 overflow-hidden">
          {actionError && (
            <div className="mb-2 p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{actionError}</span>
              </div>
              <button 
                type="button" 
                onClick={() => setActionError(null)}
                className="text-rose-500 hover:text-rose-700 text-xs"
              >
                ✕
              </button>
            </div>
          )}

          {activeTab === 'drive' ? (
            drivePreviewUrl ? (
              <div className="flex-1 w-full h-full relative rounded-xl overflow-hidden border border-slate-300 bg-white shadow-inner flex flex-col">
                <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-500 shrink-0">
                  <div className="flex items-center space-x-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span>Вбудований перегляд Google Диск</span>
                  </div>
                  <div className="flex items-center space-x-3">
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="text-slate-600 hover:text-indigo-600 flex items-center space-x-1 cursor-pointer"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Скопійовано!' : 'Копіювати посилання'}</span>
                    </button>
                    {driveDirectViewUrl && (
                      <a
                        href={driveDirectViewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-indigo-600 hover:text-indigo-800 hover:underline flex items-center space-x-1"
                      >
                        <span>Якщо не завантажується ↗</span>
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex-1 w-full h-full relative bg-slate-50">
                  <iframe
                    src={drivePreviewUrl}
                    className="w-full h-full border-0"
                    title="Google Drive Document Preview"
                    allow="autoplay"
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 w-full h-full rounded-xl border-2 border-dashed border-slate-300 bg-white flex flex-col items-center justify-center p-6 text-center">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 mb-3 shadow-xs">
                  <FileText className="w-7 h-7" />
                </div>
                <h4 className="text-base font-bold text-slate-800">Посилання на Google Диск не вказано</h4>
                <p className="text-xs text-slate-500 max-w-md mt-1">
                  Для цього рядка ще немає збереженого файлу на Google Диску. Вставте посилання або File ID у поле нижче та натисніть «Зберегти».
                </p>
                {localPreviewUrl && (
                  <button
                    type="button"
                    onClick={() => setActiveTab('local')}
                    className="mt-4 px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-semibold rounded-xl border border-indigo-200 transition-colors cursor-pointer flex items-center space-x-1.5"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Переглянути локальний скан</span>
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="flex-1 w-full h-full rounded-xl overflow-hidden border border-slate-300 bg-slate-900 flex items-center justify-center p-2 relative">
              {localPreviewUrl ? (
                localPreviewUrl.startsWith('data:application/pdf') || localPreviewUrl.includes('.pdf') ? (
                  <iframe
                    src={`${localPreviewUrl}#toolbar=0`}
                    className="w-full h-full border-0 rounded-lg bg-white"
                    title="Local PDF Preview"
                  />
                ) : (
                  <img
                    src={localPreviewUrl}
                    alt="Document scan preview"
                    className="max-w-full max-h-full object-contain rounded shadow-lg"
                  />
                )
              ) : (
                <p className="text-xs text-slate-400">Локальний скан відсутній</p>
              )}
            </div>
          )}
        </div>

        {/* Modal Controls / Bottom Bar */}
        <div className="p-4 bg-white border-t border-slate-200 shrink-0">
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-slate-800 flex items-center space-x-1.5">
                  <span>URL посилання на файл (Google Drive):</span>
                  <span className="text-[11px] font-normal text-slate-500">
                    (записується у стовпчик <b className="text-slate-800">{targetColumn}</b> вкладки «{targetSheetName}»)
                  </span>
                </label>
                {fileId && (
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    File ID: {fileId}
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-2">
                <div className="relative flex-1">
                  <input
                    type="url"
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    disabled={!canEdit || isSaving || isDeleting}
                    placeholder="https://drive.google.com/file/d/..."
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 font-mono text-slate-800 disabled:bg-slate-100"
                  />
                  {linkInput && (
                    <button
                      type="button"
                      onClick={() => setLinkInput('')}
                      disabled={!canEdit || isSaving || isDeleting}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs px-1 py-0.5"
                      title="Очистити поле вводу"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div>
                {initialLink && canEdit && onDelete && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={isDeleting || isSaving}
                    className="px-3.5 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 cursor-pointer flex items-center space-x-1.5"
                    title="Видалити це посилання з рядка в Google Таблиці"
                  >
                    {isDeleting ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Видалення...</span>
                      </>
                    ) : (
                      <>
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Очистити посилання</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSaving || isDeleting}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                >
                  Закрити
                </button>

                {canEdit && (
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving || isDeleting || (!isChanged && !linkInput)}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50 cursor-pointer"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Збереження...</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Зберегти посилання</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
