import packageJson from '../package.json';

/**
 * Returns clean release version formatted as v.X.X.X (or custom format from package.json)
 */
export const RAW_VERSION: string = packageJson.version || '0.1.1';

export const formatAppVersion = (versionStr: string): string => {
  const trimmed = versionStr.trim().replace(/^v+\.?/i, '');
  return `v${trimmed}`;
};

export const APP_VERSION: string = formatAppVersion(RAW_VERSION);
