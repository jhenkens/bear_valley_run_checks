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

export interface BoardPhotoRef {
  id: string;
}

export interface BoardItem {
  id: string;
  description: string;
  section: string;
  authorName: string;
  authorId: string | null;
  createdAt: number; // epoch seconds
  isTask: boolean;
  dueDate: string | null; // yyyy-MM-dd
  dueHour: number | null; // 8-16; null = end of day (5 PM)
  assignee: string | null;
  doneAt: number | null; // epoch seconds
  doneBy: string | null;
  debriefDate: string | null;
  morningBriefDate: string | null;
  photos: string[]; // photo ids, served from /api/board/photos/:id
}

export interface BoardItemInput {
  description?: string;
  section?: string;
  isTask?: boolean;
  dueDate?: string | null;
  dueHour?: number | null;
  assignee?: string | null;
  debriefDate?: string | null; // pin for that day's debrief, yyyy-MM-dd (null to unpin)
  morningBriefDate?: string | null; // pin for that morning's brief
  done?: boolean;
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
    return fetchJSON<{ message: string }>(`${AUTH_BASE}/logout`, { method: 'POST' });
  },

  async getMe() {
    return fetchJSON<{ user: any; features?: { board?: boolean } }>(`${AUTH_BASE}/me`);
  },

  async getLoginProviders() {
    return fetchJSON<{ oidc: { name: string } | null }>(`${AUTH_BASE}/providers`);
  },

  // Passkeys
  async getPasskeys() {
    return fetchJSON<{ passkeys: any[] }>(`${AUTH_BASE}/passkey`);
  },

  async deletePasskey(id: string) {
    return fetchJSON<{ message: string }>(`${AUTH_BASE}/passkey/${id}`, {
      method: 'DELETE',
    });
  },

  async renamePasskey(id: string, name: string, token: string) {
    return fetchJSON<{ name: string }>(`${AUTH_BASE}/passkey/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name, token }),
    });
  },

  async getPasskeyRegistrationOptions() {
    return fetchJSON<any>(`${AUTH_BASE}/passkey/register/options`);
  },

  async verifyPasskeyRegistration(response: any, name: string) {
    return fetchJSON<{ verified: boolean; id: string; name: string; renameToken: string }>(`${AUTH_BASE}/passkey/register/verify`, {
      method: 'POST',
      body: JSON.stringify({ response, name }),
    });
  },

  async getPasskeyAuthenticationOptions() {
    return fetchJSON<any>(`${AUTH_BASE}/passkey/authenticate/options`);
  },

  async verifyPasskeyAuthentication(response: any) {
    return fetchJSON<{ user: any }>(`${AUTH_BASE}/passkey/authenticate/verify`, {
      method: 'POST',
      body: JSON.stringify({ response }),
    });
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
      body: JSON.stringify({ email: email || null, name }),
    });
  },

  async bulkCreateUsers(users: { name: string; email: string }[]) {
    return fetchJSON<{
      created: number;
      skipped: { name: string; email: string | null; reason: string }[];
    }>(`${API_BASE}/users/bulk`, {
      method: 'POST',
      body: JSON.stringify({ users }),
    });
  },

  async sendWelcomeEmails(userIds: string[]) {
    return fetchJSON<{ sent: number; failed: number; skipped: number }>(`${API_BASE}/users/send-welcome`, {
      method: 'POST',
      body: JSON.stringify({ userIds }),
    });
  },

  async updateUser(userId: string, data: { email?: string | null; name?: string }) {
    return fetchJSON<{ user: any; message: string }>(`${API_BASE}/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
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

  // Patrol board
  async getBoard() {
    return fetchJSON<{ items: BoardItem[]; sections: string[]; today: string }>(`${API_BASE}/board`);
  },

  async createBoardItem(data: BoardItemInput) {
    return fetchJSON<{ item: BoardItem }>(`${API_BASE}/board`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateBoardItem(id: string, data: BoardItemInput) {
    return fetchJSON<{ item: BoardItem }>(`${API_BASE}/board/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },

  async copyBoardItem(id: string, data: { to: 'tasks' | 'debrief' | 'brief'; date?: string; assignee?: string; dueDate?: string; dueHour?: number }) {
    return fetchJSON<{ item: BoardItem }>(`${API_BASE}/board/${id}/copy`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async archiveBoardItem(id: string) {
    return fetchJSON<{ sheets: boolean; written: boolean; error: string | null }>(`${API_BASE}/board/${id}/archive`, {
      method: 'POST',
    });
  },

  async deleteBoardItem(id: string) {
    return fetchJSON<{ message: string }>(`${API_BASE}/board/${id}`, { method: 'DELETE' });
  },

  async uploadBoardPhoto(itemId: string, photo: Blob) {
    return fetchJSON<{ photo: BoardPhotoRef }>(`${API_BASE}/board/${itemId}/photos`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: photo,
    });
  },

  async deleteBoardPhoto(photoId: string) {
    return fetchJSON<{ message: string }>(`${API_BASE}/board/photos/${photoId}`, { method: 'DELETE' });
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
