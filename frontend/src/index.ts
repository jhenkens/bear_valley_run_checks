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
          <input type="email" x-model="loginEmail" @keyup.enter="isDev ? devLogin() : login()" placeholder="your@email.com" autocomplete="username">
        </div>

        <button x-show="isDev" class="btn" @click="devLogin" :disabled="!loginEmail || isLoggingIn" style="background: #28a745;">
          <span x-text="isLoggingIn ? 'Logging in...' : 'Login (DEV - No Email)'"></span>
        </button>

        <button x-show="!isDev" class="btn" @click="login" :disabled="!loginEmail || isLoggingIn">
          <span x-text="isLoggingIn ? 'Sending...' : 'Send Login Link'"></span>
        </button>

        <div x-show="oidcProvider" style="margin-top: 1.5rem; text-align: center;">
          <div style="color: #666; font-size: 0.9em; margin-bottom: 0.75rem;">or</div>
          <button class="btn" @click="loginWithOidc" style="background: #6c757d;">
            <span x-text="'Sign in with ' + (oidcProvider?.name || '')"></span>
          </button>
        </div>

        <div x-show="loginMessage" class="message success" x-text="loginMessage" style="margin-top: 1rem;"></div>
        <div x-show="error" class="message error" x-text="error" style="margin-top: 1rem;"></div>
      </div>

      <!-- Main App -->
      <div x-show="!loading && user">
        <!-- Header -->
        <div class="header">
          <div>
            <h1>Bear Valley Run Checks</h1>
            <div x-show="lastUpdated" style="font-size: 0.75em; color: #e0e0e0; margin-top: 0.25rem;">
              Last updated: <span x-text="lastUpdated ? lastUpdated.toLocaleTimeString() : ''"></span>
            </div>
          </div>
          <button @click="logout">Logout</button>
        </div>

        <!-- System Notifications -->
        <template x-for="notification in notifications" :key="notification.message">
          <div :class="'notification notification-' + notification.type" x-text="notification.message"></div>
        </template>

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
          <!-- Search Input -->
          <div class="search-container">
            <div class="search-input-wrapper">
              <input
                type="text"
                x-model="runSearchQuery"
                @input="handleRunSearch"
                placeholder="Search runs by name..."
                class="search-input"
              >
              <button
                x-show="runSearchQuery"
                @click="runSearchQuery = ''; handleRunSearch()"
                class="search-clear"
                aria-label="Clear search"
              >
                ✕
              </button>
            </div>
            <div x-show="runSearchQuery && totalMatchCount > 0" class="search-results">
              <span x-text="totalMatchCount + ' match' + (totalMatchCount !== 1 ? 'es' : '')"></span>
            </div>
            <div x-show="runSearchQuery && totalMatchCount === 0" class="search-no-results">
              No runs found
            </div>
          </div>

          <template x-for="[section, runs] in filteredGroupedRuns" :key="section">
            <div class="section-runs">
              <div class="section-header" @click="toggleSection(section)" style="cursor: pointer; user-select: none;">
                <h3>
                  <span x-text="isSectionExpanded(section) ? '▼' : '▶'" style="display: inline-block; width: 1.2em;"></span>
                  <span x-text="section"></span>
                  <span style="font-size: 0.85em; font-weight: normal; margin-left: 0.5rem; color: #666;" x-text="'(' + runs.length + ')'"></span>
                </h3>
              </div>
              <div x-show="isSectionExpanded(section)">
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
                <div class="input-with-clear">
                  <input type="text" x-model="patrollerSearch" @input="filterPatrollers" @focus="showAutocomplete = patrollerSearch.length > 0" placeholder="Search patroller...">
                  <button type="button" class="clear-btn" x-show="patrollerSearch.length > 0" @click="clearPatroller">&times;</button>
                </div>
                <div class="autocomplete-dropdown" x-show="showAutocomplete">
                  <template x-for="p in filteredPatrollers" :key="p">
                    <div class="autocomplete-item" @click="selectPatroller(p)" x-text="p"></div>
                  </template>
                </div>
              </div>

              <div class="form-group">
                <label>Check Time</label>
                <input type="time" x-model="confirmTime">
                <small style="color: #666; font-size: 0.85em; display: block; margin-top: 0.25rem;" x-text="'Today, Timezone: ' + timezone"></small>
              </div>

              <button class="btn btn-success" @click="submitChecks" :disabled="isSubmitting">
                <span x-text="isSubmitting ? 'Submitting...' : 'Submit'"></span>
              </button>
              <button class="btn" @click="clearCart" style="margin-top: 0.5rem;" :disabled="isSubmitting">Cancel</button>

              <div x-show="error" class="message error" x-text="error" style="margin-top: 1rem;"></div>
            </div>
          </div>
        </div>

        <!-- History Tab -->
        <div class="content" x-show="currentTab === 'history'">
          <template x-for="[section, runs] in historyBySection" :key="section">
            <div class="section-runs">
              <div class="section-header" @click="toggleSection('history-' + section)" style="cursor: pointer; user-select: none;">
                <h3>
                  <span x-text="isSectionExpanded('history-' + section) ? '▼' : '▶'" style="display: inline-block; width: 1.2em;"></span>
                  <span x-text="section"></span>
                  <span style="font-size: 0.85em; font-weight: normal; margin-left: 0.5rem; color: #666;" x-text="'(' + runs.length + ')'"></span>
                </h3>
              </div>
              <div x-show="isSectionExpanded('history-' + section)">
                <template x-for="run in runs" :key="run.runName">
                  <div>
                    <div class="run-item">
                      <div class="run-info">
                        <div class="run-name" x-text="run.runName"></div>
                        <div x-show="run.checks.length === 0" class="run-time" style="color: #999; font-style: italic;">No checks</div>
                        <template x-for="check in run.checks" :key="check.id">
                        <div class="run-time" x-text="new Date(check.checkTime).toLocaleTimeString() + ' - ' + check.patroller"></div>
                        </template>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </template>
        </div>

        <!-- Patrollers Tab -->
        <div class="content" x-show="currentTab === 'patrollers'">
          <template x-for="[patroller, patrollerChecks] in checksByPatroller" :key="patroller">
            <div class="history-section">
              <div class="section-header" @click="toggleSection('patroller-' + patroller)" style="cursor: pointer; user-select: none;">
                <h3>
                  <span x-text="isSectionExpanded('patroller-' + patroller) ? '▼' : '▶'" style="display: inline-block; width: 1.2em;"></span>
                  <span x-text="patroller"></span>
                  <span style="font-size: 0.85em; font-weight: normal; margin-left: 0.5rem; color: #666;" x-text="'(' + patrollerChecks.length + ')'"></span>
                </h3>
              </div>
              <div x-show="isSectionExpanded('patroller-' + patroller)">
                <template x-for="check in patrollerChecks" :key="check.id">
                  <div class="history-item">
                    <div class="history-run" x-text="check.runName + ' (' + check.section + ')'"></div>
                    <div class="history-details" x-text="new Date(check.checkTime).toLocaleTimeString()"></div>
                  </div>
                </template>
              </div>
            </div>
          </template>
          <div x-show="checks.length === 0" class="message">No checks today</div>
        </div>

        <!-- Admin Tab -->
        <template x-if="currentTab === 'admin' && user?.isAdmin">
        <div class="content">
          <!-- Google Drive OAuth Section (Superuser only) -->
          <div class="confirm-list" style="margin-bottom: 2rem;" x-show="user?.isSuperuser">
            <h3>Google Drive Connection</h3>
            
            <template x-if="!googleOAuthStatus?.configured">
              <div>
                <p>Link your Google Drive account to store daily run check spreadsheets.</p>
                <button class="btn" @click="linkGoogleDrive">Link Google Drive</button>
              </div>
            </template>

            <template x-if="googleOAuthStatus?.configured">
              <div>
                <div class="oauth-status">
                  <div class="oauth-info">
                    <div><strong>Status:</strong>
                      <span x-show="googleOAuthStatus.isActive" style="color: green;">✅ Connected</span>
                      <span x-show="!googleOAuthStatus.isActive" style="color: orange;">⚠️ Disconnected</span>
                    </div>
                    <div><strong>Linked by:</strong> <span x-text="googleOAuthStatus.linkedUser?.email"></span></div>
                    <div><strong>Google Account:</strong> <span x-text="googleOAuthStatus.googleEmail"></span></div>
                    <div x-show="googleOAuthStatus.folderId"><strong>Folder:</strong> <span x-text="googleOAuthStatus.folderId"></span></div>
                  </div>

                  <div x-show="!googleOAuthStatus.isActive" class="oauth-warning" style="margin-top: 0.5rem;">
                    ⚠️ Connection is inactive. The backend will attempt to reconnect automatically. You can manually refresh below.
                  </div>
                </div>

                <div class="oauth-actions" style="margin-top: 1rem; display: flex; gap: 0.5rem; flex-wrap: wrap;">
                  <button class="btn" @click="refreshGoogleToken">Refresh Connection & Reload Runs</button>
                  <button class="btn-danger" @click="disconnectGoogle">Disconnect</button>
                  <button class="btn" style="background: #9e9e9e;" @click="testMarkInactive" x-show="user?.isSuperuser">🧪 Test: Force Inactive</button>
                </div>
              </div>
            </template>
          </div>

          <div class="confirm-list">
            <h3>Add User</h3>
            <div class="form-group">
              <label>Name</label>
              <input type="text" x-model="newUserName" placeholder="John Doe">
            </div>
            <div class="form-group">
              <label>Email <span style="font-weight: normal; color: #999;">(optional)</span></label>
              <input type="email" x-model="newUserEmail" placeholder="user@example.com">
            </div>
            <button class="btn" @click="createUser">Create User</button>
          </div>

          <div class="confirm-list">
            <h3>Bulk Add Users</h3>
            <div class="form-group">
              <label>Paste CSV, one user per line: <code>Name, email</code> (email optional)</label>
              <textarea x-model="bulkText" rows="6" placeholder="Jane Doe, jane@example.com&#10;John Smith, john@example.com"></textarea>
            </div>
            <button class="btn" @click="bulkCreateUsers" :disabled="!bulkText.trim()">Upload Users</button>
          </div>

          <div style="display: flex; justify-content: flex-end; margin-bottom: 0.5rem;">
            <button class="btn" @click="sendWelcomeEmails" :disabled="welcomeSelectedIds.length === 0"
              x-text="'Send Welcome Emails (' + welcomeSelectedIds.length + ')'"></button>
          </div>

          <div class="user-table">
            <table>
              <thead>
                <tr>
                  <th class="sortable" @click="sortUsersBy('name')">Name <span x-text="sortIndicator('name')"></span></th>
                  <th class="sortable" @click="sortUsersBy('email')">Email <span x-text="sortIndicator('email')"></span></th>
                  <th class="sortable" @click="sortUsersBy('createdAt')">Date Added <span x-text="sortIndicator('createdAt')"></span></th>
                  <th>Admin</th>
                  <th>
                    <label title="Select all / none">
                      <input type="checkbox" :checked="allWelcomeSelected" @change="toggleAllWelcome()"
                        :disabled="welcomeEligibleUsers.length === 0">
                      Send welcome
                    </label>
                  </th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <template x-for="u in sortedUsers" :key="u.id">
                  <tr>
                    <td>
                      <template x-if="editingUserId === u.id">
                        <input type="text" x-model="editName" placeholder="Name" @keyup.enter="saveUser" @keyup.escape="cancelEdit">
                      </template>
                      <template x-if="editingUserId !== u.id">
                        <span>
                          <span x-text="u.name" :class="{ 'dup-warning': isDuplicateName(u) }"></span>
                          <span x-show="u.isSuperuser" class="user-badge">SUPERUSER</span>
                          <span x-show="isDuplicateName(u)" class="dup-warning">⚠ Duplicate name</span>
                        </span>
                      </template>
                    </td>
                    <td class="user-email" :class="{ 'dup-warning': editingUserId !== u.id && isDuplicateEmail(u) }">
                      <template x-if="editingUserId === u.id">
                        <input type="email" x-model="editEmail" placeholder="Email (optional)" @keyup.enter="saveUser" @keyup.escape="cancelEdit">
                      </template>
                      <template x-if="editingUserId !== u.id">
                        <span>
                          <span x-text="u.email || '(no email)'"></span>
                          <span x-show="isDuplicateEmail(u)">⚠ Duplicate email</span>
                        </span>
                      </template>
                    </td>
                    <td x-text="formatUserDate(u.createdAt)"></td>
                    <td>
                      <input type="checkbox" :checked="u.isAdmin" @change="toggleAdmin(u)" :disabled="u.isSuperuser">
                    </td>
                    <td>
                      <input type="checkbox" x-model="welcomeSelected[u.id]" :disabled="!u.email">
                    </td>
                    <td class="user-actions">
                      <template x-if="editingUserId === u.id">
                        <span>
                          <button class="btn" @click="saveUser" style="font-size: 0.85rem; padding: 0.25rem 0.5rem;">Save</button>
                          <button class="btn" @click="cancelEdit" style="font-size: 0.85rem; padding: 0.25rem 0.5rem; background: #6c757d;">Cancel</button>
                        </span>
                      </template>
                      <template x-if="editingUserId !== u.id">
                        <span>
                          <button class="btn" @click="editUser(u)" :disabled="u.isSuperuser" style="font-size: 0.85rem; padding: 0.25rem 0.5rem;">Edit</button>
                          <button class="btn-danger" @click="deleteUser(u)" :disabled="u.isSuperuser">Delete</button>
                        </span>
                      </template>
                    </td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>

          <div x-show="error" class="message error" x-text="error" style="margin-top: 1rem;"></div>
        </div>
        </template>

        <!-- Cart Banner -->
        <div class="cart-banner" x-show="cart.length > 0 && !showConfirm">
          <div class="cart-count" x-text="cart.length + ' run' + (cart.length !== 1 ? 's' : '') + ' selected'"></div>
          <div class="cart-actions">
            <button class="btn btn-clear" @click="clearCart">Clear</button>
            <button class="btn" @click="openConfirm">Continue</button>
          </div>
        </div>
      </div>
    </div>
  `;
}
