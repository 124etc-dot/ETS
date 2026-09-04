import { GoogleDriveFile, GoogleDriveFolder } from '../types';
import { googleAuth } from './googleAuth';

export class GoogleDriveService {
  private static async fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...options,
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error(`Час очікування Google Drive вичерпано (${Math.round(timeoutMs / 1000)} с). Спробуйте ще раз.`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Helper to make authenticated Google Drive API calls
   */
  private static async request<T>(
    endpoint: string,
    accessToken: string,
    options: RequestInit = {}
  ): Promise<T> {
    const res = await this.fetchWithTimeout(`https://www.googleapis.com/drive/v3/${endpoint}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(options.headers || {}),
      },
    }, 25000);

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg = `Google Drive API error: ${res.status} ${res.statusText}`;
      try {
        const json = JSON.parse(errorBody);
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {
        // use raw errorBody if JSON parse fails
      }

      if (res.status === 401 || errorMsg.includes('invalid authentication credentials') || errorMsg.includes('OAuth 2')) {
        googleAuth.markTokenExpired();
        throw new Error('Сесія Google закінчилася (термін дії токена 1 год). Поновіть сесію в один клік.');
      }

      throw new Error(errorMsg);
    }

    return res.json();
  }

  /**
   * Extract Folder ID from URL or return the string as is if already an ID
   */
  public static extractFolderId(input: string): string {
    const trimmed = input.trim();
    // E.g. https://drive.google.com/drive/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
    const match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      return match[1];
    }
    // E.g. https://drive.google.com/drive/u/0/folders/1aBcDeFgHiJkLmNoPqRsTuVwXyZ
    const uMatch = trimmed.match(/\/u\/\d+\/folders\/([a-zA-Z0-9_-]+)/);
    if (uMatch && uMatch[1]) {
      return uMatch[1];
    }
    return trimmed;
  }

  /**
   * Get Folder Details
   */
  public static async getFolder(folderId: string, accessToken: string): Promise<GoogleDriveFolder> {
    const cleanId = this.extractFolderId(folderId);
    const data = await this.request<any>(
      `files/${cleanId}?fields=id,name,webViewLink`,
      accessToken
    );
    return {
      id: data.id,
      name: data.name,
      webViewLink: data.webViewLink,
    };
  }

  /**
   * List recent user folders
   */
  public static async listRecentFolders(accessToken: string): Promise<GoogleDriveFolder[]> {
    const q = "mimeType = 'application/vnd.google-apps.folder' and trashed = false";
    const data = await this.request<any>(
      `files?q=${encodeURIComponent(q)}&pageSize=20&orderBy=modifiedTime desc&fields=files(id,name,webViewLink)`,
      accessToken
    );
    return (data.files || []).map((f: any) => ({
      id: f.id,
      name: f.name,
      webViewLink: f.webViewLink,
    }));
  }

  /**
   * List files in a specific folder (PDFs, Images, Documents)
   */
  public static async listFilesInFolder(
    folderId: string,
    accessToken: string
  ): Promise<GoogleDriveFile[]> {
    const cleanId = this.extractFolderId(folderId);
    const q = `'${cleanId}' in parents and trashed = false and mimeType != 'application/vnd.google-apps.folder'`;
    
    const fields = 'files(id,name,mimeType,size,thumbnailLink,webContentLink,webViewLink,createdTime,modifiedTime)';
    const data = await this.request<any>(
      `files?q=${encodeURIComponent(q)}&pageSize=100&orderBy=modifiedTime desc&fields=${encodeURIComponent(fields)}`,
      accessToken
    );

    return data.files || [];
  }

  /**
   * Download a file from Google Drive as Base64 data string
   */
  public static async downloadFileBase64(
    fileId: string,
    accessToken: string
  ): Promise<{ base64: string; mimeType: string; blob: Blob }> {
    // 1. Get file metadata for mimeType
    const meta = await this.request<any>(`files/${fileId}?fields=id,name,mimeType`, accessToken);
    const mimeType = meta.mimeType || 'application/pdf';

    // 2. Download binary media content (with 35s timeout)
    const res = await this.fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }, 35000);

    if (!res.ok) {
      throw new Error(`Failed to download file from Drive: ${res.statusText}`);
    }

    const blob = await res.blob();
    const base64 = await this.blobToBase64(blob);

    return {
      base64,
      mimeType,
      blob,
    };
  }

  /**
   * Upload a file or image to Google Drive folder (multipart upload)
   */
  public static async uploadFile(
    fileOrBlob: Blob | File,
    fileName: string,
    folderId: string | null,
    accessToken: string
  ): Promise<GoogleDriveFile> {
    const metadata: Record<string, any> = {
      name: fileName,
      mimeType: fileOrBlob.type || 'application/octet-stream',
    };

    if (folderId) {
      const cleanFolderId = this.extractFolderId(folderId);
      if (cleanFolderId && cleanFolderId !== 'root') {
        metadata.parents = [cleanFolderId];
      }
    }

    const boundary = '-------314159265358979323846';
    const metadataPart = `Content-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
    const mediaPartHeader = `Content-Type: ${fileOrBlob.type || 'application/octet-stream'}\r\n\r\n`;

    const arrayBuffer = await fileOrBlob.arrayBuffer();

    const multipartBlob = new Blob(
      [
        `--${boundary}\r\n`,
        metadataPart,
        `--${boundary}\r\n`,
        mediaPartHeader,
        arrayBuffer,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,thumbnailLink,webContentLink,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        body: multipartBlob,
      }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      let errorMsg = `Google Drive upload error: ${res.status} ${res.statusText}`;
      try {
        const json = JSON.parse(errorBody);
        if (json.error?.message) {
          errorMsg = json.error.message;
        }
      } catch {
        // ignore JSON parse error
      }
      throw new Error(errorMsg);
    }

    return res.json();
  }

  /**
   * Convert Base64 data URL to Blob
   */
  public static dataUrlToBlob(dataUrl: string): Blob {
    const arr = dataUrl.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  public static blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
