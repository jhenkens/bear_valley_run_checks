import { api, ApiError } from './services/api';
import type { BoardItem, BoardItemInput } from './services/api';
import { detectDeviceName, isMobileDevice } from './utils/deviceName';
import { resizeImageToJpeg } from './utils/image';
import { connectSocket } from './services/socket';
import { calculateRunColors, groupRunsBySection, formatTimeSince, RunWithColor } from './utils/colorLogic';
import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthnAutofill,
  browserSupportsWebAuthn,
} from '@simplewebauthn/browser';

// Tasks with no due time are due at the end of the day, treated as 5 PM
const END_OF_DAY_HOUR = 17;

// Once the morning brief hour has passed, new brief items are for tomorrow's; likewise for the debrief
const BRIEF_HOUR = 9;
const DEBRIEF_HOUR = 17;

// From this hour on, debrief cards offer a one-tap "Copy to morning brief" (before it they only have the ⋯ menu)
const COPY_TO_BRIEF_HOUR = 16;

// A board target is where an item lives: 'tasks', or 'brief:YYYY-MM-DD' / 'debrief:YYYY-MM-DD' for that day's meeting
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// "Mon 10/26"
function formatBoardDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short' });
  return `${weekday} ${month}/${day}`;
}

function boardTargetLabel(target: string): string {
  if (target === 'tasks') return 'Tasks';
  const [kind, date] = target.split(':');
  return `${formatBoardDay(date)} ${kind === 'brief' ? 'Morning brief' : 'Debrief'}`;
}

function formatBoardHour(hour: number): string {
  return hour === 12 ? '12 PM' : hour > 12 ? `${hour - 12} PM` : `${hour} AM`;
}

type BoardPicker = 'form' | 'edit' | 'copy';

export function createApp() {
  return {
    // State
    isDev: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    loading: true,
    error: null as string | null,
    user: null as any,
    menuOpen: false,
    currentTab: 'runs' as 'runs' | 'board' | 'history' | 'patrollers' | 'admin' | 'account',
    oidcProvider: null as { name: string } | null,
    passkeys: [] as any[],
    passkeySupported: false,
    isAddingPasskey: false,
    pendingRename: null as { id: string; token: string } | null,
    renameValue: '',
    promptPasskeyCreated: false,
    showPasskeyPrompt: false,
    isSavingPasskeyPrompt: false,
    passkeyMessage: null as string | null,
    runs: [] as any[],
    checks: [] as any[],
    patrollers: [] as string[],
    notifications: [] as Array<{ type: 'info' | 'warning' | 'error'; message: string }>,
    cart: [] as any[],
    loginEmail: '',
    loginMessage: '',
    isLoggingIn: false,
    isSubmitting: false,
    showConfirm: false,
    confirmPatroller: '',
    confirmTime: '',
    patrollerSearch: '',
    showAutocomplete: false,
    users: [] as any[],
    newUserEmail: '',
    newUserName: '',
    editingUserId: null as string | null,
    editName: '',
    editEmail: '',
    bulkText: '',
    userSort: { key: 'name', dir: 'asc' } as { key: 'name' | 'email' | 'createdAt'; dir: 'asc' | 'desc' },
    welcomeSelected: {} as Record<string, boolean>,
    message: null as { type: 'success' | 'error' | 'warning'; text: string } | null,
    expandedSections: new Set<string>(),
    runSearchQuery: '',
    searchExpandedSections: new Set<string>(),
    timezone: 'UTC' as string,
    googleOAuthStatus: null as any,
    googleDriveWasDisconnected: false, // Track if we showed a disconnection warning
    _initialized: false, // Guard against double initialization
    lastUpdated: null as Date | null, // Track last data update

    // Patrol board (only active when the server has board.enabled)
    features: { board: false } as { board: boolean },
    boardItems: [] as BoardItem[],
    boardSections: ['General'] as string[],
    boardToday: '',
    boardError: null as string | null,
    isCreatingBoardItem: false,
    boardAssigneeOpen: '' as '' | BoardPicker, // which assignee picker's list is showing
    collapsedBoardGroups: new Set<string>(),
    boardExpandedId: null as string | null,
    // Draft of the open edit panel; nothing reaches the server until Save
    boardEdit: { current: 'tasks', moveTo: '', section: 'General', assignee: '', dueDate: '', dueHour: '' },
    // 8 AM to 4 PM in hour steps; blank = end of day. Values are strings because <select> binds strings.
    boardDueHours: [
      { value: '', label: 'End of day' },
      ...[8, 9, 10, 11, 12, 13, 14, 15, 16].map(h => ({ value: String(h), label: formatBoardHour(h) })),
    ],
    boardPhotoTargetId: null as string | null,
    // Copy modal. The draft always exists (never null) because the modal's inputs bind to its fields
    // when the page loads, and Alpine's CSP build throws on a null path.
    boardCopyOpen: false,
    boardCopy: { itemId: '', description: '', to: 'tasks', assignee: '', dueDate: '', dueHour: '' },
    boardToast: '',
    boardNow: Date.now(), // ticks every minute so time-based buttons and options update on a screen left open
    _boardClock: 0,
    boardPhotoView: '', // id of the photo open in the full-screen viewer
    // What the delete / archive confirmation modal is about; null while it's closed
    boardDelete: null as { kind: 'item' | 'photo' | 'archive'; id: string; label: string } | null,
    boardForm: {
      description: '',
      showMore: false,
      location: 'tasks',
      section: 'General',
      assignee: '',
      dueDate: '',
      dueHour: '',
      photos: [] as Blob[],
      photoUrls: [] as string[],
    },

    // Computed
    get sortedUsers() {
      const { key, dir } = this.userSort;
      const sign = dir === 'asc' ? 1 : -1;
      return [...this.users].sort((a, b) => {
        const cmp = key === 'createdAt'
          ? new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          : (a[key] || '').localeCompare(b[key] || '', undefined, { sensitivity: 'base' });
        return sign * cmp || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    },

    sortUsersBy(key: 'name' | 'email' | 'createdAt') {
      this.userSort = {
        key,
        dir: this.userSort.key === key && this.userSort.dir === 'asc' ? 'desc' : 'asc',
      };
    },

    sortIndicator(key: string) {
      return this.userSort.key === key ? (this.userSort.dir === 'asc' ? '▲' : '▼') : '';
    },

    formatUserDate(iso: string) {
      return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    },

    // Only users with an email can receive a welcome email
    get welcomeEligibleUsers() {
      return this.users.filter(u => !!u.email);
    },

    get welcomeSelectedIds() {
      return this.welcomeEligibleUsers.filter(u => this.welcomeSelected[u.id]).map(u => u.id as string);
    },

    get allWelcomeSelected() {
      return this.welcomeEligibleUsers.length > 0 &&
        this.welcomeSelectedIds.length === this.welcomeEligibleUsers.length;
    },

    toggleAllWelcome() {
      const select = !this.allWelcomeSelected;
      const next: Record<string, boolean> = {};
      if (select) for (const u of this.welcomeEligibleUsers) next[u.id] = true;
      this.welcomeSelected = next;
    },

    async sendWelcomeEmails() {
      const ids = this.welcomeSelectedIds;
      if (ids.length === 0) return;
      if (!confirm(`Send welcome email to ${ids.length} user${ids.length !== 1 ? 's' : ''}?`)) return;
      try {
        this.error = null;
        const res = await api.sendWelcomeEmails(ids);
        const parts = [`${res.sent} welcome email(s) sent`];
        if (res.failed) parts.push(`${res.failed} failed`);
        this.showMessage(res.failed ? 'warning' : 'success', parts.join('. '));
        this.welcomeSelected = {};
      } catch (err: any) {
        this.error = err.message || 'Failed to send welcome emails';
      }
    },

    // Lowercased names/emails that appear on more than one user
    get duplicateUserKeys() {
      const names = new Map<string, number>();
      const emails = new Map<string, number>();
      for (const u of this.users) {
        const n = u.name.trim().toLowerCase();
        names.set(n, (names.get(n) || 0) + 1);
        if (u.email) {
          const e = u.email.trim().toLowerCase();
          emails.set(e, (emails.get(e) || 0) + 1);
        }
      }
      return { names, emails };
    },

    isDuplicateName(u: any) {
      return (this.duplicateUserKeys.names.get(u.name.trim().toLowerCase()) || 0) > 1;
    },

    isDuplicateEmail(u: any) {
      return !!u.email && (this.duplicateUserKeys.emails.get(u.email.trim().toLowerCase()) || 0) > 1;
    },

    // Patrollers matching the search, those who have run checked today first (not everyone works every day), then alphabetical
    get filteredPatrollers() {
      return this.matchPatrollers(this.patrollerSearch);
    },

    matchPatrollers(text: string) {
      const search = text.toLowerCase();
      const checkedToday = new Set(this.checks.map((c: any) => c.patroller.trim().toLowerCase()));
      return this.patrollers
        .filter(p => p.toLowerCase().includes(search))
        .map(p => ({ name: p, checkedToday: checkedToday.has(p.trim().toLowerCase()) }))
        .sort((a, b) =>
          Number(b.checkedToday) - Number(a.checkedToday) ||
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },

    get groupedRuns() {
      const runsWithColors = calculateRunColors(this.runs, this.checks);
      const grouped = groupRunsBySection(runsWithColors);
      return Array.from(grouped.entries());
    },

    get filteredGroupedRuns() {
      const query = this.runSearchQuery.toLowerCase().trim();

      if (!query) {
        return this.groupedRuns;
      }

      const runsWithColors = calculateRunColors(this.runs, this.checks);
      const grouped = new Map<string, RunWithColor[]>();

      for (const run of runsWithColors) {
        if (run.name.toLowerCase().includes(query)) {
          if (!grouped.has(run.section)) {
            grouped.set(run.section, []);
          }
          grouped.get(run.section)!.push(run);
        }
      }

      return Array.from(grouped.entries());
    },

    get totalMatchCount() {
      if (!this.runSearchQuery.trim()) {
        return 0;
      }
      return this.filteredGroupedRuns.reduce((sum, [_, runs]) => sum + runs.length, 0);
    },

    get groupedChecks() {
      const grouped = new Map<string, any[]>();
      for (const check of this.checks) {
        if (!grouped.has(check.section)) {
          grouped.set(check.section, []);
        }
        grouped.get(check.section)!.push(check);
      }
      return Array.from(grouped.entries());
    },

    get historyBySection() {
      // Create a map of all runs by section, including those with no checks
      const sectionMap = new Map<string, Array<{ runName: string; checks: any[] }>>();

      // First, initialize with all runs from the runs list
      for (const [section, runs] of this.groupedRuns) {
        if (!sectionMap.has(section)) {
          sectionMap.set(section, []);
        }
        for (const run of runs) {
          sectionMap.get(section)!.push({
            runName: run.name,
            checks: []
          });
        }
      }

      // Then, populate with checks
      for (const check of this.checks) {
        const section = sectionMap.get(check.section);
        if (section) {
          const run = section.find(r => r.runName === check.runName);
          if (run) {
            run.checks.push(check);
          }
        }
      }

      // Sort checks within each run by checkTime (oldest first, newest last)
      for (const section of sectionMap.values()) {
        for (const run of section) {
          run.checks.sort((a, b) => new Date(a.checkTime).getTime() - new Date(b.checkTime).getTime());
        }
      }

      // Return as array maintaining section order from groupedRuns
      return Array.from(sectionMap.entries());
    },

    get checksByPatroller() {
      const grouped = new Map<string, any[]>();
      for (const check of this.checks) {
        if (!grouped.has(check.patroller)) {
          grouped.set(check.patroller, []);
        }
        grouped.get(check.patroller)!.push(check);
      }
      // Sort by patroller name alphabetically
      return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    },

    // The menu holds the less-used pages, so its button lights up while one of them is open
    get isMenuTabActive() {
      return this.currentTab !== 'runs' && this.currentTab !== 'board';
    },

    get canCreateBoardItem() {
      return !this.isCreatingBoardItem && !!this.boardForm.description.trim();
    },

    // The morning brief and debrief that new items go to: today's until its hour has passed, then tomorrow's
    get boardNextBriefDate() {
      return this.currentBoardHour() < BRIEF_HOUR ? this.boardToday : addDays(this.boardToday, 1);
    },

    get boardNextDebriefDate() {
      return this.currentBoardHour() < DEBRIEF_HOUR ? this.boardToday : addDays(this.boardToday, 1);
    },

    // Where items can be added, moved or copied to: Tasks, the next morning brief, and the next debrief
    get boardTargets() {
      const targets = [{ value: 'tasks', label: 'Tasks' }];
      if (!this.boardToday) return targets;
      for (const value of [`brief:${this.boardNextBriefDate}`, `debrief:${this.boardNextDebriefDate}`]) {
        targets.push({ value, label: boardTargetLabel(value) });
      }
      return targets;
    },

    // Move to and Copy to leave out the item's own type: a debrief item isn't offered a debrief, and so on
    boardTargetsFor(item: BoardItem) {
      const kind = this.boardLocationKind(item);
      return this.boardTargets.filter(target => target.value.split(':')[0] !== kind);
    },

    // The section choices, always including the item's own (a run may since have left the config)
    boardSectionsFor(item: BoardItem) {
      return this.boardSections.includes(item.section) ? this.boardSections : [...this.boardSections, item.section];
    },

    // Where the open edit panel's item will be once saved: the Move to choice, else where it is now
    get boardEditLocation() {
      return this.boardEdit.moveTo || this.boardEdit.current;
    },

    // Tasks first, then this morning's brief and tonight's debrief. Anything pinned to a later day stays out
    // of sight until its day comes (a task still shows under Tasks).
    get boardGroups() {
      const byCreated = (a: BoardItem, b: BoardItem) => a.createdAt - b.createdAt;
      const byDue = (a: BoardItem, b: BoardItem) =>
        Number(!!a.doneAt) - Number(!!b.doneAt) ||
        (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99') ||
        (a.dueHour ?? END_OF_DAY_HOUR) - (b.dueHour ?? END_OF_DAY_HOUR) ||
        byCreated(a, b);

      const brief = `brief:${this.boardToday}`;
      const debrief = `debrief:${this.boardToday}`;
      const groups = [
        { key: 'tasks', title: 'Tasks', items: [] as BoardItem[], sort: byDue },
        { key: 'brief', title: boardTargetLabel(brief), items: [] as BoardItem[], sort: byCreated },
        { key: 'debrief', title: boardTargetLabel(debrief), items: [] as BoardItem[], sort: byCreated },
      ];
      for (const item of this.boardItems) {
        const location = this.boardLocation(item);
        if (location === brief) groups[1].items.push(item);
        else if (location === debrief) groups[2].items.push(item);
        else if (item.isTask) groups[0].items.push(item);
      }
      for (const group of groups) group.items.sort(group.sort);
      return groups.filter(group => group.items.length > 0);
    },

    // Init
    async init() {
      if (this._initialized) {
        console.log('App already initialized, skipping...');
        return;
      }
      this._initialized = true;

      try {
        this.loading = true;
        // Load expanded sections from localStorage
        const savedSections = localStorage.getItem('expandedSections');
        if (savedSections) {
          try {
            this.expandedSections = new Set(JSON.parse(savedSections));
          } catch (e) {
            // Failed to parse - not critical, will use default state
          }
        }
        this.loadBoardDraft();
        this.showLoginErrorFromUrl();
        this.passkeySupported = browserSupportsWebAuthn();
        await this.checkAuth();
        if (this.user) {
          this.maybePromptForPasskey();
          await this.loadData();
          this.connectLiveUpdates();
          this.setupVisibilityListener();
        } else {
          await this.loadLoginProviders();
          // Fire-and-forget: registers the browser's passkey autofill listener on the login form's
          // email input. Resolves only once the user picks a passkey, so it must not be awaited.
          this.tryPasskeyAutofillLogin();
        }
      } catch (err: any) {
        console.error('Init error:', err);
      } finally {
        this.loading = false;
      }
    },

    async checkAuth() {
      try {
        const { user, features } = await api.getMe();
        this.user = user;
        this.features = { board: !!features?.board };
      } catch (err: any) {
        if (err.status !== 401) {
          console.error('Auth check error:', err);
        }
        this.user = null;
      }
    },

    async loadData() {
      this.loadBoard();
      try {
        const statusRes = await api.getRunStatus();

        this.runs = statusRes.runs;
        this.timezone = statusRes.timezone || 'UTC';
        this.notifications = statusRes.notifications || [];
        this.checks = statusRes.checks.map((c: any) => ({
          ...c,
          checkTime: new Date(c.checkTime * 1000),
          createdAt: new Date(c.createdAt * 1000),
        }));
        this.patrollers = statusRes.patrollers;
        this.lastUpdated = new Date(); // Update last refresh time

        if (this.user.isAdmin) {
          const usersRes = await api.getUsers();
          this.users = usersRes.users;

          // Load Google OAuth status (admin only)
          try {
            this.googleOAuthStatus = await api.getGoogleOAuthStatus();
          } catch (err) {
            console.error('Failed to load Google OAuth status:', err);
            this.googleOAuthStatus = null;
          }
        } else {
          // Clear OAuth status for non-admins
          this.googleOAuthStatus = null;
        }
      } catch (err: any) {
        this.error = err.message || 'Failed to load data';
      }
    },

    // Auth
    async devLogin() {
      if (this.isLoggingIn) return;
      
      try {
        this.isLoggingIn = true;
        this.error = null;
        this.loginMessage = '';
        await api.devLogin(this.loginEmail);
        // Reload to get authenticated session
        window.location.reload();
      } catch (err: any) {
        this.error = err.message || 'Login failed';
        this.isLoggingIn = false;
      }
    },

    async login() {
      if (this.isLoggingIn) return;
      
      try {
        this.isLoggingIn = true;
        this.error = null;
        this.loginMessage = '';
        await api.login(this.loginEmail);
        this.loginMessage = 'Check your email for the login link!';
        this.loginEmail = '';
      } catch (err: any) {
        this.error = err.message || 'Login failed';
      } finally {
        this.isLoggingIn = false;
      }
    },

    async logout() {
      try {
        await api.logout();
        window.location.reload();
      } catch (err: any) {
        this.error = err.message || 'Logout failed';
      }
    },

    // After a magic link login on a phone, offer a one-tap passkey - at most once every 30 days.
    // The server marks magic link logins with ?login=magic on the redirect to /.
    maybePromptForPasskey() {
      const params = new URLSearchParams(window.location.search);
      if (params.get('login') !== 'magic') return;
      params.delete('login');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));

      if (!this.passkeySupported || !isMobileDevice() || this.user?.oidcOnly) return;
      const PROMPT_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;
      try {
        const last = Number(localStorage.getItem('passkeyPromptShownAt') || 0);
        if (Date.now() - last < PROMPT_INTERVAL_MS) return;
        localStorage.setItem('passkeyPromptShownAt', String(Date.now()));
      } catch (e) {
        return; // Storage unavailable: don't risk nagging on every login
      }
      this.promptPasskeyCreated = false;
      this.showPasskeyPrompt = true;
    },

    async savePasskeyFromPrompt() {
      if (this.isSavingPasskeyPrompt) return;
      try {
        this.isSavingPasskeyPrompt = true;
        this.error = null;
        await this.registerPasskey();
        this.promptPasskeyCreated = true;
      } catch (err: any) {
        if (err?.name !== 'NotAllowedError') {
          this.error = err.message || 'Failed to add passkey';
        }
      } finally {
        this.isSavingPasskeyPrompt = false;
      }
    },

    // Runs the browser registration ceremony. The server names the passkey after its provider
    // (e.g. 1Password) when it can tell, else uses our device label; then the user can rename it.
    async registerPasskey() {
      const optionsJSON = await api.getPasskeyRegistrationOptions();
      const response = await startRegistration({ optionsJSON });
      const { id, name, renameToken } = await api.verifyPasskeyRegistration(response, detectDeviceName());
      this.rememberDevicePasskey(id);
      this.pendingRename = { id, token: renameToken };
      this.renameValue = name;
      await this.loadPasskeys();
    },

    // Rename is only offered right after creation, using the one-time token from the server
    async saveRenamePasskey() {
      const pending = this.pendingRename;
      const name = this.renameValue.trim();
      if (!pending || !name) return;
      try {
        await api.renamePasskey(pending.id, name, pending.token);
        await this.loadPasskeys();
        this.finishRename();
      } catch (err: any) {
        this.error = err.message || 'Failed to rename passkey';
      }
    },

    finishRename() {
      this.pendingRename = null;
      this.showPasskeyPrompt = false;
    },

    // Remember which passkeys were created on this device, so removing the last one re-arms
    // the 30-day login prompt (the server can't tell us which device a passkey lives on).
    rememberDevicePasskey(id: string) {
      try {
        const ids = JSON.parse(localStorage.getItem('devicePasskeyIds') || '[]');
        localStorage.setItem('devicePasskeyIds', JSON.stringify([...ids, id]));
        localStorage.setItem('passkeyPromptShownAt', String(Date.now()));
      } catch (e) {
        // Not critical
      }
    },

    forgetDevicePasskey(id: string) {
      try {
        const ids: string[] = JSON.parse(localStorage.getItem('devicePasskeyIds') || '[]');
        if (!ids.includes(id)) return;
        const remaining = ids.filter((x) => x !== id);
        localStorage.setItem('devicePasskeyIds', JSON.stringify(remaining));
        if (remaining.length === 0) {
          localStorage.removeItem('passkeyPromptShownAt');
        }
      } catch (e) {
        // Not critical
      }
    },

    // The OIDC callback redirects back here with ?login_error=... on failure.
    showLoginErrorFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const loginError = params.get('login_error');
      if (loginError) {
        this.error = loginError;
        window.history.replaceState({}, '', window.location.pathname);
      }
    },

    async loadLoginProviders() {
      try {
        const { oidc } = await api.getLoginProviders();
        this.oidcProvider = oidc;
      } catch (err: any) {
        console.error('Failed to load login providers:', err);
      }
    },

    loginWithOidc() {
      window.location.href = '/auth/oidc/login';
    },

    // Passkeys - login
    async tryPasskeyAutofillLogin() {
      try {
        if (!(await browserSupportsWebAuthnAutofill())) {
          return;
        }

        const optionsJSON = await api.getPasskeyAuthenticationOptions();
        const response = await startAuthentication({ optionsJSON, useBrowserAutofill: true });
        await api.verifyPasskeyAuthentication(response);

        // The verify response only has id/name/email; /me also has isAdmin/isSuperuser
        await this.checkAuth();
        await this.loadData();
        this.connectLiveUpdates();
        this.setupVisibilityListener();
      } catch (err: any) {
        // The user dismissing the prompt (or no passkey being available) is
        // routine, not an error worth surfacing.
        if (err?.name !== 'NotAllowedError') {
          console.error('Passkey autofill login error:', err);
        }
      }
    },

    async loginWithPasskey() {
      if (this.isLoggingIn) return;

      try {
        this.isLoggingIn = true;
        this.error = null;
        const optionsJSON = await api.getPasskeyAuthenticationOptions();
        const response = await startAuthentication({ optionsJSON });
        await api.verifyPasskeyAuthentication(response);

        // The verify response only has id/name/email; /me also has isAdmin/isSuperuser
        await this.checkAuth();
        await this.loadData();
        this.connectLiveUpdates();
        this.setupVisibilityListener();
      } catch (err: any) {
        if (err?.name !== 'NotAllowedError') {
          this.error = err.message || 'Passkey login failed';
        }
      } finally {
        this.isLoggingIn = false;
      }
    },

    // Passkeys - management (once logged in)
    async loadPasskeys() {
      try {
        const { passkeys } = await api.getPasskeys();
        this.passkeys = passkeys;
      } catch (err: any) {
        this.error = err.message || 'Failed to load passkeys';
      }
    },

    async addPasskey() {
      if (this.isAddingPasskey) return;

      try {
        this.isAddingPasskey = true;
        this.error = null;
        this.passkeyMessage = null;

        await this.registerPasskey();
        this.passkeyMessage = 'Passkey added';
      } catch (err: any) {
        if (err?.name !== 'NotAllowedError') {
          this.error = err.message || 'Failed to add passkey';
        }
      } finally {
        this.isAddingPasskey = false;
      }
    },

    async removePasskey(id: string) {
      try {
        await api.deletePasskey(id);
        this.forgetDevicePasskey(id);
        if (this.pendingRename?.id === id) this.finishRename();
        this.passkeys = this.passkeys.filter((p: any) => p.id !== id);
      } catch (err: any) {
        this.error = err.message || 'Failed to remove passkey';
      }
    },

    // Template helpers: Alpine's CSP build can't run `?.`, `new Date(...)` or multi-statement
    // expressions inline, so the template calls these instead.
    oidcButtonLabel(): string {
      return 'Sign in with ' + (this.oidcProvider ? this.oidcProvider.name : '');
    },

    userName(): string {
      return this.user ? this.user.name : '';
    },

    userEmailLabel(): string {
      return this.user && this.user.email ? ' (' + this.user.email + ')' : '';
    },

    messageClass(): string {
      return 'message ' + (this.message ? this.message.type : '');
    },

    clearRunSearch() {
      this.runSearchQuery = '';
      this.handleRunSearch();
    },

    formatClockTime(epochMs: number | string): string {
      return new Date(epochMs).toLocaleTimeString();
    },

    passkeyDetails(passkey: any): string {
      let text = 'Added ' + new Date(passkey.createdAt).toLocaleDateString();
      if (passkey.lastUsedAt) {
        text += ' · last used ' + new Date(passkey.lastUsedAt).toLocaleDateString();
      }
      return text;
    },

    toggleMenu() {
      this.menuOpen = !this.menuOpen;
    },

    closeMenu() {
      this.menuOpen = false;
    },

    openMenuTab(tab: 'history' | 'patrollers' | 'account' | 'admin') {
      this.closeMenu();
      this.switchTab(tab);
    },

    // Tabs
    switchTab(tab: typeof this.currentTab) {
      this.currentTab = tab;
      this.menuOpen = false;
      this.showConfirm = false;
      // Clear search when switching away from runs tab
      if (tab !== 'runs') {
        this.runSearchQuery = '';
        this.handleRunSearch();
      }
      if (tab === 'board') {
        this.loadBoard();
      }
      if (tab === 'account' && !this.user?.oidcOnly && this.passkeys.length === 0) {
        this.loadPasskeys();
      }
    },

    // Cart
    toggleRunInCart(run: RunWithColor) {
      const index = this.cart.findIndex(r => r.name === run.name && r.section === run.section);
      if (index >= 0) {
        this.cart.splice(index, 1);
      } else {
        this.cart.push(run);
      }
    },

    isInCart(run: RunWithColor) {
      return this.cart.some(r => r.name === run.name && r.section === run.section);
    },

    clearCart() {
      this.cart = [];
      this.showConfirm = false;
    },

    // Confirm
    openConfirm() {
      if (this.cart.length === 0) return;
      this.showConfirm = true;
      // Default to logged in user's name
      const defaultPatroller = this.user?.name || '';
      this.confirmPatroller = defaultPatroller;
      this.patrollerSearch = defaultPatroller;
      // Set time-only to current time (HH:MM format)
      const now = new Date();
      this.confirmTime = now.toTimeString().slice(0, 5); // HH:MM
      this.showAutocomplete = false;
    },

    async submitChecks() {
      if (this.isSubmitting) return;
      
      try {
        this.isSubmitting = true;
        this.error = null;

        // No blocking - we allow submissions even if Drive is disconnected
        // The backend will handle the failure gracefully

        if (!this.confirmPatroller) {
          this.error = 'Please select a patroller';
          this.isSubmitting = false;
          return;
        }

        if (!this.confirmTime) {
          this.error = 'Please select a time';
          this.isSubmitting = false;
          return;
        }

        // Parse time (HH:MM) and combine with today's date
        const [hours, minutes] = this.confirmTime.split(':').map(Number);
        const checkTimeDate = new Date();
        checkTimeDate.setHours(hours, minutes, 0, 0);
        
        // Convert to epoch seconds
        const checkTimeEpoch = Math.floor(checkTimeDate.getTime() / 1000);

        const checks = this.cart.map(run => ({
          runName: run.name,
          section: run.section,
          patroller: this.confirmPatroller,
          checkTime: checkTimeEpoch,
        }));

        const response = await api.submitChecks(checks);

        // Check if Google Drive save succeeded
        if (response.googleDriveSaved) {
          // Drive save succeeded
          if (this.googleDriveWasDisconnected) {
            // Drive was previously disconnected but is now working
            this.showMessage('success', `✅ Submitted ${checks.length} run check(s) - Google Drive reconnected!`);
            this.googleDriveWasDisconnected = false;
          } else {
            this.showMessage('success', `Submitted ${checks.length} run check(s)`);
          }
        } else {
          // Drive save failed - stored in memory only
          this.showMessage('warning', `⚠️ Submitted ${checks.length} run check(s) - saved to memory only (Google Drive disconnected)`);
          this.googleDriveWasDisconnected = true;
        }

        this.clearCart();
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to submit checks';
      } finally {
        this.isSubmitting = false;
      }
    },

    // Autocomplete
    filterPatrollers() {
      this.showAutocomplete = true;
    },

    // Focusing the box clears it so a different patroller can be searched right away
    focusPatroller() {
      this.clearPatroller();
      this.showAutocomplete = true;
    },

    selectPatroller(patroller: string) {
      this.confirmPatroller = patroller;
      this.patrollerSearch = patroller;
      this.showAutocomplete = false;
    },

    clearPatroller() {
      this.confirmPatroller = '';
      this.patrollerSearch = '';
      this.showAutocomplete = false;
    },

    // Admin
    async createUser() {
      try {
        this.error = null;

        if (!this.newUserName) {
          this.error = 'Name is required';
          return;
        }

        await api.createUser(this.newUserEmail, this.newUserName);
        this.showMessage('success', 'User created');
        this.newUserEmail = '';
        this.newUserName = '';
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to create user';
      }
    },

    // Parse pasted CSV: one user per line, "name,email" or "email,name"
    // (also accepts "Name <email>" and an optional header row)
    parseBulkUsers(text: string): { name: string; email: string }[] {
      const splitCsv = (line: string) => {
        const fields: string[] = [];
        let cur = '';
        let quoted = false;
        for (let i = 0; i < line.length; i++) {
          const c = line[i];
          if (quoted) {
            if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
            else if (c === '"') quoted = false;
            else cur += c;
          } else if (c === '"') quoted = true;
          else if (c === ',' || c === '\t' || c === ';') { fields.push(cur.trim()); cur = ''; }
          else cur += c;
        }
        fields.push(cur.trim());
        return fields;
      };
      const rows: { name: string; email: string }[] = [];
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const fields = splitCsv(line).filter(f => f);
        let name = '';
        let email = '';
        for (const f of fields) {
          const angle = f.match(/^(.*?)\s*<([^>]+@[^>]+)>$/);
          if (angle) { name = angle[1].replace(/^"|"$/g, '').trim(); email = angle[2].trim(); }
          else if (f.includes('@') && !email) email = f;
          else if (!name) name = f;
        }
        if (/^name$/i.test(name) && /^e-?mail$/i.test(email || fields[1] || '')) continue; // header
        if (/^(name|e-?mail)$/i.test(fields[0] || '') && !email) continue;
        if (name || email) rows.push({ name, email });
      }
      return rows;
    },

    async bulkCreateUsers() {
      try {
        this.error = null;
        const rows = this.parseBulkUsers(this.bulkText);
        if (rows.length === 0) {
          this.error = 'Nothing to upload';
          return;
        }
        const res = await api.bulkCreateUsers(rows);
        const parts = [`Created ${res.created} user(s)`];
        if (res.skipped.length) {
          parts.push(`Skipped ${res.skipped.length}: ` +
            res.skipped.map(s => `${s.name || s.email || '(blank)'} (${s.reason})`).join('; '));
        }
        this.showMessage(res.skipped.length ? 'warning' : 'success', parts.join('. '));
        // Keep only the skipped rows in the box so they can be fixed and retried
        this.bulkText = res.skipped.map(s => `${s.name},${s.email || ''}`).join('\n');
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to bulk create users';
      }
    },

    editUser(user: any) {
      this.editingUserId = user.id;
      this.editName = user.name;
      this.editEmail = user.email || '';
    },

    cancelEdit() {
      this.editingUserId = null;
      this.editName = '';
      this.editEmail = '';
    },

    async saveUser() {
      try {
        this.error = null;

        if (!this.editName.trim()) {
          this.error = 'Name is required';
          return;
        }

        await api.updateUser(this.editingUserId!, {
          name: this.editName,
          email: this.editEmail.trim() || null,
        });
        this.showMessage('success', 'User updated');
        this.cancelEdit();
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to update user';
      }
    },

    async toggleAdmin(user: any) {
      try {
        this.error = null;
        await api.toggleAdmin(user.id, !user.isAdmin);
        this.showMessage('success', `Admin status updated`);
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to update admin status';
      }
    },

    async deleteUser(user: any) {
      if (!confirm(`Delete user ${user.name}?`)) return;

      try {
        this.error = null;
        await api.deleteUser(user.id);
        this.showMessage('success', 'User deleted');
        this.cancelEdit();
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to delete user';
      }
    },

    // Google OAuth
    linkGoogleDrive() {
      window.location.href = '/api/google/oauth/authorize';
    },

    async refreshGoogleToken() {
      try {
        await api.refreshGoogleToken();
        const refreshResult = await api.refreshRuns();

        this.showMessage('success', `✅ ${refreshResult.message}`);
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to refresh connection';
      }
    },

    async disconnectGoogle() {
      if (!confirm('Disconnect Google Drive? You will need to re-link to use Google Sheets.')) return;

      try {
        await api.disconnectGoogle();
        this.showMessage('success', 'Google Drive disconnected');
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to disconnect';
      }
    },

    async testMarkInactive() {
      if (!confirm('Force Google OAuth into inactive state for testing? The next successful API call will reactivate it.')) return;

      try {
        await api.testMarkOAuthInactive();
        this.showMessage('success', '🧪 OAuth marked as inactive. Submit a run check to test reconnection.');
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to mark inactive';
      }
    },

    // Socket
    connectLiveUpdates() {
      if (!this._boardClock) {
        this._boardClock = window.setInterval(() => {
          this.boardNow = Date.now();
        }, 60 * 1000);
      }
      connectSocket(
        this.handleNewCheck.bind(this),
        this.handleSocketReconnect.bind(this),
        this.loadBoard.bind(this),
      );
    },

    // Patrol board
    async loadBoard() {
      if (!this.features.board) return;
      try {
        const res = await api.getBoard();
        this.boardItems = res.items;
        this.boardSections = res.sections;
        this.boardToday = res.today;
      } catch (err) {
        console.error('Failed to load board:', err);
      }
    },

    // The unsent text survives a reload or a dead-signal failure until it's actually saved
    loadBoardDraft() {
      try {
        this.boardForm.description = localStorage.getItem('boardDraft') || '';
        this.collapsedBoardGroups = new Set(JSON.parse(localStorage.getItem('collapsedBoardGroups') || '[]'));
      } catch (e) {
        // Storage unavailable - not critical
      }
    },

    saveBoardDraft() {
      try {
        if (this.boardForm.description) {
          localStorage.setItem('boardDraft', this.boardForm.description);
        } else {
          localStorage.removeItem('boardDraft');
        }
      } catch (e) {
        // Storage unavailable - not critical
      }
    },

    toggleBoardGroup(key: string) {
      if (this.collapsedBoardGroups.has(key)) {
        this.collapsedBoardGroups.delete(key);
      } else {
        this.collapsedBoardGroups.add(key);
      }
      try {
        localStorage.setItem('collapsedBoardGroups', JSON.stringify(Array.from(this.collapsedBoardGroups)));
      } catch (e) {
        // Storage unavailable - not critical
      }
    },

    isBoardGroupCollapsed(key: string) {
      return this.collapsedBoardGroups.has(key);
    },

    toggleBoardMore() {
      this.boardForm.showMore = !this.boardForm.showMore;
    },

    // Assignee picker: the same searchable patroller list as run checks, for the create form and the edit panel
    boardAssigneeText(which: BoardPicker) {
      if (which === 'form') return this.boardForm.assignee;
      if (which === 'edit') return this.boardEdit.assignee;
      return this.boardCopy.assignee;
    },

    setBoardAssignee(which: BoardPicker, name: string) {
      if (which === 'form') this.boardForm.assignee = name;
      else if (which === 'edit') this.boardEdit.assignee = name;
      else this.boardCopy.assignee = name;
      this.boardAssigneeOpen = '';
    },

    boardAssigneeMatches(which: BoardPicker) {
      return this.matchPatrollers(this.boardAssigneeText(which));
    },

    openBoardAssignee(which: BoardPicker) {
      this.boardAssigneeOpen = which;
    },

    closeBoardAssignee() {
      this.boardAssigneeOpen = '';
    },

    pickBoardAssignee(which: BoardPicker, name: string) {
      this.setBoardAssignee(which, name);
    },

    clearBoardAssignee(which: BoardPicker) {
      this.setBoardAssignee(which, '');
    },

    assignBoardToMe(which: BoardPicker) {
      this.setBoardAssignee(which, this.user.name);
    },

    async addBoardFormPhotos(event: Event) {
      const input = event.target as HTMLInputElement;
      const files = Array.from(input.files || []);
      input.value = ''; // Allow picking the same photo again
      for (const file of files) {
        if (this.boardForm.photos.length >= 3) {
          this.boardError = 'At most 3 photos per item';
          break;
        }
        try {
          const blob = await resizeImageToJpeg(file);
          this.boardForm.photos.push(blob);
          this.boardForm.photoUrls.push(URL.createObjectURL(blob));
        } catch (err: any) {
          this.boardError = err.message || 'Could not read that photo';
        }
      }
    },

    removeBoardFormPhoto(url: string) {
      const index = this.boardForm.photoUrls.indexOf(url);
      if (index < 0) return;
      URL.revokeObjectURL(url);
      this.boardForm.photoUrls.splice(index, 1);
      this.boardForm.photos.splice(index, 1);
    },

    resetBoardForm() {
      for (const url of this.boardForm.photoUrls) URL.revokeObjectURL(url);
      this.boardForm.description = '';
      this.boardForm.showMore = false;
      this.boardForm.location = 'tasks';
      this.boardForm.section = 'General';
      this.boardForm.assignee = '';
      this.boardForm.dueDate = '';
      this.boardForm.dueHour = '';
      this.boardForm.photos = [];
      this.boardForm.photoUrls = [];
      this.saveBoardDraft();
    },

    async createBoardItem() {
      const form = this.boardForm;
      const description = form.description.trim();
      if (!description || this.isCreatingBoardItem) return;

      const payload: BoardItemInput = {
        description,
        section: form.section,
      };
      if (form.location === 'tasks') {
        payload.isTask = true;
        if (form.assignee.trim()) payload.assignee = form.assignee.trim();
        if (form.dueDate) payload.dueDate = form.dueDate;
        if (form.dueHour) payload.dueHour = Number(form.dueHour);
      } else {
        Object.assign(payload, this.boardLocationChanges(form.location));
      }

      this.isCreatingBoardItem = true;
      this.boardError = null;
      try {
        const { item } = await api.createBoardItem(payload);
        const photos = form.photos;
        this.resetBoardForm();

        let failedPhotos = 0;
        for (const photo of photos) {
          try {
            await api.uploadBoardPhoto(item.id, photo);
          } catch (err) {
            failedPhotos++;
          }
        }
        await this.loadBoard();
        if (failedPhotos > 0) {
          this.showMessage('warning', `Saved, but ${failedPhotos} photo(s) did not upload. Add them from the item.`);
        }
      } catch (err: any) {
        this.boardError = err instanceof ApiError
          ? err.message
          : "Couldn't reach the server. Your text is kept on this device - tap Create to try again.";
      } finally {
        this.isCreatingBoardItem = false;
      }
    },

    async updateBoardItem(item: BoardItem, data: BoardItemInput) {
      try {
        this.boardError = null;
        const res = await api.updateBoardItem(item.id, data);
        this.boardItems = this.boardItems.map(existing => existing.id === item.id ? res.item : existing);
        return true;
      } catch (err: any) {
        this.boardError = err.message || 'Could not update that item';
        this.loadBoard();
        return false;
      }
    },

    // Due date and assignee only show for items in the Tasks list; in Debrief or Morning brief it's a note
    showBoardTaskInfo(item: BoardItem) {
      return item.isTask && this.boardLocation(item) === 'tasks';
    },

    boardHasBadges(item: BoardItem) {
      return item.section !== 'General' || this.showBoardTaskInfo(item) || !!item.doneAt;
    },

    // The target an item shows under: today's morning brief or debrief if it's pinned to one (the brief
    // comes first), otherwise 'tasks'. Pins for later days don't count until that day.
    boardLocation(item: BoardItem): string {
      if (item.morningBriefDate === this.boardToday) return 'brief:' + this.boardToday;
      if (item.debriefDate === this.boardToday) return 'debrief:' + this.boardToday;
      return 'tasks';
    },

    boardLocationKind(item: BoardItem): 'tasks' | 'brief' | 'debrief' {
      return this.boardLocation(item).split(':')[0] as 'tasks' | 'brief' | 'debrief';
    },

    // Moving is exclusive: it pins the item for one meeting (or none, for Tasks) and unpins the other
    boardLocationChanges(target: string): BoardItemInput {
      if (target === 'tasks') return { isTask: true, debriefDate: null, morningBriefDate: null };
      const [kind, date] = target.split(':');
      return kind === 'brief'
        ? { morningBriefDate: date, debriefDate: null }
        : { debriefDate: date, morningBriefDate: null };
    },

    // A debrief card's one-tap copy goes to the brief after that debrief (its day + 1), and only appears late in
    // the day. The label runs for every card (x-show only hides the button), so it must cope with non-debrief cards.
    boardCopyBriefDate(item: BoardItem) {
      const date = this.boardLocation(item).split(':')[1];
      return date ? addDays(date, 1) : '';
    },

    get boardCopyBriefReady() {
      return this.currentBoardHour() >= COPY_TO_BRIEF_HOUR;
    },

    boardCopyBriefLabel(item: BoardItem) {
      const date = this.boardCopyBriefDate(item);
      if (!date) return '';
      const [, month, day] = date.split('-').map(Number);
      return `Copy to ${month}/${day} Brief`;
    },

    copyToNextBoardBrief(item: BoardItem) {
      const date = this.boardCopyBriefDate(item);
      if (date) this.askCopyBoardItem(item, 'brief:' + date);
    },

    takeBoardTask(item: BoardItem) {
      return this.updateBoardItem(item, { assignee: this.user.name });
    },

    toggleBoardDone(item: BoardItem) {
      return this.updateBoardItem(item, { done: !item.doneAt });
    },

    toggleBoardExpanded(item: BoardItem) {
      if (this.boardExpandedId === item.id) {
        this.boardExpandedId = null;
        return;
      }
      this.boardExpandedId = item.id;
      this.boardEdit = {
        current: this.boardLocation(item),
        moveTo: '',
        section: item.section,
        assignee: item.assignee || '',
        dueDate: item.dueDate || '',
        dueHour: item.dueHour == null ? '' : String(item.dueHour),
      };
    },

    isBoardExpanded(item: BoardItem) {
      return this.boardExpandedId === item.id;
    },

    async saveBoardEdit(item: BoardItem) {
      const edit = this.boardEdit;
      const data: BoardItemInput = {};
      if (edit.section !== item.section) data.section = edit.section;
      // Assignee and due date only apply in Tasks; elsewhere the fields are hidden and the stored values are kept
      if (this.boardEditLocation === 'tasks') {
        data.assignee = edit.assignee.trim() || null;
        // A blank date on an item that never had one is left alone, so the server can default a new task to today
        if (edit.dueDate || item.dueDate) {
          data.dueDate = edit.dueDate || null;
          data.dueHour = edit.dueDate && edit.dueHour ? Number(edit.dueHour) : null;
        }
      }
      if (edit.moveTo) Object.assign(data, this.boardLocationChanges(edit.moveTo));
      if (await this.updateBoardItem(item, data)) this.boardExpandedId = null;
    },

    cancelBoardEdit() {
      this.boardExpandedId = null;
    },

    // Copying makes a new item and leaves the original alone; it always asks first, in a modal
    askCopyBoardItem(item: BoardItem, to: string) {
      this.boardAssigneeOpen = '';
      this.boardCopy = { itemId: item.id, description: item.description, to, assignee: '', dueDate: '', dueHour: '' };
      this.boardCopyOpen = true;
    },

    // The edit panel's "Copy to" dropdown: open the modal, then reset the dropdown for next time
    askCopyFromPanel(item: BoardItem, event: Event) {
      const select = event.target as HTMLSelectElement;
      const to = select.value;
      select.value = '';
      if (to) this.askCopyBoardItem(item, to);
    },

    cancelBoardCopy() {
      this.boardCopyOpen = false;
      this.boardAssigneeOpen = '';
    },

    get boardCopyTitle() {
      return 'Copy to ' + boardTargetLabel(this.boardCopy.to);
    },

    get boardCopyIsTask() {
      return this.boardCopy.to === 'tasks';
    },

    async confirmBoardCopy() {
      const copy = { ...this.boardCopy };
      const [kind, date] = copy.to.split(':');
      const data: Parameters<typeof api.copyBoardItem>[1] = copy.to === 'tasks'
        ? { to: 'tasks' }
        : { to: kind as 'brief' | 'debrief', date };
      if (copy.to === 'tasks') {
        if (copy.assignee.trim()) data.assignee = copy.assignee.trim();
        if (copy.dueDate) {
          data.dueDate = copy.dueDate;
          if (copy.dueHour) data.dueHour = Number(copy.dueHour);
        }
      }
      this.boardCopyOpen = false;
      try {
        this.boardError = null;
        await api.copyBoardItem(copy.itemId, data);
        await this.loadBoard();
        this.showBoardToast('Copied to ' + boardTargetLabel(copy.to));
      } catch (err: any) {
        this.boardError = err.message || 'Could not copy that';
      }
    },

    showBoardToast(text: string, ms = 2500) {
      this.boardToast = text;
      setTimeout(() => {
        if (this.boardToast === text) this.boardToast = '';
      }, ms);
    },

    // Deleting asks first, in a modal rather than a browser alert
    askDeleteBoardItem(item: BoardItem) {
      this.boardDelete = { kind: 'item', id: item.id, label: item.description };
    },

    askDeleteBoardPhoto(photoId: string) {
      this.boardDelete = { kind: 'photo', id: photoId, label: '' };
    },

    // Admin-only: archive one item now and write it to the sheet, to check the Google Drive connection
    askArchiveBoardItem(item: BoardItem) {
      this.boardDelete = { kind: 'archive', id: item.id, label: item.description };
    },

    cancelBoardDelete() {
      this.boardDelete = null;
    },

    get boardDeleteTitle() {
      const kind = this.boardDelete?.kind;
      return kind === 'photo' ? 'Delete this photo?' : kind === 'archive' ? 'Archive this item now?' : 'Delete this item?';
    },

    get boardDeleteNote() {
      return this.boardDelete?.kind === 'archive'
        ? 'It leaves the board and is written to the Google Sheet, if one is connected.'
        : "This can't be undone.";
    },

    get boardDeleteConfirmLabel() {
      return this.boardDelete?.kind === 'archive' ? 'Archive' : 'Delete';
    },

    async confirmBoardDelete() {
      const target = this.boardDelete;
      if (!target) return;
      this.boardDelete = null;
      try {
        this.boardError = null;
        if (target.kind === 'archive') {
          const result = await api.archiveBoardItem(target.id);
          await this.loadBoard();
          if (result.written) {
            this.showBoardToast('Archived and written to the Google Sheet');
          } else if (result.sheets) {
            this.showBoardToast(`Archived, but the Google Sheet write failed: ${(result.error || 'unknown error').slice(0, 160)}`, 10000);
          } else {
            this.showBoardToast("Archived. Google Sheets isn't enabled here, so nothing was written.", 6000);
          }
        } else if (target.kind === 'item') {
          await api.deleteBoardItem(target.id);
          this.boardItems = this.boardItems.filter(existing => existing.id !== target.id);
        } else {
          await api.deleteBoardPhoto(target.id);
          await this.loadBoard();
        }
      } catch (err: any) {
        this.boardError = err.message || 'Could not delete that';
      }
    },

    pickBoardPhoto(item: BoardItem) {
      this.boardPhotoTargetId = item.id;
      document.getElementById('board-card-photo')?.click();
    },

    async uploadBoardCardPhoto(event: Event) {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = '';
      const itemId = this.boardPhotoTargetId;
      if (!file || !itemId) return;
      try {
        this.boardError = null;
        await api.uploadBoardPhoto(itemId, await resizeImageToJpeg(file));
        await this.loadBoard();
      } catch (err: any) {
        this.boardError = err.message || 'Could not upload that photo';
      }
    },

    // Board display helpers
    canDeleteBoardItem(item: BoardItem) {
      return item.authorId === this.user.id || !!this.user.isAdmin;
    },

    // Past its due day, or today and past its due hour (end of day never goes overdue until tomorrow)
    isBoardOverdue(item: BoardItem) {
      if (!item.isTask || item.doneAt || !item.dueDate) return false;
      if (item.dueDate !== this.boardToday) return item.dueDate < this.boardToday;
      if (item.dueHour == null) return false;
      return this.currentBoardHour() >= item.dueHour;
    },

    // Hour of the day (0-23) in the configured timezone
    currentBoardHour() {
      return parseInt(new Date(this.boardNow).toLocaleTimeString('en-US', {
        hour: '2-digit', hour12: false, timeZone: this.timezone,
      }), 10) % 24;
    },

    formatBoardDate(date: string) {
      const [year, month, day] = date.split('-').map(Number);
      return new Date(year, month - 1, day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    },

    boardDueLabel(item: BoardItem) {
      if (!item.dueDate) return '';
      const day = item.dueDate === this.boardToday ? 'today' : this.formatBoardDate(item.dueDate);
      const time = item.dueHour == null ? '' : ' ' + formatBoardHour(item.dueHour);
      return (this.isBoardOverdue(item) ? 'Overdue · ' : 'Due ') + day + time;
    },

    boardItemMeta(item: BoardItem) {
      const created = new Date(item.createdAt * 1000);
      let text = item.authorName + ' · ' + created.toLocaleTimeString([], {
        hour: 'numeric', minute: '2-digit', timeZone: this.timezone,
      });
      const day = created.toLocaleDateString('en-CA', { timeZone: this.timezone });
      if (day !== this.boardToday) text += ' · ' + this.formatBoardDate(day);
      return text;
    },

    // Photos open in an overlay on the board (not a new browser tab, which is a pain to close on a phone)
    openBoardPhoto(photoId: string) {
      this.boardPhotoView = photoId;
    },

    closeBoardPhoto() {
      this.boardPhotoView = '';
    },

    boardPhotoUrl(photoId: string) {
      return '/api/board/photos/' + photoId;
    },

    // Socket
    handleNewCheck(data: any) {
      // Deduplicate: only reload if we don't have these checks already
      if (data.checks && Array.isArray(data.checks)) {
        const hasNewCheck = data.checks.some((newCheck: any) =>
          !this.checks.some(existingCheck => existingCheck.id === newCheck.id)
        );
        if (hasNewCheck) {
          this.lastUpdated = new Date(); // Update last refresh time
          this.loadData(); // Reload data to get fresh checks
        }
      } else {
        this.lastUpdated = new Date(); // Update last refresh time
        this.loadData();
      }
    },

    handleSocketReconnect() {
      // On socket reconnect, refresh all data to catch any missed updates
      console.log('Socket reconnected, refreshing data...');
      this.loadData();
    },

    setupVisibilityListener() {
      // Refresh data when user returns to the tab
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.user) {
          console.log('Tab became visible, refreshing data...');
          this.loadData();
        }
      });
    },

    // Helpers
    showMessage(type: 'success' | 'error' | 'warning', text: string) {
      this.message = { type, text };
      setTimeout(() => {
        this.message = null;
      }, 3000);
    },

    toggleSection(section: string) {
      if (this.expandedSections.has(section)) {
        this.expandedSections.delete(section);
        this.searchExpandedSections.delete(section);
      } else {
        this.expandedSections.add(section);
        if (this.searchExpandedSections.has(section)) {
          this.searchExpandedSections.delete(section);
        }
      }

      if (!this.runSearchQuery.trim()) {
        localStorage.setItem('expandedSections', JSON.stringify(Array.from(this.expandedSections)));
      }
    },

    isSectionExpanded(section: string) {
      return this.expandedSections.has(section);
    },

    handleRunSearch() {
      const query = this.runSearchQuery.toLowerCase().trim();

      if (!query) {
        // Clear search - collapse auto-expanded sections
        for (const section of this.searchExpandedSections) {
          if (this.expandedSections.has(section)) {
            this.expandedSections.delete(section);
          }
        }
        this.searchExpandedSections.clear();
        return;
      }

      // Auto-expand sections with matches
      const sectionsWithMatches = new Set<string>(
        this.filteredGroupedRuns.map(([section, _]) => section)
      );

      for (const section of sectionsWithMatches) {
        if (!this.expandedSections.has(section)) {
          this.expandedSections.add(section);
          this.searchExpandedSections.add(section);
        }
      }

      // Collapse sections that no longer match
      for (const section of this.searchExpandedSections) {
        if (!sectionsWithMatches.has(section)) {
          this.expandedSections.delete(section);
          this.searchExpandedSections.delete(section);
        }
      }
    },

    formatTimeSince,
  };
}
