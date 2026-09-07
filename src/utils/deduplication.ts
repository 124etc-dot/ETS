import { ProcessedDocument } from '../types';

/**
 * Normalizes a document file name for reliable comparison:
 * lowercase, trimmed, redundant whitespaces collapsed.
 */
export const normalizeFileName = (name?: string): string => {
  if (!name) return '';
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
};

/**
 * Deduplicates an array of ProcessedDocument items based on:
 * 1. Google Drive file ID (`driveFileId`)
 * 2. Normalized file name (`fileName`)
 *
 * When duplicates are detected, it intelligently merges the richer data
 * (OCR results, Google Drive links, uploaded status, preview URLs) into
 * the retained document so no user work is lost.
 */
export const deduplicateDocuments = (
  docs: ProcessedDocument[]
): { uniqueDocs: ProcessedDocument[]; removedCount: number } => {
  const seenDriveIds = new Set<string>();
  const seenNames = new Map<string, ProcessedDocument>();
  const uniqueDocs: ProcessedDocument[] = [];
  let removedCount = 0;

  for (const doc of docs) {
    const driveId = doc.driveFileId?.trim();
    const normName = normalizeFileName(doc.fileName);

    let isDuplicate = false;
    let existingDoc: ProcessedDocument | undefined;

    if (driveId && seenDriveIds.has(driveId)) {
      isDuplicate = true;
      existingDoc = uniqueDocs.find((d) => d.driveFileId === driveId);
    } else if (normName && seenNames.has(normName)) {
      isDuplicate = true;
      existingDoc = seenNames.get(normName);
    }

    if (isDuplicate && existingDoc) {
      removedCount++;

      // Merge valuable fields from the duplicate into the existing document
      if (!existingDoc.driveFileId && driveId) {
        existingDoc.driveFileId = driveId;
        existingDoc.driveLink = existingDoc.driveLink || doc.driveLink;
        existingDoc.driveWebViewLink = existingDoc.driveWebViewLink || doc.driveWebViewLink;
        existingDoc.driveUploadStatus = 'uploaded';
      }

      if (!existingDoc.ocrResult && doc.ocrResult) {
        existingDoc.ocrResult = doc.ocrResult;
        existingDoc.editedData = doc.editedData || doc.ocrResult;
      }

      // If duplicate is already synced or reviewed, inherit that progress
      if (
        (doc.status === 'synced' && existingDoc.status !== 'synced') ||
        (doc.status === 'ready_for_review' && existingDoc.status === 'pending')
      ) {
        existingDoc.status = doc.status;
        existingDoc.alreadyInSheet = doc.alreadyInSheet ?? existingDoc.alreadyInSheet;
        existingDoc.alreadyInSheetTab = doc.alreadyInSheetTab ?? existingDoc.alreadyInSheetTab;
        existingDoc.alreadyInSheetReason = doc.alreadyInSheetReason ?? existingDoc.alreadyInSheetReason;
        existingDoc.syncedRowIndex = doc.syncedRowIndex ?? existingDoc.syncedRowIndex;
        if (doc.editedData) existingDoc.editedData = doc.editedData;
      }

      if (!existingDoc.previewDataUrl && doc.previewDataUrl) {
        existingDoc.previewDataUrl = doc.previewDataUrl;
      }

      if (!existingDoc.blob && doc.blob) {
        existingDoc.blob = doc.blob;
      }

      if (!existingDoc.thumbnailUrl && doc.thumbnailUrl) {
        existingDoc.thumbnailUrl = doc.thumbnailUrl;
      }

      continue;
    }

    if (driveId) seenDriveIds.add(driveId);
    if (normName) seenNames.set(normName, doc);
    uniqueDocs.push(doc);
  }

  return { uniqueDocs, removedCount };
};

/**
 * Quick helper to count how many duplicate items exist in a document list
 */
export const countDuplicateDocuments = (docs: ProcessedDocument[]): number => {
  const { removedCount } = deduplicateDocuments(docs);
  return removedCount;
};
