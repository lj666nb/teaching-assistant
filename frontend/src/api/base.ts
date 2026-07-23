/**
 * Resolve application and API paths from Vite's deployment base.
 *
 * Development uses `/`, so API requests go to `/api` through Vite's proxy.
 * The production build is created with `--base=/ta/`, so the same code uses
 * `/ta/api` and stays inside the teaching-assistant application.
 */
const viteBase = import.meta.env.BASE_URL || '/';

export const APP_BASE_PATH = viteBase === '/'
  ? ''
  : `/${viteBase.replace(/^\/+|\/+$/g, '')}`;

export const API_BASE_URL = `${APP_BASE_PATH}/api`;

export function apiUrl(path = ''): string {
  const normalizedPath = path.replace(/^\/+/, '');
  return normalizedPath ? `${API_BASE_URL}/${normalizedPath}` : API_BASE_URL;
}
