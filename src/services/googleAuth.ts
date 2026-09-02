import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  signInWithPopup,
  GoogleAuthProvider,
  onAuthStateChanged,
  signOut,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

export const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
];

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
WORKSPACE_SCOPES.forEach((scope) => provider.addScope(scope));
// Use select_account instead of forcing consent every single time
provider.setCustomParameters({ prompt: 'select_account' });

const TOKEN_KEY = 'invoice_ocr_google_access_token';
const TOKEN_EXPIRY_KEY = 'invoice_ocr_google_token_expiry';
const USER_EMAIL_KEY = 'invoice_ocr_google_user_email';

export interface AuthState {
  accessToken: string | null;
  isAuthenticated: boolean;
  isExpired?: boolean;
  expiresAt: number | null;
  userEmail: string | null;
  user?: User | null;
}

export class GoogleAuthService {
  private listeners: ((state: AuthState) => void)[] = [];
  private cachedAccessToken: string | null = null;
  private currentUser: User | null = null;
  private isSigningIn = false;

  constructor() {
    this.initAuth();
  }

  private initAuth() {
    if (typeof window === 'undefined') return;

    // Check stored access token
    const storedToken = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    const expiryStr = localStorage.getItem(TOKEN_EXPIRY_KEY) || sessionStorage.getItem(TOKEN_EXPIRY_KEY);
    const expiresAt = expiryStr ? parseInt(expiryStr, 10) : null;

    if (storedToken && (!expiresAt || Date.now() < expiresAt)) {
      this.cachedAccessToken = storedToken;
    }

    onAuthStateChanged(auth, async (user: User | null) => {
      this.currentUser = user;
      if (user) {
        if (user.email) {
          localStorage.setItem(USER_EMAIL_KEY, user.email);
        }
      } else if (!this.isSigningIn && !this.cachedAccessToken) {
        this.clearToken();
      }
      this.notifyListeners();
    });

    // Check expiry whenever user returns to tab / focuses window
    window.addEventListener('focus', () => this.checkTokenExpiration());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.checkTokenExpiration();
      }
    });

    // Periodic check every 60 seconds
    setInterval(() => {
      this.checkTokenExpiration();
    }, 60000);
  }

  public checkTokenExpiration() {
    const expiryStr = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_EXPIRY_KEY) : null;
    const expiresAt = expiryStr ? parseInt(expiryStr, 10) : null;
    const token = this.cachedAccessToken || (typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null);

    if (token && expiresAt && Date.now() >= expiresAt) {
      // Token has expired
      this.cachedAccessToken = null;
      this.notifyListeners();
    }
  }

  public static isAuthError(error: any): boolean {
    if (!error) return false;
    const msg = (typeof error === 'string' ? error : error.message || error.toString()).toLowerCase();
    const status = error.status || error.code;
    return (
      status === 401 ||
      status === 403 && msg.includes('token') ||
      msg.includes('invalid authentication credentials') ||
      msg.includes('oauth 2 access token') ||
      msg.includes('unauthenticated') ||
      msg.includes('invalid_grant') ||
      msg.includes('token expired') ||
      msg.includes('expired_token') ||
      msg.includes('credentials')
    );
  }

  public markTokenExpired() {
    this.cachedAccessToken = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      // Keep userEmail for quick 1-click renewal prompt
    }
    this.notifyListeners();
  }

  public getAuthState(): AuthState {
    const token = this.cachedAccessToken || (typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null);
    const expiryStr = typeof window !== 'undefined' ? localStorage.getItem(TOKEN_EXPIRY_KEY) : null;
    const userEmail = typeof window !== 'undefined' ? localStorage.getItem(USER_EMAIL_KEY) : null;
    const expiresAt = expiryStr ? parseInt(expiryStr, 10) : null;

    const isExpired = Boolean(expiresAt && Date.now() >= expiresAt && userEmail);
    const isValid = Boolean(token && (!expiresAt || Date.now() < expiresAt));

    return {
      accessToken: isValid ? token : null,
      isAuthenticated: isValid,
      isExpired: isExpired || (!isValid && Boolean(userEmail)),
      expiresAt,
      userEmail: userEmail || this.currentUser?.email || null,
      user: this.currentUser,
    };
  }

  public async signInWithGoogle(): Promise<{ user: User; accessToken: string }> {
    try {
      this.isSigningIn = true;
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      const token = credential?.accessToken;

      if (!token) {
        throw new Error('Не вдалося отримати Google OAuth Access Token після авторизації.');
      }

      this.cachedAccessToken = token;
      this.currentUser = result.user;
      this.setToken(token, 3600, result.user.email || undefined);
      return { user: result.user, accessToken: token };
    } catch (error: any) {
      console.error('Sign-in popup error:', error);
      throw error;
    } finally {
      this.isSigningIn = false;
    }
  }

  /**
   * 1-Click quick refresh of Google OAuth session
   */
  public async refreshSession(): Promise<string> {
    const res = await this.signInWithGoogle();
    return res.accessToken;
  }

  public setToken(token: string, expiresInSeconds: number = 3600, email?: string) {
    this.cachedAccessToken = token;
    const expiresAt = Date.now() + expiresInSeconds * 1000;
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt.toString());
      if (email) {
        localStorage.setItem(USER_EMAIL_KEY, email);
      }
    }
    this.notifyListeners();
  }

  public async logout() {
    this.cachedAccessToken = null;
    this.currentUser = null;
    if (typeof window !== 'undefined') {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(TOKEN_EXPIRY_KEY);
      localStorage.removeItem(USER_EMAIL_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
      sessionStorage.removeItem(USER_EMAIL_KEY);
    }
    try {
      await signOut(auth);
    } catch (e) {
      console.warn('Sign out error:', e);
    }
    this.notifyListeners();
  }

  public clearToken() {
    this.logout();
  }

  public subscribe(callback: (state: AuthState) => void): () => void {
    this.listeners.push(callback);
    callback(this.getAuthState());
    return () => {
      this.listeners = this.listeners.filter((l) => l !== callback);
    };
  }

  private notifyListeners() {
    const state = this.getAuthState();
    this.listeners.forEach((cb) => cb(state));
  }
}

export const googleAuth = new GoogleAuthService();

