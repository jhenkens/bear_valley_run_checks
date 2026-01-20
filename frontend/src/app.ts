import { api, ApiError } from './services/api';
import { connectSocket } from './services/socket';
import { calculateRunColors, groupRunsBySection, formatTimeSince, RunWithColor } from './utils/colorLogic';

export function createApp() {
  return {
    // State
    isDev: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1',
    loading: true,
    error: null as string | null,
    user: null as any,
    currentTab: 'runs' as 'runs' | 'history' | 'patrollers' | 'admin',
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
    filteredPatrollers: [] as string[],
    showAutocomplete: false,
    users: [] as any[],
    newUserEmail: '',
    newUserName: '',
    message: null as { type: 'success' | 'error' | 'warning'; text: string } | null,
    expandedSections: new Set<string>(),
    timezone: 'UTC' as string,
    googleOAuthStatus: null as any,
    googleDriveWasDisconnected: false, // Track if we showed a disconnection warning
    _initialized: false, // Guard against double initialization

    // Computed
    get groupedRuns() {
      const runsWithColors = calculateRunColors(this.runs, this.checks);
      const grouped = groupRunsBySection(runsWithColors);
      return Array.from(grouped.entries());
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

    get checksByPatroller() {
      const grouped = new Map<string, any[]>();
      for (const check of this.checks) {
        if (!grouped.has(check.patroller)) {
          grouped.set(check.patroller, []);
        }
        grouped.get(check.patroller)!.push(check);
      }
      return Array.from(grouped.entries());
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
        await this.checkAuth();
        if (this.user) {
          await this.loadData();
          connectSocket(this.handleNewCheck.bind(this));
        }
      } catch (err: any) {
        console.error('Init error:', err);
      } finally {
        this.loading = false;
      }
    },

    async checkAuth() {
      try {
        const { user } = await api.getMe();
        this.user = user;
      } catch (err: any) {
        if (err.status !== 401) {
          console.error('Auth check error:', err);
        }
        this.user = null;
      }
    },

    async loadData() {
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
        this.filteredPatrollers = statusRes.patrollers;

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

    // Tabs
    switchTab(tab: typeof this.currentTab) {
      this.currentTab = tab;
      this.showConfirm = false;
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
      const search = this.patrollerSearch.toLowerCase();
      this.filteredPatrollers = this.patrollers.filter(p =>
        p.toLowerCase().includes(search)
      );
      this.showAutocomplete = this.patrollerSearch.length > 0;
    },

    selectPatroller(patroller: string) {
      this.confirmPatroller = patroller;
      this.patrollerSearch = patroller;
      this.showAutocomplete = false;
    },

    // Admin
    async createUser() {
      try {
        this.error = null;

        if (!this.newUserEmail || !this.newUserName) {
          this.error = 'Email and name are required';
          return;
        }

        await api.createUser(this.newUserEmail, this.newUserName);
        this.showMessage('success', 'User created and welcome email sent');
        this.newUserEmail = '';
        this.newUserName = '';
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to create user';
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
        this.showMessage('success', 'Google connection refreshed');
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to refresh token';
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
    handleNewCheck(data: any) {
      this.loadData(); // Reload data to get fresh checks
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
      } else {
        this.expandedSections.add(section);
      }
      // Save to localStorage
      localStorage.setItem('expandedSections', JSON.stringify(Array.from(this.expandedSections)));
    },

    isSectionExpanded(section: string) {
      return this.expandedSections.has(section);
    },

    formatTimeSince,
  };
}
