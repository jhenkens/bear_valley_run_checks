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
    cart: [] as any[],
    loginEmail: '',
    loginMessage: '',
    showConfirm: false,
    confirmPatroller: '',
    confirmTime: '',
    patrollerSearch: '',
    filteredPatrollers: [] as string[],
    showAutocomplete: false,
    users: [] as any[],
    newUserEmail: '',
    newUserName: '',
    message: null as { type: 'success' | 'error'; text: string } | null,

    // Computed
    get groupedRuns() {
      const runsWithColors = calculateRunColors(this.runs, this.checks);
      return groupRunsBySection(runsWithColors);
    },

    get groupedChecks() {
      const grouped = new Map<string, any[]>();
      for (const check of this.checks) {
        if (!grouped.has(check.section)) {
          grouped.set(check.section, []);
        }
        grouped.get(check.section)!.push(check);
      }
      return grouped;
    },

    get checksByPatroller() {
      const grouped = new Map<string, any[]>();
      for (const check of this.checks) {
        if (!grouped.has(check.patroller)) {
          grouped.set(check.patroller, []);
        }
        grouped.get(check.patroller)!.push(check);
      }
      return grouped;
    },

    // Init
    async init() {
      try {
        this.loading = true;
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
        const [runsRes, checksRes, patrollersRes] = await Promise.all([
          api.getRuns(),
          api.getTodayChecks(),
          api.getPatrollers(),
        ]);

        this.runs = runsRes.runs;
        this.checks = checksRes.checks.map((c: any) => ({
          ...c,
          checkTime: new Date(c.checkTime),
          createdAt: new Date(c.createdAt),
        }));
        this.patrollers = patrollersRes.patrollers;
        this.filteredPatrollers = patrollersRes.patrollers;

        if (this.user.isAdmin) {
          const usersRes = await api.getUsers();
          this.users = usersRes.users;
        }
      } catch (err: any) {
        this.error = err.message || 'Failed to load data';
      }
    },

    // Auth
    async devLogin() {
      try {
        this.error = null;
        this.loginMessage = '';
        await api.devLogin(this.loginEmail);
        // Reload to get authenticated session
        window.location.reload();
      } catch (err: any) {
        this.error = err.message || 'Login failed';
      }
    },

    async login() {
      try {
        this.error = null;
        this.loginMessage = '';
        await api.login(this.loginEmail);
        this.loginMessage = 'Check your email for the login link!';
        this.loginEmail = '';
      } catch (err: any) {
        this.error = err.message || 'Login failed';
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
      this.confirmPatroller = '';
      this.confirmTime = new Date().toISOString().slice(0, 16);
      this.patrollerSearch = '';
      this.showAutocomplete = false;
    },

    async submitChecks() {
      try {
        this.error = null;

        if (!this.confirmPatroller) {
          this.error = 'Please select a patroller';
          return;
        }

        if (!this.confirmTime) {
          this.error = 'Please select a time';
          return;
        }

        const checks = this.cart.map(run => ({
          runName: run.name,
          section: run.section,
          patroller: this.confirmPatroller,
          checkTime: new Date(this.confirmTime).toISOString(),
        }));

        await api.submitChecks(checks);

        this.showMessage('success', `Submitted ${checks.length} run check(s)`);
        this.clearCart();
        await this.loadData();
      } catch (err: any) {
        this.error = err.message || 'Failed to submit checks';
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

    // Socket
    handleNewCheck(data: any) {
      console.log('New check received via socket:', data);
      this.loadData(); // Reload data to get fresh checks
    },

    // Helpers
    showMessage(type: 'success' | 'error', text: string) {
      this.message = { type, text };
      setTimeout(() => {
        this.message = null;
      }, 3000);
    },

    formatTimeSince,
  };
}
