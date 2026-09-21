/**
 * Permissions and Access Control Service
 * 
 * Configurable list of restricted/view-only user emails.
 * Users not in this list have full access (Drive sync, Sheets write/update, approval, etc.).
 */

export const RESTRICTED_VIEW_USERS: readonly string[] = [
  // Both 777vlad4406425@gmail.com and kosss.koss@gmail.com now have full unrestricted access.
];

export interface UserPermissions {
  email: string | null;
  isRestricted: boolean;
  canViewApp: boolean;
  canReadDriveFiles: boolean;
  canWriteToSheets: boolean;
  canApproveInvoices: boolean;
  roleLabel: string;
  roleShortLabel: string;
  roleDescription: string;
}

export function isRestrictedUser(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  return RESTRICTED_VIEW_USERS.some((restrictedEmail) => restrictedEmail.toLowerCase() === normalized);
}

export function canUserReadDriveFiles(email?: string | null): boolean {
  return !isRestrictedUser(email);
}

export function canUserWriteToSheets(email?: string | null): boolean {
  return !isRestrictedUser(email);
}

export function canUserApproveInvoices(_email?: string | null): boolean {
  // All authenticated users, including restricted users, can approve invoices
  return true;
}

export function getUserPermissions(email?: string | null): UserPermissions {
  const normalized = (email || '').trim().toLowerCase() || null;
  const restricted = isRestrictedUser(email);

  if (restricted) {
    return {
      email: normalized,
      isRestricted: true,
      canViewApp: true,
      canReadDriveFiles: false,
      canWriteToSheets: false,
      canApproveInvoices: true,
      roleLabel: 'Перегляд + Погодження',
      roleShortLabel: 'Перегляд / Погодження',
      roleDescription: 'Доступ лише для перегляду додатку та погодження рахунків. Зчитування файлів з Google Диску та занесення даних у таблиці заблоковано.',
    };
  }

  return {
    email: normalized,
    isRestricted: false,
    canViewApp: true,
    canReadDriveFiles: true,
    canWriteToSheets: true,
    canApproveInvoices: true,
    roleLabel: 'Повний доступ',
    roleShortLabel: 'Адміністратор',
    roleDescription: 'Повний доступ до зчитування з Диску, синхронізації з Таблицями та погодження рахунків.',
  };
}
