const API_BASE = '/api';
const AUTH_BASE = '/auth';

// Types
export interface RunCheckSubmit {
  runName: string;
  section: string;
  patroller: string;
  checkTime: number; // epoch seconds
}

export interface RunCheck extends RunCheckSubmit {
  id: string;
  createdAt: number; // epoch seconds
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    credentials: 'include',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new ApiError(response.status, error.error || 'Request failed');
  }

  return response.json();
}

export const api = {
  // Auth
  async devLogin(email: string) {
    return fetchJSON<{ message: string; user: any }>(`${AUTH_BASE}/dev-login`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async login(email: string) {
    return fetchJSON<{ message: string }>(`${AUTH_BASE}/login`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async logout() {
    return fetchJSON<{ message: string }>(`${AUTH_BASE}/logout`);
  },

  async getMe() {
    return fetchJSON<{ user: any }>(`${AUTH_BASE}/me`);
  },

  // Run Status - combined endpoint
  async getRunStatus() {
    return fetchJSON<{
      runs: any[];
      checks: any[];
      patrollers: string[];
      timezone: string;
      notifications: Array<{ type: 'info' | 'warning' | 'error'; message: string }>;
    }>(`${API_BASE}/run_status`);
  },

  // Run Checks
  async submitChecks(checks: RunCheckSubmit[]) {
    return fetchJSON<{ checks: RunCheck[]; googleDriveSaved: boolean }>(`${API_BASE}/runchecks`, {
      method: 'POST',
      body: JSON.stringify({ checks }),
    });
  },

  // Users
  async getUsers() {
    return fetchJSON<{ users: any[] }>(`${API_BASE}/users`);
  },

  async createUser(email: string, name: string) {
    return fetchJSON<{ user: any }>(`${API_BASE}/users`, {
      method: 'POST',
      body: JSON.stringify({ email, name }),
    });
  },

  async toggleAdmin(userId: string, isAdmin: boolean) {
    return fetchJSON<{ user: any }>(`${API_BASE}/users/${userId}/admin`, {
      method: 'PATCH',
      body: JSON.stringify({ isAdmin }),
    });
  },

  async deleteUser(userId: string) {
    return fetchJSON<{ message: string }>(`${API_BASE}/users/${userId}`, {
      method: 'DELETE',
    });
  },

  // Google OAuth
  async getGoogleOAuthStatus() {
    return fetchJSON<any>(`${API_BASE}/google/oauth/status`);
  },

  async refreshGoogleToken() {
    return fetchJSON<any>(`${API_BASE}/google/oauth/refresh`, {
      method: 'POST',
    });
  },

  async refreshRuns() {
    return fetchJSON<{ success: boolean; runCount: number; message: string }>(
      `${API_BASE}/google/admin/refresh-runs`,
      { method: 'POST' }
    );
  },

  async disconnectGoogle() {
    return fetchJSON<{ success: boolean }>(`${API_BASE}/google/oauth/disconnect`, {
      method: 'DELETE',
    });
  },

  async testMarkOAuthInactive() {
    return fetchJSON<{ success: boolean; message: string }>(`${API_BASE}/google/oauth/test-mark-inactive`, {
      method: 'POST',
    });
  },
};

export { ApiError };
