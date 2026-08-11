// Central API client — every request goes through here so the auth token
// and error handling only need to be written once. Same pattern as
// TraxSail's api.js.

const API_BASE = 'https://main-production-b95e.up.railway.app/webhook';

function getToken() {
  return localStorage.getItem('tk_token');
}

export function setToken(token) {
  localStorage.setItem('tk_token', token);
}

export function clearToken() {
  localStorage.removeItem('tk_token');
}

export async function apiRequest(path, { method = 'GET', body } = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const isAuthEndpoint = path.startsWith('traxkey-signup') || path.startsWith('traxkey-login');
  if (res.status === 401 && !isAuthEndpoint) {
    clearToken();
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || 'Request failed');
  }
  return json;
}
