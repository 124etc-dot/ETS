import React from 'react';
import { Server, CheckCircle2, AlertTriangle, ExternalLink, Terminal, Copy, Check, X } from 'lucide-react';
import { APP_VERSION } from '../version';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  serverStatus: {
    ok: boolean;
    hasGeminiKey: boolean;
    message?: string;
  };
}

export const ServerStatusModal: React.FC<Props> = ({ isOpen, onClose, serverStatus }) => {
  const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(text);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-xl w-full border border-slate-200 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center space-x-2.5">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${serverStatus.ok ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
              <Server className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Стан сервера та OCR ({APP_VERSION})
              </h3>
              <p className="text-[11px] text-slate-500">
                {serverStatus.ok ? 'Зʼєднання з бекендом активне' : 'Потрібна перевірка запуску бекенду'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4 text-xs text-slate-700 max-h-[75vh] overflow-y-auto">
          {/* Status Badge */}
          <div className={`p-3 rounded-xl border flex items-start space-x-2.5 ${serverStatus.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
            {serverStatus.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            )}
            <div>
              <p className="font-bold">
                {serverStatus.ok 
                  ? 'Бекенд Node.js працює належним чином' 
                  : 'Бекенд не відповідає або запит заблоковано (404 / шлюз)'}
              </p>
              {serverStatus.message && (
                <p className="text-[11px] opacity-90 mt-0.5 font-mono">{serverStatus.message}</p>
              )}
              {serverStatus.ok && (
                <p className="text-[11px] text-emerald-700 mt-1">
                  Ключ Gemini API: {serverStatus.hasGeminiKey ? 'Підключено та активний' : 'Не виявлено в .env файлі'}
                </p>
              )}
            </div>
          </div>

          {/* Scenario 1: Running online in browser / PWA */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-2">
            <h4 className="font-bold text-slate-900 flex items-center space-x-1.5 text-xs">
              <span>🌐 Варіант 1: Запуск онлайн у браузері</span>
            </h4>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Якщо ви відкриваєте додаток через хмарне посилання Google AI Studio (наприклад, <code>https://ais-pre-...</code>):
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-slate-600 pl-1">
              <li>
                <strong>Відкривайте у звичайній вкладці Chrome/Edge/Safari</strong> (не через «Встановити додаток як вікно PWA»).
              </li>
              <li>
                Відокремлені вікна PWA в браузері інколи ізолюють cookie облікового запису Google, через що шлюз повертає помилку <strong>404/405</strong> при надсиланні файлів.
              </li>
            </ul>
          </div>

          {/* Scenario 2: Running locally on PC */}
          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/50 space-y-2.5">
            <h4 className="font-bold text-slate-900 flex items-center space-x-1.5 text-xs">
              <span>💻 Варіант 2: Запуск локально на компʼютері (Windows / Mac)</span>
            </h4>
            <p className="text-slate-600 text-[11px] leading-relaxed">
              Якщо ви завантажили ZIP-архів або клонували репозиторій на свій компʼютер:
            </p>
            
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-800">Найшвидший запуск (для Windows):</span>
              <div className="p-2.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] flex items-center justify-between">
                <span>Двічі клікніть файл <strong className="text-amber-400">start-app.bat</strong> у папці</span>
                <span className="text-[10px] text-slate-400">1 клік</span>
              </div>
            </div>

            <div className="space-y-1.5 pt-1">
              <span className="text-[11px] font-semibold text-slate-800">Або через термінал (командний рядок):</span>
              <div className="p-2.5 bg-slate-900 text-slate-100 rounded-lg font-mono text-[11px] flex items-center justify-between">
                <code>npm run dev</code>
                <button
                  onClick={() => copyToClipboard('npm run dev')}
                  className="text-slate-400 hover:text-white p-1"
                  title="Скопіювати команду"
                >
                  {copiedCmd === 'npm run dev' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <p className="text-[10px] text-slate-500 italic">
              * Застосунок відкриється за адресою <strong>http://localhost:3000</strong>. Переконайтеся, що в файлі <code>.env</code> прописаний ключ <code>GEMINI_API_KEY=...</code>
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-100/70 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold transition-colors"
          >
            Зрозуміло
          </button>
        </div>
      </div>
    </div>
  );
};
