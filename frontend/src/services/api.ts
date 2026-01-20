const API_BASE = '/api';
const AUTH_BASE = '/auth';

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

  // Runs
  async getRuns() {
    return fetchJSON<{ runs: any[] }>(`${API_BASE}/runs`);
  },

  // Run Checks
  async getTodayChecks() {
    return fetchJSON<{ checks: any[] }>(`${API_BASE}/runchecks/today`);
  },

  async submitChecks(checks: any[]) {
    return fetchJSON<{ checks: any[] }>(`${API_BASE}/runchecks`, {
      method: 'POST',
      body: JSON.stringify({ checks }),
    });
  },

  // Patrollers
  async getPatrollers() {
    return fetchJSON<{ patrollers: string[] }>(`${API_BASE}/patrollers`);
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
};

export { ApiError };
