import React, { useRef, useState } from 'react';
import { 
  UploadCloud, 
  Camera, 
  FileUp, 
  FileText, 
  Image as ImageIcon,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { ProcessedDocument } from '../types';
import { GoogleDriveService } from '../services/googleDrive';

interface Props {
  onAddDocuments: (docs: ProcessedDocument[]) => void;
  isDriveConnected?: boolean;
}

export const UploadZone: React.FC<Props> = ({ onAddDocuments, isDriveConnected = false }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isReading, setIsReading] = useState(false);

  const processFiles = async (fileList: FileList | File[], source: 'upload' | 'camera' = 'upload') => {
    setIsReading(true);
    const newDocs: ProcessedDocument[] = [];

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const id = `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        const base64DataUrl = await GoogleDriveService.blobToBase64(file);
        const name = file.name || (source === 'camera' ? `photo_${Date.now()}.jpg` : `document_${Date.now()}.pdf`);
        
        let detectedMime = file.type || '';
        if (!detectedMime || detectedMime === 'application/octet-stream') {
          const lowerName = name.toLowerCase();
          if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) detectedMime = 'image/jpeg';
          else if (lowerName.endsWith('.png')) detectedMime = 'image/png';
          else if (lowerName.endsWith('.webp')) detectedMime = 'image/webp';
          else if (lowerName.endsWith('.pdf')) detectedMime = 'application/pdf';
          else if (source === 'camera') detectedMime = 'image/jpeg';
          else detectedMime = 'application/pdf';
        }

        newDocs.push({
          id,
          source,
          fileName: name,
          fileSize: file.size,
          mimeType: detectedMime,
          previewDataUrl: base64DataUrl,
          blob: file,
          status: 'pending',
        });
      } catch (e) {
        console.error('Error reading file:', e);
      }
    }

    if (newDocs.length > 0) {
      onAddDocuments(newDocs);
    }
    setIsReading(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files, 'upload');
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`border-2 border-dashed rounded-xl p-5 transition-colors text-center ${
        isDragging
          ? 'border-indigo-500 bg-indigo-50/60'
          : 'border-slate-300 bg-slate-50/50 hover:bg-slate-50 hover:border-slate-400'
      }`}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => e.target.files && processFiles(e.target.files, 'upload')}
        multiple
        accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,.pdf,.jpg,.jpeg,.png,.heic"
        className="hidden"
      />

      <input
        type="file"
        ref={cameraInputRef}
        onChange={(e) => e.target.files && processFiles(e.target.files, 'camera')}
        accept="image/*"
        capture="environment"
        className="hidden"
      />

      <div className="max-w-md mx-auto space-y-2.5">
        <div className="w-10 h-10 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto shadow-xs">
          <UploadCloud className="w-5 h-5" />
        </div>

        <div>
          <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
            Ручне завантаження або фото з телефону
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            Перетягніть PDF, JPG, PNG або зробіть знімок камерою
          </p>
          {isDriveConnected ? (
            <p className="text-[10px] text-emerald-700 font-medium mt-1 flex items-center justify-center space-x-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-600 inline" />
              <span>Файли автоматично зберігаються у вашу базу на Google Диск</span>
            </p>
          ) : (
            <p className="text-[10px] text-indigo-600 font-medium mt-1">
              Підключіть Google акаунт, щоб файли автоматично архівувалися на Google Диск
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isReading}
            className="px-3.5 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-200 rounded-lg text-xs font-semibold shadow-xs transition-colors flex items-center space-x-1.5"
          >
            <FileUp className="w-3.5 h-3.5 text-indigo-600" />
            <span>Вибрати файли з пристрою</span>
          </button>

          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={isReading}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded-lg text-xs font-semibold transition-colors flex items-center space-x-1.5"
          >
            <Camera className="w-3.5 h-3.5 text-slate-700" />
            <span>Зробити фото</span>
          </button>
        </div>
      </div>
    </div>
  );
};
