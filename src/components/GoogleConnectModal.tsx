import React, { useState } from 'react';
import { Key, ExternalLink, ShieldCheck, AlertCircle, RefreshCw, X, LogIn } from 'lucide-react';
import { googleAuth } from '../services/googleAuth';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const GoogleConnectModal: React.FC<Props> = ({ isOpen, onClose, onSuccess }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showManual, setShowManual] = useState(false);

  if (!isOpen) return null;

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError(null);
    try {
      await googleAuth.signInWithGoogle();
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Sign-in failed:', err);
      setError(
        err.message ||
          'Не вдалося увійти через Google. Спробуйте ще раз або використайте введення токена.'
      );
    } finally {
      setLoading(false);
    }
  };

  const handleManualTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenInput.trim()) {
      setError('Будь ласка, введіть токен доступу.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const cleanToken = tokenInput.trim().replace(/^Bearer\s+/i, '');
      googleAuth.setToken(cleanToken, 3600, userEmail.trim() || undefined);
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Не вдалося перевірити токен доступу Google.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-slate-200">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
              <ShieldCheck className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-sm font-bold">Підключення Google Workspace</h2>
              <p className="text-slate-400 text-[11px]">Google Drive + Google Sheets</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Main 1-Click Sign-In */}
          <div className="text-center p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <p className="text-xs text-slate-600 leading-relaxed">
              Натисніть кнопку нижче для авторизації через ваш Google акаунт (з дозволами на читання Drive та запис у Sheets):
            </p>

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full flex items-center justify-center space-x-2.5 px-4 py-2.5 bg-white border border-slate-300 hover:border-indigo-400 hover:bg-indigo-50/20 text-slate-700 font-semibold text-xs rounded-lg shadow-xs transition-all disabled:opacity-50"
            >
              {loading ? (
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
              ) : (
                <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.16 0 9.94 0 12s.45 3.84 1.25 5.42l4.03-3.15z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
                  />
                </svg>
              )}
              <span>Увійти через Google</span>
            </button>
          </div>

          {error && (
            <div className="flex items-center space-x-2 text-xs text-rose-700 bg-rose-50 border border-rose-200 p-2.5 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Toggle manual token */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowManual(!showManual)}
              className="text-[11px] text-slate-500 hover:text-indigo-600 font-medium underline flex items-center space-x-1"
            >
              <Key className="w-3 h-3" />
              <span>{showManual ? 'Сховати ручне введення токена' : 'Ввести Access Token вручну (OAuth Playground)'}</span>
            </button>
          </div>

          {showManual && (
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg space-y-3 animate-in fade-in duration-100">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-700">OAuth Playground:</span>
                <a
                  href="https://developers.google.com/oauthplayground/#step1&scopes=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fspreadsheets"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 font-semibold inline-flex items-center space-x-1"
                >
                  <span>Відкрити Playground</span>
                  <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              <form onSubmit={handleManualTokenSubmit} className="space-y-2.5">
                <textarea
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Вставте токен (ya29.a0...)"
                  rows={2}
                  className="w-full text-xs font-mono p-2 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-1.5 px-3 text-xs font-semibold text-white bg-slate-800 hover:bg-slate-900 rounded-md transition-colors"
                >
                  Застосувати токен
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

