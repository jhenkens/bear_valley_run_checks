import './styles/main.css';
import { createApp } from './app';

// Define Alpine component
document.addEventListener('alpine:init', () => {
  (window as any).Alpine.data('app', createApp);
});

// Render app
const appRoot = document.getElementById('app');
if (appRoot) {
  appRoot.innerHTML = `
    <div x-data="app" x-init="init">
      <!-- Loading -->
      <div x-show="loading" class="loading">
        <p>Loading...</p>
      </div>

      <!-- Login -->
      <div x-show="!loading && !user" class="login-container">
        <h2>Bear Valley Run Checks</h2>

        <!-- DEV Mode Login -->
        <div x-show="isDev" style="margin-bottom: 1rem; padding: 1rem; background: #fff3cd; border-radius: 4px; border: 1px solid #ffc107;">
          <strong>⚡ DEV MODE</strong>
          <p style="margin: 0.5rem 0; font-size: 0.9rem;">Direct login enabled - no email required</p>
        </div>

        <div class="form-group">
          <label>Email</label>
          <input type="email" x-model="loginEmail" @keyup.enter="isDev ? devLogin() : login()" placeholder="your@email.com">
        </div>

        <button x-show="isDev" class="btn" @click="devLogin" :disabled="!loginEmail" style="background: #28a745;">
          Login (DEV - No Email)
        </button>

        <button x-show="!isDev" class="btn" @click="login" :disabled="!loginEmail">
          Send Login Link
        </button>

        <div x-show="loginMessage" class="message success" x-text="loginMessage" style="margin-top: 1rem;"></div>
        <div x-show="error" class="message error" x-text="error" style="margin-top: 1rem;"></div>
      </div>

      <!-- Main App -->
      <div x-show="!loading && user">
        <!-- Header -->
        <div class="header">
          <h1>Bear Valley Run Checks</h1>
          <button @click="logout">Logout</button>
        </div>

        <!-- Message -->
        <div x-show="message" :class="'message ' + (message?.type || '')" x-text="message?.text" style="margin: 1rem;"></div>

        <!-- Tabs -->
        <div class="tabs" x-show="!showConfirm">
          <button class="tab" :class="currentTab === 'runs' && 'active'" @click="switchTab('runs')">Runs</button>
          <button class="tab" :class="currentTab === 'history' && 'active'" @click="switchTab('history')">History</button>
          <button class="tab" :class="currentTab === 'patrollers' && 'active'" @click="switchTab('patrollers')">Patrollers</button>
          <button class="tab" :class="currentTab === 'admin' && 'active'" @click="switchTab('admin')" x-show="user?.isAdmin">Admin</button>
        </div>

        <!-- Runs Tab -->
        <div class="content" x-show="currentTab === 'runs' && !showConfirm">
          <template x-for="[section, runs] in groupedRuns" :key="section">
            <div class="section-runs">
              <div class="section-header">
                <h3 x-text="section"></h3>
              </div>
              <template x-for="run in runs" :key="run.name">
                <div class="run-item" :class="isInCart(run) && 'selected'" @click="toggleRunInCart(run)">
                  <div class="run-info">
                    <div class="run-name" x-text="run.name"></div>
                    <div class="run-time" x-text="formatTimeSince(run.minutesSinceCheck)"></div>
                  </div>
                  <div class="run-indicator" :class="run.color"></div>
                </div>
              </template>
            </div>
          </template>
        </div>

        <!-- Confirm Page -->
        <div class="content" x-show="showConfirm">
          <div class="confirm-container">
            <div class="confirm-list">
              <h3>Selected Runs (<span x-text="cart.length"></span>)</h3>
              <ul>
                <template x-for="run in cart" :key="run.name">
                  <li x-text="run.name + ' (' + run.section + ')'"></li>
                </template>
              </ul>
            </div>

            <div class="confirm-list">
              <div class="form-group autocomplete">
                <label>Patroller</label>
                <input type="text" x-model="patrollerSearch" @input="filterPatrollers" @focus="showAutocomplete = patrollerSearch.length > 0" placeholder="Search patroller...">
                <div class="autocomplete-dropdown" x-show="showAutocomplete">
                  <template x-for="p in filteredPatrollers" :key="p">
                    <div class="autocomplete-item" @click="selectPatroller(p)" x-text="p"></div>
                  </template>
                </div>
              </div>

              <div class="form-group">
                <label>Check Time</label>
                <input type="datetime-local" x-model="confirmTime">
              </div>

              <button class="btn btn-success" @click="submitChecks">Submit</button>
              <button class="btn" @click="clearCart" style="margin-top: 0.5rem;">Cancel</button>

              <div x-show="error" class="message error" x-text="error" style="margin-top: 1rem;"></div>
            </div>
          </div>
        </div>

        <!-- History Tab -->
        <div class="content" x-show="currentTab === 'history'">
          <template x-for="[section, sectionChecks] in groupedChecks" :key="section">
            <div class="history-section">
              <h3 x-text="section"></h3>
              <template x-for="check in sectionChecks" :key="check.id">
                <div class="history-item">
                  <div class="history-run" x-text="check.runName"></div>
                  <div class="history-details" x-text="new Date(check.checkTime).toLocaleTimeString() + ' - ' + check.patroller"></div>
                </div>
              </template>
            </div>
          </template>
          <div x-show="checks.length === 0" class="message">No checks today</div>
        </div>

        <!-- Patrollers Tab -->
        <div class="content" x-show="currentTab === 'patrollers'">
          <template x-for="[patroller, patrollerChecks] in checksByPatroller" :key="patroller">
            <div class="history-section">
              <h3 x-text="patroller"></h3>
              <template x-for="check in patrollerChecks" :key="check.id">
                <div class="history-item">
                  <div class="history-run" x-text="check.runName + ' (' + check.section + ')'"></div>
                  <div class="history-details" x-text="new Date(check.checkTime).toLocaleTimeString()"></div>
                </div>
              </template>
            </div>
          </template>
          <div x-show="checks.length === 0" class="message">No checks today</div>
        </div>

        <!-- Admin Tab -->
        <div class="content" x-show="currentTab === 'admin'">
          <div class="confirm-list">
            <h3>Add User</h3>
            <div class="form-group">
              <label>Email</label>
              <input type="email" x-model="newUserEmail" placeholder="user@example.com">
            </div>
            <div class="form-group">
              <label>Name</label>
              <input type="text" x-model="newUserName" placeholder="John Doe">
            </div>
            <button class="btn" @click="createUser">Create User</button>
          </div>

          <div class="user-table">
            <template x-for="user in users" :key="user.id">
              <div class="user-row">
                <div class="user-info">
                  <div class="user-name">
                    <span x-text="user.name"></span>
                    <span x-show="user.isSuperuser" class="user-badge">SUPERUSER</span>
                  </div>
                  <div class="user-email" x-text="user.email"></div>
                </div>
                <div class="user-actions">
                  <label>
                    <input type="checkbox" :checked="user.isAdmin" @change="toggleAdmin(user)" :disabled="user.isSuperuser">
                    Admin
                  </label>
                  <button class="btn-danger" @click="deleteUser(user)" :disabled="user.isSuperuser">Delete</button>
                </div>
              </div>
            </template>
          </div>

          <div x-show="error" class="message error" x-text="error" style="margin-top: 1rem;"></div>
        </div>

        <!-- Cart Banner -->
        <div class="cart-banner" x-show="cart.length > 0 && !showConfirm">
          <div class="cart-count" x-text="cart.length + ' run' + (cart.length !== 1 ? 's' : '') + ' selected'"></div>
          <button class="btn" @click="openConfirm">Continue</button>
        </div>
      </div>
    </div>
  `;
}
