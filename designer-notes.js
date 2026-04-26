(function () {
  'use strict';

  if (window.__dnInitialized) return;
  window.__dnInitialized = true;

  // =========================================================================
  // STATE
  // =========================================================================

  var STORAGE_KEY = 'dn-comments';
  var SERVER_URL = window.location.origin;
  var POLL_INTERVAL = 3000;
  var serverAvailable = false;

  var state = {
    critMode: false,
    textEditMode: false,
    comments: [],
    textEdits: [],
    nextId: 1,
    nextTextEditId: 1,
    editingCommentId: null,
    activeTextEdit: null, // { element, before, selector, tagName, bounds }
    panelOpen: false,
    inspectMode: false,
    inspectTarget: null,         // { element, selector, meta }
    inspectEditingValue: false,  // true when user is focused on inspector panel input
    cssEdits: [],
    nextCssEditId: 1,
    skills: [],
    directives: [],
    preferences: {},
  };

  function currentPage() {
    return window.location.pathname.replace(/^\//, '') || 'index';
  }

  function pageComments() {
    return state.comments.filter(function (c) { return c.page === currentPage(); });
  }

  // =========================================================================
  // UNDO
  // =========================================================================

  var undoStack = [];
  var UNDO_MAX = 50;

  function pushUndo(type) {
    undoStack.push({
      type: type,
      comments: JSON.parse(JSON.stringify(state.comments)),
      nextId: state.nextId,
      textEdits: JSON.parse(JSON.stringify(state.textEdits)),
      nextTextEditId: state.nextTextEditId,
      cssEdits: JSON.parse(JSON.stringify(state.cssEdits)),
      nextCssEditId: state.nextCssEditId,
    });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }

  function undo() {
    if (undoStack.length === 0) { showToast('Nothing to undo'); return; }
    var entry = undoStack.pop();
    state.comments = entry.comments;
    state.nextId = entry.nextId;
    state.textEdits = entry.textEdits || [];
    state.nextTextEditId = entry.nextTextEditId || (state.textEdits.length + 1);
    state.cssEdits = entry.cssEdits || [];
    state.nextCssEditId = entry.nextCssEditId || (state.cssEdits.length + 1);
    clearAllInspectInlineStyles();
    reapplyCssEdits();
    closeInspectPanel();
    deselectInspectTarget();
    saveState();
    closePopover();
    dismissTextEdit();
    rerenderAllPins();
    rerenderAllTextIndicators();
    if (state.panelOpen) renderCommentList();
    updateBadge();
    showToast('Undid: ' + entry.type);
  }

  // =========================================================================
  // PERSISTENCE
  // =========================================================================

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        comments: state.comments,
        nextId: state.nextId,
        textEdits: state.textEdits,
        nextTextEditId: state.nextTextEditId,
        cssEdits: state.cssEdits,
        nextCssEditId: state.nextCssEditId,
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      var data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (data && data.comments) {
        state.comments = data.comments;
        state.nextId = data.nextId || state.comments.length + 1;
        state.textEdits = data.textEdits || [];
        state.nextTextEditId = data.nextTextEditId || (state.textEdits.length + 1);
        state.cssEdits = data.cssEdits || [];
        state.nextCssEditId = data.nextCssEditId || (state.cssEdits.length + 1);
        // Migration: strip removed fields from old data
        state.comments.forEach(function (c) {
          delete c.resolved;
          delete c.resolvedAt;
          delete c.replies;
        });
      }
    } catch (e) {}
  }

  function detectServer() {
    fetch(SERVER_URL + '/server-info', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.active) {
          serverAvailable = true;
          startClearPoll();
          loadConfig();
        }
      })
      .catch(function () { serverAvailable = false; });
  }

  function loadConfig() {
    fetch(SERVER_URL + '/config', { method: 'GET' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.skills) state.skills = d.skills;
        if (d && d.directives) state.directives = d.directives;
        if (d && d.preferences) { state.preferences = d.preferences; applyUIVisibility(); }
      })
      .catch(function () {});
  }

  function saveToServer(filename, content) {
    if (!serverAvailable) return Promise.reject(new Error('No server'));
    return fetch(SERVER_URL + '/save-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: filename, content: content }),
    }).then(function (r) { return r.json(); });
  }

  // Auto-export: saves markdown to server after every comment change
  function autoExport() {
    if (!serverAvailable) return;
    if (state.comments.length === 0 && state.textEdits.length === 0 && state.cssEdits.length === 0) return;
    var md = generateMarkdown();
    var dateSlug = new Date().toISOString().substring(0, 10);
    saveToServer('feedback-' + dateSlug + '.md', md).catch(function () {});
  }

  // Clear signal: poll server to detect when feedback has been archived
  var clearPollInterval = null;

  function startClearPoll() {
    if (clearPollInterval || !serverAvailable) return;
    clearPollInterval = setInterval(function () {
      fetch(SERVER_URL + '/clear-signal', { method: 'GET' })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.clear) clearAllComments();
        })
        .catch(function () {});
    }, POLL_INTERVAL);
    window.addEventListener('beforeunload', function () {
      clearInterval(clearPollInterval);
      clearPollInterval = null;
    });
  }

  function clearAllComments() {
    state.comments = [];
    state.nextId = 1;
    state.textEdits = [];
    state.nextTextEditId = 1;
    state.cssEdits = [];
    state.nextCssEditId = 1;
    state.editingCommentId = null;
    inspectOriginalValues = {};
    undoStack.length = 0;
    saveState();
    closePopover();
    rerenderAllPins();
    rerenderAllTextIndicators();
    updateBadge();

    if (state.panelOpen) {
      showRefreshInPanel();
    } else {
      showRefreshDialog();
    }
  }

  var REFRESH_ICON = '<svg class="dn-refresh-icon" viewBox="0 0 24 24" data-designer-notes><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>';

  function showRefreshInPanel() {
    commentListEl.innerHTML =
      '<div class="dn-refresh-prompt" data-designer-notes>' +
        REFRESH_ICON +
        '<div class="dn-refresh-heading" data-designer-notes>Feedback applied</div>' +
        '<p class="dn-refresh-sub" data-designer-notes>Changes are live. Refresh to see updates.</p>' +
        '<a class="dn-changelog-link" href="/.designer-notes/changelog.html" target="_blank" data-designer-notes>View changelog</a>' +
        '<button class="dn-refresh-btn" data-designer-notes>Refresh page</button>' +
      '</div>';
    commentListEl.querySelector('.dn-refresh-btn').addEventListener('click', function () {
      window.location.reload();
    });
  }

  function showRefreshDialog() {
    var overlay = document.createElement('div');
    overlay.className = 'dn-confirm-overlay';
    overlay.setAttribute('data-designer-notes', 'confirm');
    overlay.innerHTML =
      '<div class="dn-confirm dn-refresh-dialog" data-designer-notes>' +
        REFRESH_ICON +
        '<div class="dn-refresh-heading" data-designer-notes>Feedback applied</div>' +
        '<p class="dn-refresh-sub" data-designer-notes>Changes are live. Refresh to see updates.</p>' +
        '<a class="dn-changelog-link" href="/.designer-notes/changelog.html" target="_blank" data-designer-notes>View changelog</a>' +
        '<div class="dn-confirm-actions" data-designer-notes>' +
          '<button class="dn-confirm-btn dn-confirm-cancel" data-designer-notes>Dismiss</button>' +
          '<button class="dn-confirm-btn dn-refresh-btn-primary" data-designer-notes>Refresh page</button>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('.dn-confirm-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.dn-refresh-btn-primary').addEventListener('click', function () {
      window.location.reload();
    });
    document.body.appendChild(overlay);
  }

  // =========================================================================
  // SETTINGS
  // =========================================================================

  function showSettings() {
    if (!panelEl) return;
    var titleEl = panelEl.querySelector('.dn-panel-title');
    if (titleEl) titleEl.textContent = 'Settings';

    var models = (state.preferences.availableModels || []);
    var currentModel = state.preferences.defaultModel || '';
    var efforts = ['high-effort', 'medium-effort', 'low-effort'];
    var currentEffort = state.preferences.defaultEffort || 'medium-effort';

    var autoApply = state.preferences.autoApply !== false;
    var showToggle = state.preferences.hideToggleButton !== true;

    var modelCards = models.map(function (m) {
      var label = m.charAt(0).toUpperCase() + m.slice(1);
      var sel = m === currentModel ? ' dn-card-selected' : '';
      return '<button class="dn-card-option' + sel + '" data-value="' + m + '" data-designer-notes>' + label + '</button>';
    }).join('');

    var effortCards = efforts.map(function (e) {
      var label = e.replace('-effort', '');
      label = label.charAt(0).toUpperCase() + label.slice(1);
      var sel = e === currentEffort ? ' dn-card-selected' : '';
      return '<button class="dn-card-option' + sel + '" data-value="' + e + '" data-designer-notes>' + label + '</button>';
    }).join('');

    // Animate in: add transitioning class, then remove after frame
    commentListEl.classList.add('dn-view-entering');

    commentListEl.innerHTML =
      '<div class="dn-settings-view" data-designer-notes>' +
        '<div class="dn-settings-body" data-designer-notes>' +
          '<div class="dn-settings-section" data-designer-notes>' +
            '<div class="dn-settings-label" data-designer-notes>Default model</div>' +
            '<div class="dn-card-grid dn-settings-model" data-designer-notes>' + modelCards + '</div>' +
          '</div>' +
          '<div class="dn-settings-section" data-designer-notes>' +
            '<div class="dn-settings-label" data-designer-notes>Default effort</div>' +
            '<div class="dn-card-grid dn-settings-effort" data-designer-notes>' + effortCards + '</div>' +
          '</div>' +
          '<div class="dn-settings-section" data-designer-notes>' +
            '<label class="dn-settings-toggle" data-designer-notes>' +
              '<input type="checkbox" class="dn-switch-input dn-settings-auto-apply" data-designer-notes' + (autoApply ? ' checked' : '') + '>' +
              '<span class="dn-switch" data-designer-notes></span>' +
              '<span class="dn-toggle-label" data-designer-notes>Auto-apply edits</span>' +
            '</label>' +
            '<div class="dn-settings-hint" data-designer-notes>Skip confirmation prompt when running /submit-feedback</div>' +
          '</div>' +
          '<div class="dn-settings-section" data-designer-notes>' +
            '<label class="dn-settings-toggle" data-designer-notes>' +
              '<input type="checkbox" class="dn-switch-input dn-settings-show-toggle" data-designer-notes' + (showToggle ? ' checked' : '') + '>' +
              '<span class="dn-switch" data-designer-notes></span>' +
              '<span class="dn-toggle-label" data-designer-notes>Show comment button</span>' +
            '</label>' +
            '<div class="dn-settings-hint" data-designer-notes>Hide the floating button in the bottom corner.</div>' +
          '</div>' +
          '<div class="dn-settings-section" data-designer-notes>' +
            '<div class="dn-settings-label" data-designer-notes>Keyboard shortcuts</div>' +
            '<div class="dn-shortcut-list" data-designer-notes>' +
              '<div class="dn-shortcut-row" data-designer-notes><kbd data-designer-notes>C</kbd><span data-designer-notes>Toggle comment mode</span></div>' +
              '<div class="dn-shortcut-row" data-designer-notes><kbd data-designer-notes>\u2318.</kbd><span data-designer-notes>Show / hide all UI</span></div>' +
              '<div class="dn-shortcut-row" data-designer-notes><kbd data-designer-notes>\u2318Z</kbd><span data-designer-notes>Undo</span></div>' +
              '<div class="dn-shortcut-row" data-designer-notes><kbd data-designer-notes>Esc</kbd><span data-designer-notes>Close popover or panel</span></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="dn-settings-actions" data-designer-notes>' +
          '<button class="dn-settings-back" data-designer-notes>Cancel</button>' +
          '<button class="dn-settings-save" data-designer-notes>Save</button>' +
        '</div>' +
      '</div>';

    // Trigger transition: remove entering class next frame so CSS animates
    requestAnimationFrame(function () {
      commentListEl.classList.remove('dn-view-entering');
    });

    // Card selection for model
    commentListEl.querySelector('.dn-settings-model').addEventListener('click', function (e) {
      var btn = e.target.closest('.dn-card-option');
      if (!btn) return;
      this.querySelectorAll('.dn-card-option').forEach(function (b) { b.classList.remove('dn-card-selected'); });
      btn.classList.add('dn-card-selected');
    });

    // Card selection for effort
    commentListEl.querySelector('.dn-settings-effort').addEventListener('click', function (e) {
      var btn = e.target.closest('.dn-card-option');
      if (!btn) return;
      this.querySelectorAll('.dn-card-option').forEach(function (b) { b.classList.remove('dn-card-selected'); });
      btn.classList.add('dn-card-selected');
    });

    commentListEl.querySelector('.dn-settings-save').addEventListener('click', saveSettings);
    commentListEl.querySelector('.dn-settings-back').addEventListener('click', function () {
      commentListEl.classList.add('dn-view-leaving');
      setTimeout(function () {
        commentListEl.classList.remove('dn-view-leaving');
        renderCommentList();
      }, 150);
    });
  }

  function saveSettings() {
    var modelGrid = commentListEl.querySelector('.dn-settings-model');
    var effortGrid = commentListEl.querySelector('.dn-settings-effort');
    var autoApplyCheck = commentListEl.querySelector('.dn-settings-auto-apply');
    var showToggleCheck = commentListEl.querySelector('.dn-settings-show-toggle');
    if (!modelGrid || !effortGrid) return;

    var selectedModel = modelGrid.querySelector('.dn-card-selected');
    var selectedEffort = effortGrid.querySelector('.dn-card-selected');
    if (!selectedModel || !selectedEffort) return;

    var newPrefs = {
      defaultModel: selectedModel.dataset.value,
      defaultEffort: selectedEffort.dataset.value,
      availableModels: state.preferences.availableModels || [],
      autoApply: autoApplyCheck ? autoApplyCheck.checked : true,
      hideToggleButton: showToggleCheck ? !showToggleCheck.checked : false,
      showUI: state.preferences.showUI,
    };

    state.preferences = newPrefs;
    applyUIVisibility();

    if (serverAvailable) {
      fetch(SERVER_URL + '/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: newPrefs }),
      })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.saved) showToast('Settings saved');
        })
        .catch(function () {
          showToast('Failed to save');
        });
    }

    // Animate out before switching view
    commentListEl.classList.add('dn-view-leaving');
    setTimeout(function () {
      commentListEl.classList.remove('dn-view-leaving');
      renderCommentList();
    }, 150);
  }

  // =========================================================================
  // UI VISIBILITY
  // =========================================================================

  function applyUIVisibility() {
    var visible = state.preferences.showUI !== false;
    if (visible) {
      document.body.classList.remove('dn-ui-hidden');
    } else {
      document.body.classList.add('dn-ui-hidden');
    }
    // Toggle button visibility (separate from full UI hide)
    if (state.preferences.hideToggleButton) {
      document.body.classList.add('dn-toggle-hidden');
    } else {
      document.body.classList.remove('dn-toggle-hidden');
    }
  }

  function toggleUIVisibility() {
    state.preferences.showUI = state.preferences.showUI === false ? true : false;
    applyUIVisibility();
    if (serverAvailable) {
      fetch(SERVER_URL + '/save-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: state.preferences }),
      }).catch(function () {});
    }
  }

  // =========================================================================
  // UTILITIES
  // =========================================================================

  function showConfirm(msg, onConfirm) {
    var overlay = document.createElement('div');
    overlay.className = 'dn-confirm-overlay';
    overlay.setAttribute('data-designer-notes', 'confirm');
    overlay.innerHTML =
      '<div class="dn-confirm" data-designer-notes>' +
        '<div class="dn-confirm-msg" data-designer-notes>' + msg + '</div>' +
        '<div class="dn-confirm-actions" data-designer-notes>' +
          '<button class="dn-confirm-btn dn-confirm-cancel" data-designer-notes>Cancel</button>' +
          '<button class="dn-confirm-btn dn-confirm-danger" data-designer-notes>Delete</button>' +
        '</div>' +
      '</div>';
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('.dn-confirm-cancel').addEventListener('click', function () { overlay.remove(); });
    overlay.querySelector('.dn-confirm-danger').addEventListener('click', function () { overlay.remove(); onConfirm(); });
    document.body.appendChild(overlay);
  }

  var _escapeDiv = document.createElement('div');
  function escapeHtml(str) {
    _escapeDiv.textContent = str;
    return _escapeDiv.innerHTML;
  }

  var HIDDEN_SKILL_NAMES = ['designer-notes', 'submit-feedback', 'hotspot-scan'];

  function autoResizeTextarea(ta) {
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  function updateHighlight(val, el) {
    if (!el) return;
    var skillNames = state.skills.filter(function (s) {
      return HIDDEN_SKILL_NAMES.indexOf(s.name) === -1;
    }).map(function (s) { return s.name; });
    var directiveNames = state.directives.map(function (d) { return d.name; });
    if (skillNames.length === 0 && directiveNames.length === 0) { el.textContent = val; return; }
    var html = escapeHtml(val);
    if (skillNames.length > 0) {
      var sp = new RegExp('(^|\\s)(\\/(' + skillNames.join('|') + '))(?=\\s|$)', 'gm');
      html = html.replace(sp, function (m, pre, cmd) {
        return pre + '<span class="dn-skill-hl">' + cmd + '</span>';
      });
    }
    if (directiveNames.length > 0) {
      var dp = new RegExp('(^|\\s)(#(' + directiveNames.join('|') + '))(?=\\s|$)', 'gm');
      html = html.replace(dp, function (m, pre, cmd) {
        return pre + '<span class="dn-skill-hl">' + cmd + '</span>';
      });
    }
    el.innerHTML = html;
  }

  function relativeTime(iso) {
    if (!iso) return '';
    var then = new Date(iso).getTime();
    if (isNaN(then)) return '';
    var diff = Math.floor((Date.now() - then) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 172800) return 'yesterday';
    return Math.floor(diff / 86400) + 'd ago';
  }

  var toastEl, toastTimer;
  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'dn-toast';
      toastEl.setAttribute('data-designer-notes', 'toast');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('dn-toast-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.classList.remove('dn-toast-visible'); }, 2500);
  }

  // =========================================================================
  // STYLES
  // =========================================================================

  var STYLES = [
    '[data-designer-notes]{' +
      '--dn-brand:#3b82f6;--dn-brand-hover:#2563eb;--dn-brand-dark:#1d4ed8;' +
      '--dn-blue-light:#60a5fa;' +
      '--dn-danger:#ef4444;--dn-danger-hover:#dc2626;' +
      '--dn-text:#0f172a;--dn-text-secondary:#475569;--dn-text-muted:#94a3b8;--dn-text-faint:#cbd5e1;' +
      '--dn-bg:#f8fafc;--dn-bg-subtle:#f1f5f9;--dn-bg-tinted:#e2e8f0;--dn-bg-hover:#dbeafe;' +
      '--dn-border:#cbd5e1;--dn-border-light:#e2e8f0;' +
      '--dn-font-xs:11px;--dn-font-sm:12px;--dn-font-base:13px;--dn-font-lg:15px;' +
      'box-sizing:border-box;font-family:"Outfit",-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.4;-webkit-font-smoothing:antialiased' +
    '}',

    '[data-designer-notes]:focus-visible{outline:2px solid var(--dn-brand);outline-offset:2px}',
    '[data-designer-notes] button:focus-visible,[data-designer-notes] textarea:focus-visible{outline:2px solid var(--dn-brand);outline-offset:2px}',

    // Toggle
    '.dn-toggle{position:fixed;bottom:24px;right:80px;width:48px;height:48px;border-radius:24px;background:var(--dn-bg);border:2px solid var(--dn-border);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:2147483640;transition:transform .15s,background .15s,border-color .15s;padding:0}',
    '.dn-toggle:hover{transform:scale(1.08);border-color:var(--dn-brand)}',
    '.dn-toggle.dn-active{background:var(--dn-brand);border-color:var(--dn-brand)}',
    '.dn-toggle.dn-active:hover{background:var(--dn-brand-hover);border-color:var(--dn-brand-hover)}',
    '.dn-toggle svg{width:22px;height:22px;fill:none;stroke:var(--dn-text-secondary);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-toggle.dn-active svg{stroke:#fff;fill:none}',
    '.dn-text-toggle{position:fixed;bottom:24px;right:136px;width:48px;height:48px;border-radius:24px;background:var(--dn-bg);border:2px solid var(--dn-border);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:2147483640;transition:transform .15s,background .15s,border-color .15s;padding:0}',
    '.dn-text-toggle:hover{transform:scale(1.08);border-color:var(--dn-brand)}',
    '.dn-text-toggle.dn-active{background:var(--dn-brand);border-color:var(--dn-brand)}',
    '.dn-text-toggle.dn-active:hover{background:var(--dn-brand-hover);border-color:var(--dn-brand-hover)}',
    '.dn-text-toggle svg{width:22px;height:22px;fill:none;stroke:var(--dn-text-secondary);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-text-toggle.dn-active svg{stroke:#fff}',
    '.dn-inspect-toggle{position:fixed;bottom:24px;right:192px;width:48px;height:48px;border-radius:24px;background:var(--dn-bg);border:2px solid var(--dn-border);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:2147483640;transition:transform .15s,background .15s,border-color .15s;padding:0}',
    '.dn-inspect-toggle svg{width:20px;height:20px;fill:none;stroke:var(--dn-text-secondary);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-inspect-toggle:hover{transform:scale(1.08);border-color:var(--dn-brand)}',
    '.dn-inspect-toggle.dn-active{background:var(--dn-brand);border-color:var(--dn-brand)}',
    '.dn-inspect-toggle.dn-active svg{stroke:#fff}',
    'body.dn-inspect-mode *:not([data-designer-notes]):not([data-designer-notes] *){cursor:crosshair!important}',
    '.dn-inspect-hover-outline{position:absolute;pointer-events:none;z-index:2147483638;border:2px solid var(--dn-brand);border-radius:2px}',
    '.dn-inspect-hover-label{position:absolute;pointer-events:none;z-index:2147483638;background:var(--dn-brand);color:#fff;font-size:10px;font-weight:600;font-family:"JetBrains Mono",monospace;padding:2px 6px;border-radius:3px;white-space:nowrap;line-height:1.3}',
    '.dn-inspect-select-outline{position:absolute;pointer-events:none;z-index:2147483638;border:2px solid var(--dn-brand);border-radius:2px}',
    '.dn-inspect-corner{position:absolute;width:8px;height:8px;background:var(--dn-brand);border-radius:50%;pointer-events:none;z-index:2147483638}',
    '.dn-inspect-panel{position:fixed;top:0;right:0;width:260px;height:100vh;background:var(--dn-bg);border-left:1px solid var(--dn-border);box-shadow:-4px 0 24px rgba(0,0,0,.06);font-family:"Outfit",sans-serif;font-size:var(--dn-font-xs);color:var(--dn-text);overflow-y:auto;overflow-x:hidden;z-index:2147483644}',
    '.dn-inspect-panel.dn-inspect-panel-enter{animation:dn-panel-slide-in .2s cubic-bezier(0.25,1,0.5,1) forwards}',
    '@keyframes dn-panel-slide-in{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}',
    '@media(prefers-reduced-motion:reduce){.dn-inspect-panel.dn-inspect-panel-enter{animation:none}}',
    '.dn-inspect-panel-header{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--dn-border-light);background:var(--dn-bg-subtle);position:sticky;top:0;z-index:1}',
    '.dn-inspect-panel-tag{display:flex;align-items:center;gap:4px;font-family:"JetBrains Mono",monospace;font-size:12px;min-width:0;overflow:hidden}',
    '.dn-inspect-panel-tag-name{color:var(--dn-brand);font-weight:600}',
    '.dn-inspect-panel-tag-class{color:var(--dn-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.dn-inspect-panel-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}',
    '.dn-inspect-panel-btn{width:24px;height:24px;border-radius:6px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);font-size:14px;padding:0}',
    '.dn-inspect-panel-btn:hover{background:var(--dn-bg-hover);color:var(--dn-text)}',
    '.dn-inspect-panel-placeholder{display:flex;align-items:center;justify-content:center;height:200px;color:var(--dn-text-muted);font-size:12px;text-align:center;padding:20px}',
    '.dn-inspect-section{padding:12px 14px;border-bottom:1px solid var(--dn-border-light)}',
    '.dn-inspect-section:last-child{border-bottom:none}',
    '.dn-inspect-section-label{font-size:11px;font-weight:600;color:var(--dn-text-secondary);letter-spacing:0.5px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;user-select:none}',
    '.dn-inspect-section-label .dn-inspect-css-hint{font-weight:400;color:var(--dn-text-muted);font-size:10px;letter-spacing:0}',
    '.dn-inspect-section-label::after{content:"▾";font-size:14px;font-weight:700;color:var(--dn-text-secondary);margin-left:auto;transition:transform .15s;display:inline-block}',
    '.dn-inspect-section.collapsed .dn-inspect-section-label::after{transform:rotate(-90deg)}',
    '.dn-inspect-section.collapsed .dn-inspect-section-body{display:none}',
    '.dn-inspect-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
    '.dn-inspect-field{display:flex;flex-direction:column;gap:2px}',
    '.dn-inspect-field-label{color:var(--dn-text-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-transform:capitalize}',
    '.dn-inspect-field-inline{display:grid;grid-template-columns:16px 1fr;align-items:center;gap:6px}',
    '.dn-inspect-field-inline .dn-inspect-field-label{font-size:11px}',
    '.dn-inspect-input{width:100%;height:26px;border:1px solid var(--dn-border-light);border-radius:5px;background:var(--dn-bg-subtle);color:var(--dn-text);font-family:"JetBrains Mono",monospace;font-size:11px;padding:0 6px;text-align:right;outline:none;transition:border-color .15s;box-sizing:border-box;min-width:0}',
    '.dn-inspect-input:focus{border-color:var(--dn-brand)}',
    '.dn-inspect-input.dimmed{color:var(--dn-text-muted);opacity:0.5}',
    '.dn-inspect-select{width:100%;height:26px;border:1px solid var(--dn-border-light);border-radius:5px;background:var(--dn-bg-subtle);color:var(--dn-text);font-family:"JetBrains Mono",monospace;font-size:11px;padding:0 4px;outline:none;cursor:pointer;-webkit-appearance:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg width=\'8\' height=\'5\' viewBox=\'0 0 8 5\' fill=\'none\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cpath d=\'M1 1l3 3 3-3\' stroke=\'%2394a3b8\' stroke-width=\'1.5\' stroke-linecap=\'round\'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 4px center;padding-right:16px;box-sizing:border-box;min-width:0}',
    '.dn-inspect-select:focus{border-color:var(--dn-brand)}',
    '.dn-inspect-color-row{display:flex;flex-direction:column;gap:2px}',
    '.dn-inspect-color-controls{display:flex;align-items:center;gap:6px}',
    '.dn-inspect-color-chip{width:26px;height:26px;border-radius:6px;border:1px solid var(--dn-border);cursor:pointer;flex-shrink:0;position:relative;overflow:hidden}',
    '.dn-inspect-color-chip input{position:absolute;top:-4px;left:-4px;width:34px;height:34px;opacity:0;cursor:pointer}',
    '.dn-inspect-spacing{display:flex;flex-direction:column;align-items:center;gap:4px}',
    '.dn-inspect-spacing-row{display:flex;align-items:center;gap:4px}',
    '.dn-inspect-spacing-input{width:44px;height:24px;border:1px solid var(--dn-border-light);border-radius:5px;background:var(--dn-bg-subtle);color:var(--dn-text);font-family:"JetBrains Mono",monospace;font-size:11px;padding:0 4px;text-align:center;outline:none;box-sizing:border-box}',
    '.dn-inspect-spacing-input:focus{border-color:var(--dn-brand)}',
    '.dn-inspect-spacing-input.dimmed{color:var(--dn-text-muted);opacity:0.5}',
    '.dn-inspect-spacing-center{width:40px;height:28px;border-radius:4px}',
    '.dn-inspect-spacing-center.padding-box{background:#dbeafe;border:1px solid #93c5fd}',
    '.dn-inspect-spacing-center.margin-box{background:#fef3c7;border:1px solid #fcd34d}',
    '.dn-more-toggle{position:fixed;bottom:24px;right:24px;width:48px;height:48px;border-radius:24px;background:var(--dn-bg);border:2px solid var(--dn-border);cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:2147483640;transition:transform .15s,background .15s,border-color .15s;padding:0}',
    '.dn-more-toggle:hover{transform:scale(1.08);border-color:var(--dn-brand)}',
    '.dn-more-toggle svg{width:22px;height:22px;fill:var(--dn-text-secondary);stroke:none}',
    '.dn-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;background:var(--dn-brand);color:#fff;font-size:var(--dn-font-xs);font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px}',
    '.dn-toggle.dn-active .dn-badge{background:#fff;color:var(--dn-brand)}',
    '.dn-badge:empty,.dn-badge[data-count="0"]{display:none}',

    'body.dn-crit-mode,body.dn-crit-mode *:not([data-designer-notes]):not([data-designer-notes] *){cursor:crosshair!important}',

    // Pins
    '.dn-pin{position:absolute;width:28px;height:28px;border-radius:50% 50% 50% 0;background:var(--dn-brand);color:#fff;font-size:var(--dn-font-sm);font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,.25);z-index:2147483639;cursor:grab;transform:rotate(-45deg);transition:transform .15s,background .15s;pointer-events:auto}',
    '.dn-pin span{transform:rotate(45deg)}',
    '.dn-pin:hover{animation:dn-pin-bounce .3s cubic-bezier(0.25,1,0.5,1) forwards}',
    '@keyframes dn-pin-bounce{0%{transform:rotate(-45deg) scale(1)}40%{transform:rotate(-45deg) scale(1.18)}100%{transform:rotate(-45deg) scale(1.12)}}',
    '.dn-pin.dn-pin-editing{background:var(--dn-brand-dark);transform:rotate(-45deg) scale(1.12);animation:none}',
    '@media(prefers-reduced-motion:reduce){.dn-pin:hover{animation:none;transform:rotate(-45deg) scale(1.12)}}',
    '.dn-pin.dn-pin-dragging{cursor:grabbing!important;transform:rotate(-45deg) scale(1.2);opacity:0.85;transition:none}',
    '.dn-pin.dn-pin-detached{background:var(--dn-text-muted);border:2px dashed var(--dn-text-secondary)}',
    '@keyframes dn-pin-pop{0%{transform:rotate(-45deg) scale(0);opacity:0}60%{transform:rotate(-45deg) scale(1.2);opacity:1}100%{transform:rotate(-45deg) scale(1);opacity:1}}',
    '.dn-pin-new{animation:dn-pin-pop .3s ease forwards}',

    // Text edit mode styles
    '.dn-text-hover{outline:2px solid #3b82f6!important;outline-offset:-1px}',
    '.dn-text-editing{outline:2px solid #3b82f6!important;outline-offset:-2px;background:rgba(59,130,246,0.06)!important}',
    '.dn-text-controls{display:flex;justify-content:flex-end;gap:6px;margin-top:6px;position:absolute;z-index:2147483641;pointer-events:auto}',
    '.dn-text-dismiss{width:32px;height:32px;border-radius:8px;border:1px solid var(--dn-border);background:var(--dn-bg-subtle);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);transition:background .15s,color .15s;padding:0}',
    '.dn-text-dismiss:hover{background:var(--dn-bg-tinted);color:var(--dn-text)}',
    '.dn-text-dismiss svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-text-accept{width:32px;height:32px;border-radius:8px;border:none;background:var(--dn-brand);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .15s;padding:0;box-shadow:0 1px 3px rgba(59,130,246,0.3)}',
    '.dn-text-accept:hover{background:var(--dn-brand-hover)}',
    '.dn-text-accept svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-text-indicator{position:absolute;pointer-events:none;z-index:2147483638}',
    '.dn-text-indicator-bar{position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:2px;background:var(--dn-brand)}',
    '.dn-text-indicator-num{position:absolute;left:-10px;top:50%;transform:translateY(-50%);font-size:9px;font-weight:700;color:var(--dn-brand);font-family:system-ui,sans-serif;line-height:1}',
    '.dn-text-edit-mode [data-designer-notes]{cursor:default}',
    '.dn-text-edit-mode{cursor:default}',

    // Preview
    '.dn-preview{position:absolute;background:var(--dn-bg);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.15),0 1px 3px rgba(0,0,0,.1);padding:8px 12px;max-width:280px;min-width:120px;z-index:2147483643;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s;font-size:var(--dn-font-base);color:var(--dn-text);word-wrap:break-word}',
    '.dn-preview.dn-preview-visible{opacity:1;transform:translateY(0)}',
    '.dn-preview-empty{color:var(--dn-text-muted);font-style:italic}',
    '.dn-preview-number{font-size:var(--dn-font-xs);font-weight:700;color:var(--dn-brand);margin-bottom:4px}',

    // Popover
    '.dn-popover{position:absolute;background:var(--dn-bg);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.15),0 2px 6px rgba(0,0,0,.1);width:320px;z-index:2147483644;transform-origin:top left;display:none}',
    '.dn-popover.dn-popover-visible{display:block}',
    '.dn-popover.dn-popover-enter{animation:dn-popover-in .2s cubic-bezier(0.25,1,0.5,1) forwards}',
    '.dn-popover.dn-popover-exit{animation:dn-popover-out .15s cubic-bezier(0.5,0,0.75,0) forwards}',
    '@keyframes dn-popover-in{0%{opacity:0;transform:scale(.95) translateY(4px)}100%{opacity:1;transform:scale(1) translateY(0)}}',
    '@keyframes dn-popover-out{0%{opacity:1;transform:scale(1) translateY(0)}100%{opacity:0;transform:scale(.97) translateY(2px)}}',
    '@media(prefers-reduced-motion:reduce){.dn-popover.dn-popover-enter,.dn-popover.dn-popover-exit{animation:none}}',
    '.dn-popover-header{display:flex;align-items:center;justify-content:space-between;padding:8px 8px 8px 16px;background:var(--dn-bg-tinted);border-bottom:1px solid var(--dn-border-light)}',
    '.dn-popover-context{display:flex;align-items:center;gap:8px;font-size:var(--dn-font-xs);color:var(--dn-text-muted);flex:1;min-width:0}',
    '.dn-popover-tag{background:var(--dn-border);color:var(--dn-text-secondary);padding:1px 6px;border-radius:3px;font-size:var(--dn-font-xs);font-weight:700;font-family:"JetBrains Mono",monospace}',
    '.dn-popover-context-text{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}',
    '.dn-popover-toolbar{display:flex;align-items:center;gap:2px;flex-shrink:0}',
    '.dn-popover-toolbar-divider{width:1px;height:16px;background:var(--dn-border);margin:0 2px}',
    '.dn-popover-toolbar>button,.dn-popover-toolbar>.dn-popover-menu-wrap .dn-popover-more{width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);transition:background .15s,color .15s}',
    '.dn-popover-toolbar>button:hover,.dn-popover-toolbar .dn-popover-more:hover{background:var(--dn-bg-hover);color:var(--dn-text)}',
    '.dn-popover-toolbar>button svg,.dn-popover-more svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-popover-more svg circle{fill:currentColor;stroke:none}',
    '.dn-popover-close svg{width:18px;height:18px;stroke-width:2.5}',
    '.dn-popover-menu-wrap{position:relative}',
    '.dn-popover-toolbar .dn-popover-more.dn-popover-more-active{background:var(--dn-bg-hover);color:var(--dn-text)}',
    '.dn-popover-menu{display:none;position:absolute;top:100%;right:0;margin-top:4px;background:#1a1a1a;border:1px solid rgba(255,255,255,.1);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);width:190px;padding:4px;z-index:2147483645;transform-origin:top right}',
    '.dn-popover-menu.dn-popover-menu-open{display:block;animation:dn-menu-in .15s cubic-bezier(0.25,1,0.5,1) forwards}',
    '@keyframes dn-menu-in{0%{opacity:0;transform:scale(.95) translateY(-4px)}100%{opacity:1;transform:scale(1) translateY(0)}}',
    '@media(prefers-reduced-motion:reduce){.dn-popover-menu.dn-popover-menu-open{animation:none}}',
    '.dn-popover-menu-item{display:block;width:100%;height:auto;padding:8px 12px;border:none;background:none;border-radius:6px;font-size:var(--dn-font-base);font-weight:500;font-family:inherit;color:rgba(255,255,255,.85);cursor:pointer;transition:background .15s,color .15s;white-space:nowrap;text-align:left;line-height:1.3}',
    '.dn-popover-menu-item:hover{background:rgba(255,255,255,.1);color:#fff}',
    '.dn-confirm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:2147483646;display:flex;align-items:center;justify-content:center}',
    '.dn-confirm{background:var(--dn-bg);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.15),0 2px 6px rgba(0,0,0,.1);width:390px;padding:20px 20px 16px}',
    '.dn-confirm-msg{font-size:15px;font-weight:500;color:var(--dn-text);margin-bottom:20px;line-height:1.45}',
    '.dn-confirm-actions{display:flex;gap:8px;justify-content:flex-end}',
    '.dn-confirm-btn{height:32px;padding:0 16px;border-radius:8px;border:none;font-size:var(--dn-font-base);font-weight:600;font-family:inherit;cursor:pointer;transition:background .15s}',
    '.dn-confirm-cancel{background:var(--dn-bg-subtle);color:var(--dn-text-secondary)}',
    '.dn-confirm-cancel:hover{background:var(--dn-bg-hover);color:var(--dn-text)}',
    '.dn-confirm-danger{background:var(--dn-danger);color:#fff}',
    '.dn-confirm-danger:hover{background:var(--dn-danger-hover)}',
    '.dn-refresh-icon{width:36px;height:36px;fill:none;stroke:var(--dn-brand);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;margin-bottom:12px}',
    '.dn-refresh-heading{font-size:1rem;font-weight:700;color:var(--dn-text);margin-bottom:4px;letter-spacing:-0.01em}',
    '.dn-refresh-sub{font-size:var(--dn-font-sm);color:var(--dn-text-muted);margin:0 0 20px;line-height:1.5}',
    '.dn-refresh-prompt{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px;text-align:center}',
    '.dn-refresh-dialog{text-align:center;display:flex;flex-direction:column;align-items:center}',
    '.dn-refresh-dialog .dn-confirm-actions{justify-content:center}',
    '.dn-refresh-btn{padding:0 20px;height:32px;border-radius:8px;border:none;background:var(--dn-brand);color:#fff;font-size:var(--dn-font-base);font-weight:600;font-family:inherit;cursor:pointer;transition:background .15s}',
    '.dn-refresh-btn:hover{background:var(--dn-brand-hover)}',
    '.dn-refresh-btn-primary{background:var(--dn-brand)!important;color:#fff!important}',
    '.dn-refresh-btn-primary:hover{background:var(--dn-brand-hover)!important}',
    '.dn-changelog-link{font-size:var(--dn-font-sm);color:var(--dn-brand);text-decoration:none;margin-bottom:16px;transition:color .15s;display:inline-block}',
    '.dn-changelog-link:hover{color:var(--dn-brand-hover);text-decoration:underline}',
    // Skill autocomplete
    '.dn-skill-menu{display:none;position:absolute;left:8px;right:8px;background:#1a1a1a;border:1px solid rgba(255,255,255,.1);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-height:200px;overflow-y:auto;z-index:2147483645;padding:4px}',
    '.dn-skill-menu.dn-skill-menu-open{display:block}',
    '.dn-skill-item{display:flex;flex-direction:column;gap:2px;width:100%;padding:8px 12px;border:none;background:none;border-radius:6px;cursor:pointer;transition:background .15s;text-align:left}',
    '.dn-skill-item:hover,.dn-skill-item.dn-skill-active{background:rgba(255,255,255,.1)}',
    '.dn-skill-item-name{font-size:var(--dn-font-base);font-weight:600;color:rgba(255,255,255,.9);font-family:inherit}',
    '.dn-skill-item-desc{font-size:var(--dn-font-xs);color:rgba(255,255,255,.45);font-family:inherit}',
    '.dn-skill-group-hdr{padding:8px 12px 4px;font-size:var(--dn-font-xs);font-weight:700;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.04em}',
    '.dn-skill-group-hdr:first-child{padding-top:6px}',
    '.dn-skill-menu::-webkit-scrollbar{width:4px}',
    '.dn-skill-menu::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px}',

    '.dn-popover-body{padding:0;position:relative}',
    '.dn-textarea-wrap{position:relative}',
    '.dn-textarea-highlight{position:absolute;top:0;left:0;right:0;bottom:0;padding:6px 16px;font-size:16px;font-family:inherit;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;color:var(--dn-text);pointer-events:none;overflow:hidden}',
    '.dn-textarea-highlight .dn-skill-hl{color:var(--dn-brand)}',
    '.dn-popover-textarea{width:100%;min-height:80px;border:none;border-radius:0;padding:6px 16px;font-size:16px;font-family:inherit;color:transparent;caret-color:var(--dn-text);resize:none;outline:none;background:transparent;position:relative;z-index:1;overflow:hidden}',
    '.dn-popover-textarea:focus,.dn-popover-textarea:focus-visible{outline:none!important}',
    '.dn-popover-textarea::placeholder{color:var(--dn-text-faint)}',
    '.dn-popover-footer{display:flex;align-items:center;justify-content:space-between;padding:6px 8px;border-top:1px solid var(--dn-border-light);background:var(--dn-bg-subtle)}',
    '.dn-popover-secondary{display:flex;align-items:center;gap:2px}',
    '.dn-popover-sec-btn{width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);transition:background .15s,color .15s}',
    '.dn-popover-sec-btn:hover,.dn-popover-sec-btn.dn-sec-active{background:var(--dn-bg-hover);color:var(--dn-text)}',
    '.dn-popover-sec-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-popover-sec-btn svg circle{fill:currentColor;stroke:none}',
    '.dn-popover-directives-btn svg{position:relative;top:0.5px}',
    '.dn-popover-skills-btn svg{width:18px;height:18px}',
    '.dn-popover-submit{width:32px;height:32px;border-radius:8px;border:none;background:var(--dn-brand);cursor:pointer;display:flex;align-items:center;justify-content:center;color:#fff;transition:background .15s}',
    '.dn-popover-submit:hover{background:var(--dn-brand-hover)}',
    '.dn-popover-submit svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}',

    // Panel
    '.dn-panel{position:fixed;top:0;right:0;width:min(380px,100vw - 48px);min-width:320px;height:100vh;background:var(--dn-bg);box-shadow:-2px 0 16px rgba(0,0,0,.1);z-index:2147483642;display:flex;flex-direction:column;transform:translateX(100%);transition:transform .25s;overflow:hidden}',
    '.dn-panel.dn-panel-open{transform:translateX(0)}',
    '.dn-panel-header{display:flex;align-items:center;justify-content:space-between;padding:14px 20px;border-bottom:1px solid var(--dn-border);flex-shrink:0;background:var(--dn-bg-subtle)}',
    '.dn-panel-title{font-size:var(--dn-font-lg);font-weight:800;color:var(--dn-text);margin:0;letter-spacing:-0.01em}',
    '.dn-panel-header-actions{display:flex;align-items:center;gap:8px}',
    '.dn-panel-copy{width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);transition:background .15s,color .15s}',
    '.dn-panel-copy:hover{background:var(--dn-bg-hover);color:var(--dn-text-secondary)}',
    '.dn-panel-copy svg{width:16px;height:16px;fill:currentColor}',
    '.dn-panel-close{width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);transition:background .15s,color .15s}',
    '.dn-panel-close:hover{background:var(--dn-bg-hover);color:var(--dn-text-secondary)}',
    '.dn-panel-close svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-panel-settings,.dn-panel-changelog{width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);transition:background .15s,color .15s;text-decoration:none}',
    '.dn-panel-settings:hover,.dn-panel-changelog:hover{background:var(--dn-bg-hover);color:var(--dn-text-secondary)}',
    '.dn-panel-settings svg,.dn-panel-changelog svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-panel-text-edit{display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;color:var(--dn-text-muted);transition:background .15s,color .15s;padding:0}',
    '.dn-panel-text-edit:hover{background:var(--dn-bg-hover);color:var(--dn-text)}',
    '.dn-panel-text-edit.dn-active{background:var(--dn-bg-hover);color:var(--dn-brand)}',
    '.dn-panel-text-edit svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    // Settings view — flex column so actions pin to bottom
    '.dn-settings-view{display:flex;flex-direction:column;flex:1;height:100%;overflow:hidden}',
    '.dn-settings-body{flex:1;overflow-y:auto;padding:20px}',
    '.dn-settings-section{margin-bottom:24px}',
    // /polish: full ink for label, muted (not faint) for hint
    '.dn-settings-label{font-size:var(--dn-font-xs);font-weight:700;color:var(--dn-text);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px}',
    // /arrange: sticky actions bar, full-width buttons
    '.dn-settings-actions{display:flex;gap:8px;padding:12px 20px;border-top:1px solid var(--dn-border);background:var(--dn-bg);flex-shrink:0}',
    '.dn-settings-save{flex:1;height:34px;border-radius:8px;border:none;background:var(--dn-brand);color:#fff;font-size:var(--dn-font-base);font-weight:600;font-family:inherit;cursor:pointer;transition:background .15s}',
    '.dn-settings-save:hover{background:var(--dn-brand-hover)}',
    '.dn-settings-back{flex:1;height:34px;border-radius:8px;border:1px solid var(--dn-border);background:var(--dn-bg-subtle);color:var(--dn-text-secondary);font-size:var(--dn-font-base);font-weight:600;font-family:inherit;cursor:pointer;transition:background .15s,color .15s}',
    '.dn-settings-back:hover{background:var(--dn-bg-hover);color:var(--dn-text)}',
    // Card grids replacing selects
    '.dn-card-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}',
    '.dn-card-option{height:34px;border-radius:8px;border:1px solid var(--dn-border);background:var(--dn-bg);color:var(--dn-text-secondary);font-size:var(--dn-font-sm);font-weight:600;font-family:inherit;cursor:pointer;transition:border-color .15s,background .15s,color .15s;outline:none}',
    '.dn-card-option:hover{border-color:var(--dn-text-muted);color:var(--dn-text)}',
    '.dn-card-option.dn-card-selected{border-color:var(--dn-brand);background:var(--dn-bg-hover);color:var(--dn-brand);font-weight:700}',
    '.dn-settings-toggle{display:flex;align-items:center;gap:10px;cursor:pointer;font-size:var(--dn-font-base)}',
    '.dn-toggle-label{color:var(--dn-text);font-size:var(--dn-font-base)}',
    '.dn-switch-input{position:absolute;opacity:0;width:0;height:0}',
    '.dn-switch{position:relative;width:36px;height:20px;background:var(--dn-border);border-radius:10px;cursor:pointer;transition:background .2s;flex-shrink:0}',
    '.dn-switch::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;background:#fff;border-radius:50%;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.15)}',
    '.dn-switch-input:checked+.dn-switch{background:var(--dn-brand)}',
    '.dn-switch-input:checked+.dn-switch::after{transform:translateX(16px)}',
    // /polish: muted (not faint) for better readability
    '.dn-settings-hint{font-size:var(--dn-font-base);color:var(--dn-text-muted);margin-top:6px;line-height:1.5}',
    '.dn-settings-hint kbd{background:var(--dn-bg-tinted);border:1px solid var(--dn-border);border-radius:3px;padding:0 5px;font-size:var(--dn-font-xs);font-family:inherit}',
    '.dn-shortcut-list{display:flex;flex-direction:column;gap:8px}',
    '.dn-shortcut-row{display:flex;align-items:center;gap:10px;font-size:var(--dn-font-base);color:var(--dn-text-secondary)}',
    '.dn-shortcut-row kbd{min-width:32px;text-align:center;background:var(--dn-bg-tinted);border:1px solid var(--dn-border);border-radius:4px;padding:2px 6px;font-size:var(--dn-font-sm);font-family:inherit;font-weight:600;color:var(--dn-text)}',
    // /animate: view transitions
    '.dn-view-entering{opacity:0;transform:translateX(12px)}',
    '.dn-view-leaving{opacity:0;transform:translateX(-12px);pointer-events:none}',
    'body.dn-ui-hidden [data-designer-notes="toggle"],body.dn-ui-hidden [data-designer-notes="text-toggle"],body.dn-ui-hidden [data-designer-notes="inspect-toggle"],body.dn-ui-hidden [data-designer-notes="more-toggle"],body.dn-ui-hidden [data-designer-notes="pins"],body.dn-ui-hidden [data-designer-notes="panel"],body.dn-ui-hidden [data-designer-notes="popover"],body.dn-ui-hidden [data-designer-notes="preview"]{display:none!important}',
    'body.dn-toggle-hidden [data-designer-notes="toggle"]{display:none!important}',
    'body.dn-toggle-hidden [data-designer-notes="inspect-toggle"]{display:none!important}',
    '.dn-comment-list{flex:1;overflow-y:auto;padding:0;transition:opacity .15s ease-out,transform .15s ease-out}',
    '.dn-comment-list::-webkit-scrollbar{width:6px}',
    '.dn-comment-list::-webkit-scrollbar-thumb{background:var(--dn-border);border-radius:3px}',
    '.dn-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;padding:40px;color:var(--dn-text-muted);text-align:center}',
    '.dn-empty svg{width:40px;height:40px;fill:var(--dn-border);margin-bottom:12px}',
    '.dn-empty p{font-size:var(--dn-font-base);margin:0}',
    '.dn-page-group{padding:8px 20px;font-size:var(--dn-font-xs);font-weight:700;color:var(--dn-blue-light);text-transform:uppercase;letter-spacing:.04em;background:var(--dn-bg-tinted);border-bottom:1px solid var(--dn-border-light)}',
    '.dn-comment-row{padding:12px 20px;border-bottom:1px solid var(--dn-border-light);display:flex;align-items:flex-start;gap:8px;cursor:pointer;transition:background .15s}',
    '.dn-comment-row:hover{background:var(--dn-bg-hover)}',
    '.dn-row-number{width:22px;height:22px;border-radius:50%;background:var(--dn-brand);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}',
    '.dn-row-content{flex:1;min-width:0;position:relative}',
    '.dn-row-meta{display:flex;align-items:center;gap:6px;margin-bottom:4px}',
    '.dn-row-tag{font-size:var(--dn-font-xs);font-weight:700;color:var(--dn-text-muted);font-family:"JetBrains Mono",monospace;background:var(--dn-bg-tinted);padding:0 4px;border-radius:2px}',
    '.dn-row-time{font-size:var(--dn-font-xs);color:var(--dn-text-faint)}',
    '.dn-row-page-badge{font-size:var(--dn-font-xs);color:var(--dn-text-faint);background:var(--dn-bg-tinted);padding:0 6px;border-radius:3px;margin-left:auto}',
    '.dn-row-text{font-size:var(--dn-font-base);color:var(--dn-text);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-wrap:break-word}',
    '.dn-row-text-empty{color:var(--dn-text-muted);font-style:italic}',

    // Accordion expanded state
    '.dn-comment-row.dn-row-expanded{background:var(--dn-bg);cursor:default}',
    '.dn-comment-row.dn-row-expanded:hover{background:var(--dn-bg)}',
    '.dn-row-expand-body{display:none;margin-top:12px}',
    '.dn-row-expanded .dn-row-expand-body{display:block}',
    '.dn-row-expanded .dn-row-text{display:none}',
    '.dn-row-textarea-wrap{position:relative;background:var(--dn-bg);border-radius:6px}',
    '.dn-row-textarea-highlight{position:absolute;top:0;left:0;right:0;bottom:0;padding:8px 10px;font-size:var(--dn-font-base);font-family:inherit;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;color:var(--dn-text);pointer-events:none;overflow:hidden;border-radius:6px}',
    '.dn-row-textarea-highlight .dn-skill-hl{color:var(--dn-brand)}',
    '.dn-row-textarea{width:100%;min-height:64px;border:1px solid var(--dn-border);border-radius:6px;padding:8px 10px;font-size:var(--dn-font-base);font-family:inherit;color:transparent;caret-color:var(--dn-text);background:transparent;position:relative;z-index:1;resize:none;outline:none;transition:border-color .15s;overflow:hidden}',
    '.dn-row-textarea:focus{border-color:var(--dn-brand)}',
    '.dn-row-textarea::placeholder{color:var(--dn-text-faint)}',
    '.dn-row-actions{display:flex;justify-content:space-between;align-items:center;gap:4px;margin-top:2px}',
    '.dn-row-secondary{display:flex;align-items:center;gap:2px}',
    '.dn-row-primary{display:flex;align-items:center;gap:2px}',
    '.dn-row-btn{width:28px;height:28px;border-radius:6px;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--dn-text-muted);transition:background .15s,color .15s}',
    '.dn-row-btn:hover{background:var(--dn-bg-hover)}',
    '.dn-row-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
    '.dn-row-skills-btn svg,.dn-row-directives-btn svg{width:18px;height:18px}',
    '.dn-row-btn.dn-sec-active{background:var(--dn-bg-hover);color:var(--dn-text)}',
    '.dn-row-delete{position:absolute;top:-4px;right:0}',
    '.dn-row-delete:hover{color:var(--dn-danger)}',
    '.dn-row-done:hover{color:var(--dn-brand)}',
    '.dn-panel-skill-menu{display:none;position:absolute;background:#1a1a1a;border:1px solid rgba(255,255,255,.1);border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.3);max-height:200px;overflow-y:auto;z-index:2147483645;padding:4px}',
    '.dn-panel-skill-menu.dn-skill-menu-open{display:block}',
    '.dn-panel-skill-menu::-webkit-scrollbar{width:4px}',
    '.dn-panel-skill-menu::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px}',

    // Toast
    '.dn-toast{position:fixed;bottom:80px;right:24px;background:var(--dn-text);color:#fff;padding:8px 20px;border-radius:8px;font-size:var(--dn-font-base);font-weight:500;z-index:2147483647;opacity:0;transform:translateY(10px);transition:all .25s;pointer-events:none}',
    '.dn-toast.dn-toast-visible{opacity:1;transform:translateY(0)}',
  ].join('\n');

  function injectStyles() {
    // Load Outfit + JetBrains Mono if not already present
    if (!document.querySelector('link[href*="Outfit"]')) {
      var preconnect = document.createElement('link');
      preconnect.rel = 'preconnect';
      preconnect.href = 'https://fonts.googleapis.com';
      document.head.appendChild(preconnect);
      var preconnect2 = document.createElement('link');
      preconnect2.rel = 'preconnect';
      preconnect2.href = 'https://fonts.gstatic.com';
      preconnect2.crossOrigin = '';
      document.head.appendChild(preconnect2);
      var fonts = document.createElement('link');
      fonts.rel = 'stylesheet';
      fonts.href = 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600;700&display=swap';
      document.head.appendChild(fonts);
    }
    var s = document.createElement('style');
    s.setAttribute('data-designer-notes', 'styles');
    s.textContent = STYLES;
    document.head.appendChild(s);
  }

  // =========================================================================
  // SELECTOR ENGINE
  // =========================================================================

  var cssEscape = CSS.escape || function (s) { return s.replace(/([^\w-])/g, '\\$1'); };

  function computeSelector(el) {
    if (el.id) return '#' + cssEscape(el.id);
    var parts = [], current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.id) { parts.unshift('#' + cssEscape(current.id)); break; }
      var seg = current.tagName.toLowerCase();
      var cls = Array.from(current.classList || [])
        .filter(function (c) { return !/^(ng-|css-|sc-|jsx-|_|svelte-|astro-|dn-)/.test(c); })
        .slice(0, 2);
      if (cls.length > 0) seg += '.' + cls.map(function (c) { return cssEscape(c); }).join('.');
      var par = current.parentElement;
      if (par) {
        var sibs = Array.from(par.children).filter(function (s) { return s.tagName === current.tagName; });
        if (sibs.length > 1) seg += ':nth-child(' + (Array.from(par.children).indexOf(current) + 1) + ')';
      }
      parts.unshift(seg);
      current = current.parentElement;
    }
    if (!parts[0] || !parts[0].startsWith('#')) parts.unshift('body');
    var sel = parts.join(' > ');
    try { if (document.querySelector(sel) === el) return sel; } catch (e) {}
    return fallbackSelector(el);
  }

  function fallbackSelector(el) {
    var parts = [], current = el;
    while (current && current !== document.body && current !== document.documentElement) {
      var par = current.parentElement;
      if (!par) break;
      parts.unshift(current.tagName.toLowerCase() + ':nth-child(' + (Array.from(par.children).indexOf(current) + 1) + ')');
      current = par;
    }
    parts.unshift('body');
    return parts.join(' > ');
  }

  function getElementMeta(el) {
    var rect = el.getBoundingClientRect();
    var raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
    var isContainer = el.children.length > 2;
    var preview = raw;
    if (isContainer && raw.length > 60) {
      var fc = el.querySelector('h1,h2,h3,h4,h5,h6,p,a,button,span,label,td,li');
      preview = fc ? (fc.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 60) : raw.substring(0, 60);
    } else {
      preview = raw.substring(0, 80);
    }
    return {
      tagName: el.tagName, textPreview: preview, isContainer: isContainer,
      boundingBox: {
        x: Math.round(rect.left + window.scrollX), y: Math.round(rect.top + window.scrollY),
        width: Math.round(rect.width), height: Math.round(rect.height),
      },
    };
  }

  // =========================================================================
  // PINS
  // =========================================================================

  var pinContainer = document.createElement('div');
  pinContainer.setAttribute('data-designer-notes', 'pins');
  pinContainer.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483639;';

  var DRAG_THRESHOLD = 3;

  function renderPin(comment, animate, num) {
    var pin = document.createElement('div');
    pin.className = 'dn-pin' + (animate ? ' dn-pin-new' : '');
    pin.setAttribute('data-designer-notes', 'pin');
    pin.setAttribute('data-comment-id', comment.id);
    pin.style.pointerEvents = 'auto';
    pin.innerHTML = '<span>' + num + '</span>';

    // Check if the target element is inside a sticky/fixed ancestor
    var stickyParent = null;
    try {
      var targetEl = document.querySelector(comment.selector);
      if (targetEl) stickyParent = getStickyAncestor(targetEl);
    } catch (e) {}

    if (stickyParent) {
      // Place pin inside the sticky ancestor — it inherits sticky positioning
      var parentRect = stickyParent.getBoundingClientRect();
      pin.style.left = (comment.clickOffset.x + (comment.elementBounds ? comment.elementBounds.x - parentRect.left : 0) - 4) + 'px';
      pin.style.top = (comment.clickOffset.y + (comment.elementBounds ? comment.elementBounds.y - parentRect.top : 0) - 28) + 'px';
      // Use the target element's rect for more accurate positioning
      try {
        var targetRect = document.querySelector(comment.selector).getBoundingClientRect();
        pin.style.left = (targetRect.left - parentRect.left + comment.clickOffset.x - 4) + 'px';
        pin.style.top = (targetRect.top - parentRect.top + comment.clickOffset.y - 28) + 'px';
      } catch (e) {}
      pin.setAttribute('data-sticky', 'true');
      stickyParent.style.position = stickyParent.style.position || window.getComputedStyle(stickyParent).position;
      if (!stickyParent.style.overflow || stickyParent.style.overflow === 'hidden') {
        stickyParent.style.overflow = 'visible';
      }
      stickyParent.appendChild(pin);
    } else {
      // Normal pin — absolute to page
      pin.style.left = (comment.pagePosition.x - 4) + 'px';
      pin.style.top = (comment.pagePosition.y - 28) + 'px';
      pinContainer.appendChild(pin);
    }

    var dragState = null;

    pin.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      hidePreview();
      dragState = {
        startX: e.pageX,
        startY: e.pageY,
        dragging: false,
        origX: comment.pagePosition.x,
        origY: comment.pagePosition.y,
      };

      function onMove(ev) {
        if (!dragState) return;
        var dx = ev.pageX - dragState.startX;
        var dy = ev.pageY - dragState.startY;
        if (!dragState.dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragState.dragging = true;
        pin.classList.add('dn-pin-dragging');
        var nx = dragState.origX + dx;
        var ny = dragState.origY + dy;
        pin.style.left = (nx - 4) + 'px';
        pin.style.top = (ny - 28) + 'px';
      }

      function onUp(ev) {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        if (!dragState) return;
        if (dragState.dragging) {
          // Finalize drag — update comment position
          var dx = ev.pageX - dragState.startX;
          var dy = ev.pageY - dragState.startY;
          pushUndo('move pin');
          comment.pagePosition.x = dragState.origX + dx;
          comment.pagePosition.y = dragState.origY + dy;
          // Update clickOffset relative to the element if it still exists
          try {
            var el = document.querySelector(comment.selector);
            if (el) {
              var r = el.getBoundingClientRect();
              comment.clickOffset.x = comment.pagePosition.x - (r.left + window.scrollX);
              comment.clickOffset.y = comment.pagePosition.y - (r.top + window.scrollY);
            }
          } catch (ex) {}
          saveState();
          autoExport();
          pin.classList.remove('dn-pin-dragging');
          rerenderAllPins();
          if (state.panelOpen) renderCommentList();
          if (state.editingCommentId === comment.id) positionPopover(comment.id);
        } else {
          // Was a click, not a drag
          if (state.editingCommentId === comment.id) closePopover();
          else openPopover(comment.id);
        }
        dragState = null;
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    pin.addEventListener('mouseenter', function () {
      if (state.editingCommentId !== comment.id) showPreview(comment, num);
    });
    pin.addEventListener('mouseleave', hidePreview);
    // Pin already appended to stickyParent or pinContainer above
  }

  function rerenderAllPins() {
    // Remove all pins — both from pinContainer and from sticky ancestors
    pinContainer.innerHTML = '';
    document.querySelectorAll('.dn-pin[data-sticky]').forEach(function (p) { p.remove(); });
    pageComments().forEach(function (c, i) { renderPin(c, false, i + 1); });
    updateEditingPinState();
  }

  function repositionAllPins() {
    pageComments().forEach(function (c) {
      try {
        var el = document.querySelector(c.selector);
        if (el) {
          var r = el.getBoundingClientRect();
          c.pagePosition.x = Math.round(r.left + window.scrollX + c.clickOffset.x);
          c.pagePosition.y = Math.round(r.top + window.scrollY + c.clickOffset.y);
          c.detached = false;
        } else { c.detached = true; }
      } catch (e) { c.detached = true; }
    });
    rerenderAllPins();
    if (state.editingCommentId) positionPopover(state.editingCommentId);
  }

  // Find the nearest sticky/fixed ancestor (they create containing blocks for absolute children)
  function getStickyAncestor(el) {
    var node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      var pos = window.getComputedStyle(node).position;
      if (pos === 'sticky' || pos === 'fixed') return node;
      node = node.parentElement;
    }
    return null;
  }

  function updateEditingPinState() {
    document.querySelectorAll('.dn-pin[data-designer-notes]').forEach(function (pin) {
      var id = parseInt(pin.getAttribute('data-comment-id'));
      var c = state.comments.find(function (cm) { return cm.id === id; });
      pin.classList.toggle('dn-pin-editing', id === state.editingCommentId);
      pin.classList.toggle('dn-pin-detached', !!(c && c.detached));
    });
  }

  // =========================================================================
  // PREVIEW
  // =========================================================================

  var previewEl;
  function createPreview() {
    previewEl = document.createElement('div');
    previewEl.className = 'dn-preview';
    previewEl.setAttribute('data-designer-notes', 'preview');
    document.body.appendChild(previewEl);
  }

  function showPreview(comment, num) {
    var text = comment.text ? escapeHtml(comment.text) : '<span class="dn-preview-empty">No comment</span>';
    previewEl.innerHTML = '<div class="dn-preview-number" data-designer-notes>Comment ' + num + '</div><div data-designer-notes>' + text + '</div>';
    previewEl.style.left = (comment.pagePosition.x + 32) + 'px';
    previewEl.style.top = (comment.pagePosition.y - 28) + 'px';
    previewEl.classList.add('dn-preview-visible');
  }

  function hidePreview() { previewEl.classList.remove('dn-preview-visible'); }

  // =========================================================================
  // POPOVER — simple textarea + context + done/delete
  // =========================================================================

  var popoverEl;

  function createPopover() {
    popoverEl = document.createElement('div');
    popoverEl.className = 'dn-popover';
    popoverEl.setAttribute('data-designer-notes', 'popover');
    popoverEl.innerHTML =
      '<div class="dn-popover-header" data-designer-notes>' +
        '<div class="dn-popover-context" data-designer-notes>' +
          '<span class="dn-popover-tag" data-designer-notes></span>' +
          '<span class="dn-popover-context-text" data-designer-notes></span>' +
        '</div>' +
        '<div class="dn-popover-toolbar" data-designer-notes>' +
          '<div class="dn-popover-menu-wrap" data-designer-notes>' +
            '<button class="dn-popover-more" data-designer-notes title="More options">' +
              '<svg viewBox="0 0 24 24" data-designer-notes><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>' +
            '</button>' +
            '<div class="dn-popover-menu" data-designer-notes>' +
              '<button class="dn-popover-copy-link dn-popover-menu-item" data-designer-notes>Copy link to comment</button>' +
              '<button class="dn-popover-delete dn-popover-menu-item" data-designer-notes>Delete comment</button>' +
            '</div>' +
          '</div>' +
          '<div class="dn-popover-toolbar-divider" data-designer-notes></div>' +
          '<button class="dn-popover-close" data-designer-notes title="Close">' +
            '<svg viewBox="0 0 24 24" data-designer-notes><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="dn-popover-body" data-designer-notes>' +
        '<div class="dn-textarea-wrap" data-designer-notes>' +
          '<div class="dn-textarea-highlight" data-designer-notes></div>' +
          '<textarea class="dn-popover-textarea" data-designer-notes placeholder="What needs to change here?"></textarea>' +
        '</div>' +
      '</div>' +
      '<div class="dn-skill-menu" data-designer-notes></div>' +

      '<div class="dn-popover-footer" data-designer-notes>' +
        '<div class="dn-popover-secondary" data-designer-notes>' +
          '<button class="dn-popover-skills-btn dn-popover-sec-btn" data-designer-notes title="Insert skill command">' +
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" data-designer-notes><line x1="17" y1="4" x2="7" y2="20"/></svg>' +
          '</button>' +
          '<button class="dn-popover-directives-btn dn-popover-sec-btn" data-designer-notes title="Select model or effort">' +
            '<svg viewBox="0 0 24 24" data-designer-notes><path d="M4 8h16M4 16h16M8 4v16M16 4v16"/></svg>' +
          '</button>' +
        '</div>' +
        '<button class="dn-popover-submit" data-designer-notes title="Submit">' +
          '<svg viewBox="0 0 24 24" data-designer-notes><path d="M12 19V5M5 12l7-7 7 7"/></svg>' +
        '</button>' +
      '</div>';

    popoverEl.addEventListener('click', function (e) {
      e.stopPropagation();
      // Close menu if clicking outside it
      if (!e.target.closest('.dn-popover-menu-wrap')) {
        var m = popoverEl.querySelector('.dn-popover-menu');
        if (m) m.classList.remove('dn-popover-menu-open');
        var mb = popoverEl.querySelector('.dn-popover-more');
        if (mb) mb.classList.remove('dn-popover-more-active');
      }
    });

    popoverEl.querySelector('.dn-popover-close').addEventListener('click', function (e) {
      e.stopPropagation(); closePopover();
    });

    popoverEl.querySelector('.dn-popover-submit').addEventListener('click', function (e) {
      e.stopPropagation(); closePopover();
    });

    var menuEl = popoverEl.querySelector('.dn-popover-menu');
    var moreBtn = popoverEl.querySelector('.dn-popover-more');
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = menuEl.classList.toggle('dn-popover-menu-open');
      moreBtn.classList.toggle('dn-popover-more-active', open);
    });

    popoverEl.querySelector('.dn-popover-copy-link').addEventListener('click', function (e) {
      e.stopPropagation();
      menuEl.classList.remove('dn-popover-menu-open');
      moreBtn.classList.remove('dn-popover-more-active');
      var c = state.comments.find(function (cm) { return cm.id === state.editingCommentId; });
      if (c) {
        var pagePath = c.page === 'index' ? '' : c.page;
        var url = window.location.origin + '/' + pagePath + '#dn-' + c.id;
        navigator.clipboard.writeText(url).then(function () { showToast('Link copied'); }).catch(function () { showToast('Copy failed'); });
      }
    });

    popoverEl.querySelector('.dn-popover-delete').addEventListener('click', function (e) {
      e.stopPropagation();
      menuEl.classList.remove('dn-popover-menu-open');
      moreBtn.classList.remove('dn-popover-more-active');
      if (state.editingCommentId) {
        var idToDelete = state.editingCommentId;
        showConfirm('Are you sure you want to delete this comment?', function () {
          deleteComment(idToDelete);
        });
      }
    });

    var textarea = popoverEl.querySelector('.dn-popover-textarea');
    var autoMenu = popoverEl.querySelector('.dn-skill-menu');
    var highlightEl = popoverEl.querySelector('.dn-textarea-highlight');
    var autoActiveIndex = -1;
    var autoTrigger = null; // '/' or '#' or null
    var autoFromButton = false;
    var autoButtonFilter = null; // 'model', 'effort', or null (show all)

    function syncHighlight() {
      updateHighlight(textarea.value, highlightEl);
    }

    // Find active trigger query by walking back from cursor
    function getTriggerQuery() {
      var val = textarea.value;
      var pos = textarea.selectionStart;
      for (var i = pos - 1; i >= 0; i--) {
        if (val[i] === '/' || val[i] === '#') {
          if (i === 0 || /\s/.test(val[i - 1])) {
            return { start: i, trigger: val[i], query: val.substring(i + 1, pos).toLowerCase() };
          }
          return null;
        }
        if (/\s/.test(val[i])) return null;
      }
      return null;
    }

    function getItemsForTrigger(trigger, query) {
      if (trigger === '/') {
        return state.skills.filter(function (s) {
          return HIDDEN_SKILL_NAMES.indexOf(s.name) === -1 && s.name.toLowerCase().indexOf(query) === 0;
        });
      }
      if (trigger === '#') {
        return state.directives.filter(function (d) {
          var matchesQuery = d.name.toLowerCase().indexOf(query) === 0;
          var matchesFilter = !autoButtonFilter || d.group === autoButtonFilter;
          return matchesQuery && matchesFilter;
        });
      }
      return [];
    }

    function positionAutoMenu() {
      if (autoFromButton) {
        // Below the popover, aligned right
        autoMenu.style.top = '';
        autoMenu.style.bottom = '';
        autoMenu.style.left = '0';
        autoMenu.style.right = '8px';
        autoMenu.style.marginTop = '4px';
        // Position just below the footer
        var popH = popoverEl.offsetHeight;
        autoMenu.style.top = (popH - 4) + 'px';
      } else {
        // Below cursor line inside textarea
        var headerH = popoverEl.querySelector('.dn-popover-header').offsetHeight;
        var style = window.getComputedStyle(textarea);
        var lineHeight = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.4;
        var val = textarea.value.substring(0, textarea.selectionStart);
        var lines = val.split('\n').length;
        autoMenu.style.top = (headerH + (lines * lineHeight) + 8) + 'px';
        autoMenu.style.marginTop = '0';
      }
    }

    function renderAutoMenu(trigger, query) {
      var items = getItemsForTrigger(trigger, query);
      if (items.length === 0) { closeAutoMenu(); return; }
      autoTrigger = trigger;
      autoMenu.innerHTML = '';

      // Group directives by group header
      var lastGroup = null;
      items.forEach(function (item, i) {
        if (trigger === '#' && item.group && item.group !== lastGroup) {
          lastGroup = item.group;
          var hdr = document.createElement('div');
          hdr.className = 'dn-skill-group-hdr';
          hdr.setAttribute('data-designer-notes', 'group-hdr');
          hdr.textContent = item.group.charAt(0).toUpperCase() + item.group.slice(1);
          autoMenu.appendChild(hdr);
        }
        var el = document.createElement('button');
        el.className = 'dn-skill-item' + (i === autoActiveIndex ? ' dn-skill-active' : '');
        el.setAttribute('data-designer-notes', 'skill-item');
        el.setAttribute('data-item-name', item.name);
        el.innerHTML =
          '<span class="dn-skill-item-name" data-designer-notes>' + trigger + escapeHtml(item.name) + '</span>' +
          '<span class="dn-skill-item-desc" data-designer-notes>' + escapeHtml(item.description) + '</span>';
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selectAutoItem(item.name);
        });
        autoMenu.appendChild(el);
      });
      positionAutoMenu();
      autoMenu.classList.add('dn-skill-menu-open');
    }

    function selectAutoItem(name) {
      var tq = getTriggerQuery();
      if (!tq) return;
      var val = textarea.value;
      textarea.value = val.substring(0, tq.start) + tq.trigger + name + ' ' + val.substring(textarea.selectionStart);
      var newPos = tq.start + name.length + 2;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      closeAutoMenu();
      syncHighlight();
      autoResizeTextarea(textarea);
      textarea.focus();
    }

    function closeAutoMenu() {
      autoMenu.classList.remove('dn-skill-menu-open');
      autoActiveIndex = -1;
      autoTrigger = null;
      autoFromButton = false;
      autoButtonFilter = null;
      clearSecActive();
    }

    function openAutoMenuFromButton(trigger) {
      autoFromButton = true;
      var pos = textarea.selectionStart;
      var val = textarea.value;
      var prefix = (pos > 0 && !/\s/.test(val[pos - 1])) ? ' ' + trigger : trigger;
      textarea.value = val.substring(0, pos) + prefix + val.substring(pos);
      var newPos = pos + prefix.length;
      textarea.selectionStart = textarea.selectionEnd = newPos;
      textarea.focus();
      autoActiveIndex = 0;
      renderAutoMenu(trigger, '');
    }

    textarea.addEventListener('input', function () {
      autoResizeTextarea(textarea);
      syncHighlight();
      autoFromButton = false;
      autoButtonFilter = null;
      var tq = getTriggerQuery();
      if (tq) {
        autoActiveIndex = 0;
        renderAutoMenu(tq.trigger, tq.query);
      } else {
        closeAutoMenu();
      }
    });

    textarea.addEventListener('keydown', function (e) {
      var menuOpen = autoMenu.classList.contains('dn-skill-menu-open');
      var items = menuOpen ? autoMenu.querySelectorAll('.dn-skill-item') : [];

      if (menuOpen && items.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          autoActiveIndex = Math.min(autoActiveIndex + 1, items.length - 1);
          var tq = getTriggerQuery();
          if (tq) renderAutoMenu(tq.trigger, tq.query);
          var ai = autoMenu.querySelector('.dn-skill-active');
          if (ai) ai.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          autoActiveIndex = Math.max(autoActiveIndex - 1, 0);
          var tq2 = getTriggerQuery();
          if (tq2) renderAutoMenu(tq2.trigger, tq2.query);
          var ai2 = autoMenu.querySelector('.dn-skill-active');
          if (ai2) ai2.scrollIntoView({ block: 'nearest' });
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          var active = items[autoActiveIndex] || items[0];
          if (active) selectAutoItem(active.getAttribute('data-item-name'));
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          closeAutoMenu();
          return;
        }
      }

      if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault(); closePopover();
      }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); }
    });

    var skillsBtn = popoverEl.querySelector('.dn-popover-skills-btn');
    var directivesBtn = popoverEl.querySelector('.dn-popover-directives-btn');
    var allSecBtns = [skillsBtn, directivesBtn];

    function clearSecActive() {
      allSecBtns.forEach(function (b) { b.classList.remove('dn-sec-active'); });
    }

    function handleSecBtn(btn, trigger, filterGroup) {
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (autoFromButton && btn.classList.contains('dn-sec-active')) {
          closeAutoMenu();
        } else {
          clearSecActive(); btn.classList.add('dn-sec-active');
          autoButtonFilter = filterGroup || null;
          openAutoMenuFromButton(trigger);
        }
      });
    }

    handleSecBtn(skillsBtn, '/', null);
    handleSecBtn(directivesBtn, '#', null);

    document.body.appendChild(popoverEl);
  }

  function openPopover(commentId) {
    hidePreview();
    var c = state.comments.find(function (cm) { return cm.id === commentId; });
    if (!c) return;
    state.editingCommentId = commentId;
    popoverEl.querySelector('.dn-popover-tag').textContent = c.tagName;
    popoverEl.querySelector('.dn-popover-context-text').textContent = c.textPreview || '';
    var textarea = popoverEl.querySelector('.dn-popover-textarea');
    textarea.value = c.text;
    textarea.style.height = 'auto';
    // Sync highlight overlay
    var hl = popoverEl.querySelector('.dn-textarea-highlight');
    if (hl) updateHighlight(textarea.value, hl);
    // Resize to fit content
    setTimeout(function () { autoResizeTextarea(textarea); }, 0);
    // Hide delete on brand-new comments (no text yet)
    popoverEl.querySelector('.dn-popover-delete').style.display = c.text.trim() ? '' : 'none';
    // Close menu if left open from previous comment
    popoverEl.querySelector('.dn-popover-menu').classList.remove('dn-popover-menu-open');
    popoverEl.querySelector('.dn-popover-more').classList.remove('dn-popover-more-active');
    popoverEl.classList.remove('dn-popover-exit');
    popoverEl.classList.add('dn-popover-visible', 'dn-popover-enter');
    positionPopover(commentId);
    updateEditingPinState();
    setTimeout(function () { textarea.focus(); }, 50);
  }

  function positionPopover(commentId) {
    var c = state.comments.find(function (cm) { return cm.id === commentId; });
    if (!c) return;
    var px = c.pagePosition.x, py = c.pagePosition.y;
    popoverEl.style.left = (px + 356 > window.scrollX + window.innerWidth ? px - 328 : px + 36) + 'px';
    popoverEl.style.top = (py - 28) + 'px';
  }

  function closePopover() {
    if (!state.editingCommentId) return;
    var id = state.editingCommentId;
    var c = state.comments.find(function (cm) { return cm.id === id; });
    if (c) {
      c.text = popoverEl.querySelector('.dn-popover-textarea').value;
      if (!c.text.trim()) {
        // Empty → discard
        state.comments = state.comments.filter(function (cm) { return cm.id !== id; });
      }
      saveState();
      autoExport();
    }
    state.editingCommentId = null;
    popoverEl.classList.remove('dn-popover-enter');
    popoverEl.classList.add('dn-popover-exit');
    clearTimeout(popoverEl._hideTimer);
    popoverEl._hideTimer = setTimeout(function () {
      if (!state.editingCommentId) {
        popoverEl.classList.remove('dn-popover-visible', 'dn-popover-exit');
      }
    }, 150);
    rerenderAllPins();
    updateBadge();
    if (state.panelOpen) renderCommentList();
  }

  // =========================================================================
  // PANEL
  // =========================================================================

  var panelEl, commentListEl;

  var expandedRowId = null;

  function createPanel() {
    panelEl = document.createElement('div');
    panelEl.className = 'dn-panel';
    panelEl.setAttribute('data-designer-notes', 'panel');
    panelEl.innerHTML =
      '<div class="dn-panel-header" data-designer-notes>' +
        '<h2 class="dn-panel-title" data-designer-notes>Feedback <span class="dn-comment-count" data-designer-notes></span></h2>' +
        '<div class="dn-panel-header-actions" data-designer-notes>' +
          '<button class="dn-panel-settings" data-designer-notes title="Settings">' +
            '<svg viewBox="0 0 24 24" data-designer-notes><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>' +
          '</button>' +
          '<a class="dn-panel-changelog" href="/.designer-notes/changelog.html" target="_blank" data-designer-notes title="View changelog">' +
            '<svg viewBox="0 0 24 24" data-designer-notes><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' +
          '</a>' +
          '<button class="dn-panel-copy" data-designer-notes title="Copy as text">' +
            '<svg viewBox="0 0 24 24" data-designer-notes><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>' +
          '</button>' +
          '<button class="dn-panel-close" data-designer-notes title="Close panel">' +
            '<svg viewBox="0 0 24 24" data-designer-notes><path d="M18 6L6 18M6 6l12 12"/></svg>' +
          '</button>' +
        '</div>' +
      '</div>' +
      '<div class="dn-comment-list" data-designer-notes></div>';

    panelEl.querySelector('.dn-panel-close').addEventListener('click', closePanel);
    panelEl.querySelector('.dn-panel-settings').addEventListener('click', showSettings);
    panelEl.querySelector('.dn-panel-copy').addEventListener('click', function () {
      copyToClipboard();
    });
    commentListEl = panelEl.querySelector('.dn-comment-list');

    // Panel-level shared autocomplete menu
    var panelSkillMenu = document.createElement('div');
    panelSkillMenu.className = 'dn-panel-skill-menu';
    panelSkillMenu.setAttribute('data-designer-notes', 'panel-skill-menu');
    panelEl.appendChild(panelSkillMenu);

    // Panel autocomplete state
    var panelAutoTrigger = null;
    var panelAutoActiveIndex = -1;
    var panelAutoTargetRow = null; // { ta, commentId }

    function getPanelItemsForTrigger(trigger, query) {
      if (trigger === '/') {
        return state.skills.filter(function (s) {
          return HIDDEN_SKILL_NAMES.indexOf(s.name) === -1 && s.name.toLowerCase().indexOf(query) === 0;
        });
      }
      if (trigger === '#') {
        return state.directives.filter(function (d) {
          return d.name.toLowerCase().indexOf(query) === 0;
        });
      }
      return [];
    }

    function renderPanelAutoMenu(trigger, query) {
      var items = getPanelItemsForTrigger(trigger, query);
      if (items.length === 0) { closePanelAutoMenu(); return; }
      panelAutoTrigger = trigger;
      panelSkillMenu.innerHTML = '';

      var lastGroup = null;
      items.forEach(function (item, idx) {
        if (trigger === '#' && item.group && item.group !== lastGroup) {
          lastGroup = item.group;
          var hdr = document.createElement('div');
          hdr.className = 'dn-skill-group-hdr';
          hdr.setAttribute('data-designer-notes', 'group-hdr');
          hdr.textContent = item.group.charAt(0).toUpperCase() + item.group.slice(1);
          panelSkillMenu.appendChild(hdr);
        }
        var el = document.createElement('button');
        el.className = 'dn-skill-item' + (idx === panelAutoActiveIndex ? ' dn-skill-active' : '');
        el.setAttribute('data-designer-notes', 'skill-item');
        el.setAttribute('data-item-name', item.name);
        el.innerHTML =
          '<span class="dn-skill-item-name" data-designer-notes>' + trigger + escapeHtml(item.name) + '</span>' +
          '<span class="dn-skill-item-desc" data-designer-notes>' + escapeHtml(item.description) + '</span>';
        el.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selectPanelAutoItem(item.name);
        });
        panelSkillMenu.appendChild(el);
      });

      // Position: just below the actions bar within the panel
      positionPanelAutoMenu();
      panelSkillMenu.classList.add('dn-skill-menu-open');
    }

    function positionPanelAutoMenu() {
      if (!panelAutoTargetRow) return;
      var actionsEl = panelAutoTargetRow.ta.closest('.dn-row-expand-body').querySelector('.dn-row-actions');
      var wrap = panelAutoTargetRow.ta.closest('.dn-row-textarea-wrap');
      if (!actionsEl || !wrap) return;
      var panelRect = panelEl.getBoundingClientRect();
      var actionsRect = actionsEl.getBoundingClientRect();
      var wrapRect = wrap.getBoundingClientRect();
      // Below the actions bar, aligned with textarea edges
      panelSkillMenu.style.top = (actionsRect.bottom - panelRect.top + panelEl.scrollTop + 4) + 'px';
      panelSkillMenu.style.left = (wrapRect.left - panelRect.left) + 'px';
      panelSkillMenu.style.right = (panelRect.right - wrapRect.right) + 'px';
      panelSkillMenu.style.bottom = '';
    }

    function selectPanelAutoItem(name) {
      if (!panelAutoTargetRow) return;
      var ta = panelAutoTargetRow.ta;
      var commentId = panelAutoTargetRow.commentId;
      var val = ta.value;
      var pos = ta.selectionStart;
      // Find trigger position by walking back from cursor
      var triggerStart = -1;
      for (var i = pos - 1; i >= 0; i--) {
        if (val[i] === panelAutoTrigger) {
          if (i === 0 || /\s/.test(val[i - 1])) { triggerStart = i; break; }
          break;
        }
        if (/\s/.test(val[i])) break;
      }
      if (triggerStart === -1) { closePanelAutoMenu(); return; }
      ta.value = val.substring(0, triggerStart) + panelAutoTrigger + name + ' ' + val.substring(pos);
      var newPos = triggerStart + name.length + 2;
      ta.selectionStart = ta.selectionEnd = newPos;
      closePanelAutoMenu();
      autoResizeTextarea(ta);
      // Update highlight overlay
      var hlEl = ta.closest('.dn-row-textarea-wrap') && ta.closest('.dn-row-textarea-wrap').querySelector('.dn-row-textarea-highlight');
      if (hlEl) updateHighlight(ta.value, hlEl);
      // Persist the change
      var c = state.comments.find(function (cm) { return cm.id === commentId; });
      if (c) {
        c.text = ta.value;
        saveState();
        autoExport();
      }
      ta.focus();
    }

    function closePanelAutoMenu() {
      panelSkillMenu.classList.remove('dn-skill-menu-open');
      panelSkillMenu.innerHTML = '';
      panelAutoTrigger = null;
      panelAutoActiveIndex = -1;
      // Clear active state on all row sec buttons — walk up to the expand body
      if (panelAutoTargetRow) {
        var expandBody = panelAutoTargetRow.ta.closest('.dn-row-expand-body');
        if (expandBody) {
          expandBody.querySelectorAll('.dn-row-btn').forEach(function (b) { b.classList.remove('dn-sec-active'); });
        }
      }
      panelAutoTargetRow = null;
    }

    // Expose panel autocomplete helpers so renderCommentList can wire buttons
    panelEl._panelAuto = {
      open: function (trigger, ta, commentId, btn) {
        // If same button clicked again, close
        if (panelAutoTrigger === trigger && panelAutoTargetRow && panelAutoTargetRow.ta === ta && panelSkillMenu.classList.contains('dn-skill-menu-open')) {
          closePanelAutoMenu();
          return;
        }
        closePanelAutoMenu();
        panelAutoTargetRow = { ta: ta, commentId: commentId };
        panelAutoActiveIndex = 0;
        // Insert trigger char into textarea
        var pos = ta.selectionStart;
        var val = ta.value;
        var prefix = (pos > 0 && !/\s/.test(val[pos - 1])) ? ' ' + trigger : trigger;
        ta.value = val.substring(0, pos) + prefix + val.substring(pos);
        var newPos = pos + prefix.length;
        ta.selectionStart = ta.selectionEnd = newPos;
        ta.focus();
        // Mark button active
        if (btn) btn.classList.add('dn-sec-active');
        renderPanelAutoMenu(trigger, '');
      },
      close: closePanelAutoMenu,
      handleKeydown: function (e) {
        if (!panelSkillMenu.classList.contains('dn-skill-menu-open')) return false;
        var items = panelSkillMenu.querySelectorAll('.dn-skill-item');
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          panelAutoActiveIndex = Math.min(panelAutoActiveIndex + 1, items.length - 1);
          renderPanelAutoMenu(panelAutoTrigger, '');
          var ai = panelSkillMenu.querySelector('.dn-skill-active');
          if (ai) ai.scrollIntoView({ block: 'nearest' });
          return true;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          panelAutoActiveIndex = Math.max(panelAutoActiveIndex - 1, 0);
          renderPanelAutoMenu(panelAutoTrigger, '');
          var ai2 = panelSkillMenu.querySelector('.dn-skill-active');
          if (ai2) ai2.scrollIntoView({ block: 'nearest' });
          return true;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault();
          var active = items[panelAutoActiveIndex] || items[0];
          if (active) selectPanelAutoItem(active.getAttribute('data-item-name'));
          return true;
        }
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          closePanelAutoMenu();
          return true;
        }
        return false;
      },
    };

    // Close panel menu on outside click
    document.addEventListener('click', function (e) {
      if (!panelSkillMenu.classList.contains('dn-skill-menu-open')) return;
      if (!e.target.closest('[data-designer-notes="panel-skill-menu"]') &&
          !e.target.closest('.dn-row-skills-btn') &&
          !e.target.closest('.dn-row-directives-btn')) {
        closePanelAutoMenu();
      }
    }, false);

    document.body.appendChild(panelEl);
  }

  function openPanel() { state.panelOpen = true; panelEl.classList.add('dn-panel-open'); renderCommentList(); }
  function closePanel() {
    collapseExpandedRow();
    state.panelOpen = false;
    panelEl.classList.remove('dn-panel-open');
    rerenderAllPins();
    updateBadge();
  }

  function collapseExpandedRow() {
    if (!expandedRowId) return;
    // Close panel autocomplete if open
    if (panelEl && panelEl._panelAuto) panelEl._panelAuto.close();
    var oldRow = commentListEl.querySelector('.dn-row-expanded');
    if (oldRow) {
      var ta = oldRow.querySelector('.dn-row-textarea');
      if (ta) {
        var c = state.comments.find(function (cm) { return cm.id === expandedRowId; });
        if (c) {
          c.text = ta.value;
          if (!c.text.trim()) {
            state.comments = state.comments.filter(function (cm) { return cm.id !== expandedRowId; });
          }
          saveState();
          autoExport();
        }
      }
    }
    expandedRowId = null;
  }

  function expandRow(commentId) {
    if (expandedRowId === commentId) return;
    collapseExpandedRow();
    expandedRowId = commentId;
    renderCommentList();
    // Focus the textarea in the expanded row
    var ta = commentListEl.querySelector('.dn-row-expanded .dn-row-textarea');
    if (ta) setTimeout(function () { ta.focus(); }, 50);
  }

  function renderCommentList() {
    var all = state.comments;
    var allTextEdits = state.textEdits;
    var totalCount = all.length + allTextEdits.length;
    // Restore panel title when returning from settings
    var titleEl = panelEl.querySelector('.dn-panel-title');
    var comingFromSettings = titleEl && titleEl.textContent === 'Settings';
    if (comingFromSettings) {
      titleEl.innerHTML = 'Feedback <span class="dn-comment-count" data-designer-notes></span>';
    }
    panelEl.querySelector('.dn-comment-count').textContent = totalCount > 0 ? '(' + totalCount + ')' : '';

    if (totalCount === 0) {
      commentListEl.innerHTML =
        '<div class="dn-empty" data-designer-notes>' +
          '<svg viewBox="0 0 24 24" data-designer-notes><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>' +
          '<p data-designer-notes>No feedback yet.<br>Press <strong>C</strong> for comments, <strong>T</strong> for text edits.</p>' +
        '</div>';
      // Animate in from left when returning from settings
      if (comingFromSettings) {
        commentListEl.style.transform = 'translateX(-12px)';
        commentListEl.style.opacity = '0';
        requestAnimationFrame(function () {
          commentListEl.style.transform = '';
          commentListEl.style.opacity = '';
        });
      }
      return;
    }

    commentListEl.innerHTML = '';
    var pages = {};
    all.forEach(function (c) { if (!pages[c.page]) pages[c.page] = []; pages[c.page].push(c); });

    Object.keys(pages).forEach(function (page) {
      var hdr = document.createElement('div');
      hdr.className = 'dn-page-group';
      hdr.setAttribute('data-designer-notes', 'group');
      hdr.textContent = page;
      commentListEl.appendChild(hdr);

      pages[page].forEach(function (comment, i) {
        var isCurrent = (page === currentPage());
        var isExpanded = (comment.id === expandedRowId);
        var row = document.createElement('div');
        row.className = 'dn-comment-row' + (isExpanded ? ' dn-row-expanded' : '');
        row.setAttribute('data-designer-notes', 'row');
        row.setAttribute('tabindex', '0');

        var text = comment.text
          ? '<span class="dn-row-text" data-designer-notes>' + escapeHtml(comment.text) + '</span>'
          : '<span class="dn-row-text-empty" data-designer-notes>No comment</span>';

        var badge = !isCurrent ? '<span class="dn-row-page-badge" data-designer-notes>other page</span>' : '';

        var expandBody = '<div class="dn-row-expand-body" data-designer-notes>' +
          '<div class="dn-row-textarea-wrap" data-designer-notes>' +
            '<div class="dn-row-textarea-highlight" data-designer-notes></div>' +
            '<textarea class="dn-row-textarea" data-designer-notes placeholder="What needs to change here?">' + escapeHtml(comment.text) + '</textarea>' +
          '</div>' +
          '<div class="dn-row-actions" data-designer-notes>' +
            '<div class="dn-row-secondary" data-designer-notes>' +
              '<button class="dn-row-skills-btn dn-row-btn" data-designer-notes title="Insert skill command">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" data-designer-notes><line x1="17" y1="4" x2="7" y2="20"/></svg>' +
              '</button>' +
              '<button class="dn-row-directives-btn dn-row-btn" data-designer-notes title="Select model or effort">' +
                '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" data-designer-notes><path d="M4 8h16M4 16h16M8 4v16M16 4v16"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="dn-row-primary" data-designer-notes>' +
              '<button class="dn-row-done dn-row-btn" data-designer-notes title="Done">' +
                '<svg viewBox="0 0 24 24" data-designer-notes><polyline points="20 6 9 17 4 12"/></svg>' +
              '</button>' +
            '</div>' +
          '</div>' +
        '</div>';

        row.innerHTML =
          '<div class="dn-row-number" data-designer-notes>' + (i + 1) + '</div>' +
          '<div class="dn-row-content" data-designer-notes>' +
            '<button class="dn-row-delete dn-row-btn" data-designer-notes title="Delete">' +
              '<svg viewBox="0 0 24 24" data-designer-notes><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v8M14 10v8"/></svg>' +
            '</button>' +
            '<div class="dn-row-meta" data-designer-notes>' +
              '<span class="dn-row-tag" data-designer-notes>' + comment.tagName + '</span>' +
              '<span class="dn-row-time" data-designer-notes>' + relativeTime(comment.timestamp) + '</span>' +
              badge +
            '</div>' +
            text +
            expandBody +
          '</div>';

        if (isCurrent) {
          // Click row header area to expand/scroll
          row.addEventListener('click', function (e) {
            // Don't trigger on clicks inside the expand body (textarea, buttons)
            if (e.target.closest('.dn-row-expand-body')) return;
            // Don't trigger on delete button
            if (e.target.closest('.dn-row-delete')) return;
            scrollToComment(comment.id);
            expandRow(comment.id);
          });

          // Delete button wired for all current-page rows — with confirm dialog
          row.querySelector('.dn-row-delete').addEventListener('click', function (e) {
            e.stopPropagation();
            showConfirm('Are you sure you want to delete this comment?', function () {
              var panelAuto = panelEl._panelAuto;
              if (panelAuto) panelAuto.close();
              expandedRowId = null;
              deleteComment(comment.id);
            });
          });

          // Wire up expanded row controls
          if (isExpanded) {
            var ta = row.querySelector('.dn-row-textarea');
            var hlEl = row.querySelector('.dn-row-textarea-highlight');
            var panelAuto = panelEl._panelAuto;
            // Initialize highlight
            updateHighlight(ta.value, hlEl);
            ta.addEventListener('input', function () {
              comment.text = ta.value;
              autoResizeTextarea(ta);
              updateHighlight(ta.value, hlEl);
              saveState();
              autoExport();
            });
            autoResizeTextarea(ta);
            ta.addEventListener('keydown', function (e) {
              // Let panel autocomplete handle keys first
              if (panelAuto && panelAuto.handleKeydown(e)) return;
              if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                collapseExpandedRow();
                renderCommentList();
                rerenderAllPins();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                collapseExpandedRow();
                renderCommentList();
                rerenderAllPins();
              }
            });
            // Skills button
            row.querySelector('.dn-row-skills-btn').addEventListener('click', function (e) {
              e.stopPropagation();
              if (panelAuto) panelAuto.open('/', ta, comment.id, this);
            });
            // Directives button
            row.querySelector('.dn-row-directives-btn').addEventListener('click', function (e) {
              e.stopPropagation();
              if (panelAuto) panelAuto.open('#', ta, comment.id, this);
            });
            row.querySelector('.dn-row-done').addEventListener('click', function (e) {
              e.stopPropagation();
              if (panelAuto) panelAuto.close();
              collapseExpandedRow();
              renderCommentList();
              rerenderAllPins();
            });
          }
        } else {
          row.style.cursor = 'default';
        }
        commentListEl.appendChild(row);
      });
    });

    // Text edits section
    if (allTextEdits.length > 0) {
      var tePages = {};
      allTextEdits.forEach(function (te) { if (!tePages[te.page]) tePages[te.page] = []; tePages[te.page].push(te); });
      Object.keys(tePages).forEach(function (page) {
        var teHdr = document.createElement('div');
        teHdr.className = 'dn-page-group';
        teHdr.setAttribute('data-designer-notes', 'group');
        teHdr.textContent = page + ' — text edits';
        commentListEl.appendChild(teHdr);

        tePages[page].forEach(function (te, i) {
          var teRow = document.createElement('div');
          teRow.className = 'dn-comment-row';
          teRow.setAttribute('data-designer-notes', 'row');
          var preview = te.before.length > 40 ? te.before.substring(0, 40) + '…' : te.before;
          var afterPreview = te.after.length > 40 ? te.after.substring(0, 40) + '…' : te.after;
          teRow.innerHTML =
            '<div class="dn-row-number" data-designer-notes style="background:#3b82f6">T' + (i + 1) + '</div>' +
            '<div class="dn-row-content" data-designer-notes>' +
              '<button class="dn-row-delete dn-row-btn" data-designer-notes title="Delete">' +
                '<svg viewBox="0 0 24 24" data-designer-notes><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 10v8M14 10v8"/></svg>' +
              '</button>' +
              '<div class="dn-row-meta" data-designer-notes>' +
                '<span class="dn-row-tag" data-designer-notes>' + te.tagName + '</span>' +
                '<span class="dn-row-time" data-designer-notes>' + relativeTime(te.timestamp) + '</span>' +
              '</div>' +
              '<span class="dn-row-text" data-designer-notes>"' + escapeHtml(preview) + '" → "' + escapeHtml(afterPreview) + '"</span>' +
            '</div>';
          teRow.querySelector('.dn-row-delete').addEventListener('click', function (e) {
            e.stopPropagation();
            showConfirm('Are you sure you want to delete this text edit?', function () {
              pushUndo('delete text edit');
              state.textEdits = state.textEdits.filter(function (t) { return t.id !== te.id; });
              saveState();
              autoExport();
              rerenderAllTextIndicators();
              renderCommentList();
              updateBadge();
            });
          });
          if (page === currentPage()) {
            teRow.addEventListener('click', function (e) {
              if (e.target.closest('.dn-row-delete')) return;
              try {
                var el = document.querySelector(te.selector);
                if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              } catch (ex) {}
            });
          } else {
            teRow.style.cursor = 'default';
          }
          commentListEl.appendChild(teRow);
        });
      });
    }

    // Animate in from left when returning from settings
    if (comingFromSettings) {
      commentListEl.style.transform = 'translateX(-12px)';
      commentListEl.style.opacity = '0';
      requestAnimationFrame(function () {
        commentListEl.style.transform = '';
        commentListEl.style.opacity = '';
      });
    }
  }

  function scrollToComment(id) {
    var c = state.comments.find(function (cm) { return cm.id === id; });
    if (!c) return;
    try {
      var el = document.querySelector(c.selector);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      else window.scrollTo({ top: c.pagePosition.y - window.innerHeight / 2, behavior: 'smooth' });
    } catch (e) {
      window.scrollTo({ top: c.pagePosition.y - window.innerHeight / 2, behavior: 'smooth' });
    }
  }

  function deleteComment(id) {
    pushUndo('delete comment');
    closePopover();
    state.comments = state.comments.filter(function (cm) { return cm.id !== id; });
    saveState();
    autoExport();
    rerenderAllPins();
    if (state.panelOpen) renderCommentList();
    updateBadge();
  }

  // =========================================================================
  // INTERACTION HANDLERS
  // =========================================================================

  var toggleBtn, badgeEl, textToggleBtn, moreBtn, inspectBtn;

  function createToggle() {
    toggleBtn = document.createElement('button');
    toggleBtn.className = 'dn-toggle';
    toggleBtn.setAttribute('data-designer-notes', 'toggle');
    toggleBtn.setAttribute('title', 'Comment mode (C)');
    toggleBtn.innerHTML =
      '<svg viewBox="0 0 24 24" data-designer-notes><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';
    toggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleCritMode();
    });
    document.body.appendChild(toggleBtn);

    // Dedicated text edit toggle button
    textToggleBtn = document.createElement('button');
    textToggleBtn.className = 'dn-text-toggle';
    textToggleBtn.setAttribute('data-designer-notes', 'text-toggle');
    textToggleBtn.setAttribute('title', 'Text edit mode (T)');
    textToggleBtn.innerHTML =
      '<svg viewBox="0 0 24 24" data-designer-notes><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>';
    textToggleBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleTextEditMode();
    });
    document.body.appendChild(textToggleBtn);

    // Inspect mode toggle button
    inspectBtn = document.createElement('button');
    inspectBtn.className = 'dn-inspect-toggle';
    inspectBtn.setAttribute('data-designer-notes', 'inspect-toggle');
    inspectBtn.setAttribute('title', 'Inspect mode (I)');
    inspectBtn.innerHTML =
      '<svg viewBox="0 0 24 24" data-designer-notes><circle cx="12" cy="12" r="10"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><circle cx="12" cy="12" r="2"/></svg>';
    inspectBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleInspectMode();
    });
    document.body.appendChild(inspectBtn);

    // More button — opens the panel
    moreBtn = document.createElement('button');
    moreBtn.className = 'dn-more-toggle';
    moreBtn.setAttribute('data-designer-notes', 'more-toggle');
    moreBtn.setAttribute('title', 'Open panel');
    moreBtn.innerHTML =
      '<svg viewBox="0 0 24 24" data-designer-notes><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>' +
      '<span class="dn-badge" data-designer-notes data-count="0"></span>';
    badgeEl = moreBtn.querySelector('.dn-badge');
    moreBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (state.panelOpen) closePanel();
      else openPanel();
    });
    document.body.appendChild(moreBtn);
  }

  function toggleCritMode() {
    // Deactivate inspect mode
    if (state.inspectMode) {
      state.inspectMode = false;
      document.body.classList.remove('dn-inspect-mode');
      inspectBtn.classList.remove('dn-active');
      clearInspectHover();
      closeInspectPanel();
    }
    // Deactivate text edit mode without re-entering toggleCritMode
    if (state.textEditMode) {
      if (state.activeTextEdit) dismissTextEdit();
      state.textEditMode = false;
      document.body.classList.remove('dn-text-edit-mode');
      clearTextHover();
    }
    state.critMode = !state.critMode;
    document.body.classList.toggle('dn-crit-mode', state.critMode);
    toggleBtn.classList.toggle('dn-active', state.critMode);
    if (!state.critMode) closePopover();
    updateToggleButton();
  }

  function toggleTextEditMode() {
    // Deactivate inspect mode
    if (state.inspectMode) {
      state.inspectMode = false;
      document.body.classList.remove('dn-inspect-mode');
      inspectBtn.classList.remove('dn-active');
      clearInspectHover();
      closeInspectPanel();
    }
    // Deactivate crit mode without re-entering toggleTextEditMode
    if (state.critMode) {
      state.critMode = false;
      document.body.classList.remove('dn-crit-mode');
      toggleBtn.classList.remove('dn-active');
      closePopover();
    }
    if (state.activeTextEdit) dismissTextEdit();
    state.textEditMode = !state.textEditMode;
    document.body.classList.toggle('dn-text-edit-mode', state.textEditMode);
    if (!state.textEditMode) clearTextHover();
    updateToggleButton();
  }

  function updateToggleButton() {
    if (!toggleBtn) return;
    toggleBtn.classList.toggle('dn-active', state.critMode);
    // Update dedicated text toggle button
    if (textToggleBtn) textToggleBtn.classList.toggle('dn-active', state.textEditMode);
    if (inspectBtn) inspectBtn.classList.toggle('dn-active', state.inspectMode);
  }

  function toggleInspectMode() {
    // Deactivate comment mode
    if (state.critMode) {
      state.critMode = false;
      document.body.classList.remove('dn-crit-mode');
      toggleBtn.classList.remove('dn-active');
      closePopover();
    }
    // Deactivate text edit mode
    if (state.textEditMode) {
      if (state.activeTextEdit) dismissTextEdit();
      state.textEditMode = false;
      document.body.classList.remove('dn-text-edit-mode');
      clearTextHover();
    }
    state.inspectMode = !state.inspectMode;
    document.body.classList.toggle('dn-inspect-mode', state.inspectMode);
    inspectBtn.classList.toggle('dn-active', state.inspectMode);
    if (!state.inspectMode) {
      clearInspectHover();
      closeInspectPanel();
      deselectInspectTarget();
    }
    updateToggleButton();
  }

  // =========================================================================
  // INSPECT MODE — HOVER & SELECTION
  // =========================================================================

  var inspectHoverOutline = null;
  var inspectHoverLabel = null;
  var inspectSelectOutline = null;
  var inspectCorners = [];
  var inspectPanelEl = null;

  function createInspectOverlays() {
    inspectHoverOutline = document.createElement('div');
    inspectHoverOutline.className = 'dn-inspect-hover-outline';
    inspectHoverOutline.setAttribute('data-designer-notes', '1');
    inspectHoverOutline.style.display = 'none';
    document.body.appendChild(inspectHoverOutline);

    inspectHoverLabel = document.createElement('div');
    inspectHoverLabel.className = 'dn-inspect-hover-label';
    inspectHoverLabel.setAttribute('data-designer-notes', '1');
    inspectHoverLabel.style.display = 'none';
    document.body.appendChild(inspectHoverLabel);

    inspectSelectOutline = document.createElement('div');
    inspectSelectOutline.className = 'dn-inspect-select-outline';
    inspectSelectOutline.setAttribute('data-designer-notes', '1');
    inspectSelectOutline.style.display = 'none';
    document.body.appendChild(inspectSelectOutline);

    for (var i = 0; i < 4; i++) {
      var corner = document.createElement('div');
      corner.className = 'dn-inspect-corner';
      corner.setAttribute('data-designer-notes', '1');
      corner.style.display = 'none';
      document.body.appendChild(corner);
      inspectCorners.push(corner);
    }
  }

  function isInspectExcluded(el) {
    if (!el || el === document.body || el === document.documentElement) return true;
    if (el.tagName === 'HEAD' || el.tagName === 'HTML' || el.tagName === 'BODY') return true;
    if (el.hasAttribute && el.hasAttribute('data-designer-notes')) return true;
    if (el.closest && el.closest('[data-designer-notes]')) return true;
    return false;
  }

  function getElementLabel(el) {
    var label = el.tagName.toLowerCase();
    var classes = [];
    if (el.classList) {
      for (var i = 0; i < el.classList.length && classes.length < 2; i++) {
        var c = el.classList[i];
        if (!/^(ng-|css-|sc-|jsx-|_|svelte-|astro-|dn-)/.test(c)) {
          classes.push('.' + c);
        }
      }
    }
    return label + classes.join('');
  }

  function handleInspectHover(e) {
    if (!state.inspectMode) return;
    var target = e.target;
    if (isInspectExcluded(target)) {
      clearInspectHover();
      return;
    }
    var rect = target.getBoundingClientRect();
    inspectHoverOutline.style.display = 'block';
    inspectHoverOutline.style.left = (rect.left + window.scrollX) + 'px';
    inspectHoverOutline.style.top = (rect.top + window.scrollY) + 'px';
    inspectHoverOutline.style.width = rect.width + 'px';
    inspectHoverOutline.style.height = rect.height + 'px';

    inspectHoverLabel.style.display = 'block';
    inspectHoverLabel.textContent = getElementLabel(target);
    inspectHoverLabel.style.left = (rect.left + window.scrollX) + 'px';
    inspectHoverLabel.style.top = (rect.top + window.scrollY - 22) + 'px';
  }

  function clearInspectHover() {
    if (inspectHoverOutline) inspectHoverOutline.style.display = 'none';
    if (inspectHoverLabel) inspectHoverLabel.style.display = 'none';
  }

  function handleInspectClick(e) {
    if (!state.inspectMode) return;
    var target = e.target;
    if (isInspectExcluded(target)) return;

    e.preventDefault();
    e.stopPropagation();

    clearInspectHover();
    selectInspectTarget(target);
  }

  function selectInspectTarget(el) {
    deselectInspectTarget();

    var selector = computeSelector(el);
    var meta = getElementMeta(el);

    state.inspectTarget = {
      element: el,
      selector: selector,
      meta: meta,
    };

    var rect = el.getBoundingClientRect();
    var sx = rect.left + window.scrollX;
    var sy = rect.top + window.scrollY;

    inspectSelectOutline.style.display = 'block';
    inspectSelectOutline.style.left = sx + 'px';
    inspectSelectOutline.style.top = sy + 'px';
    inspectSelectOutline.style.width = rect.width + 'px';
    inspectSelectOutline.style.height = rect.height + 'px';

    var positions = [
      [sx - 4, sy - 4],
      [sx + rect.width - 4, sy - 4],
      [sx - 4, sy + rect.height - 4],
      [sx + rect.width - 4, sy + rect.height - 4],
    ];
    for (var i = 0; i < 4; i++) {
      inspectCorners[i].style.display = 'block';
      inspectCorners[i].style.left = positions[i][0] + 'px';
      inspectCorners[i].style.top = positions[i][1] + 'px';
    }

    openInspectPanel(el, selector, meta);
    startInspectScrollTracking();
  }

  function deselectInspectTarget() {
    state.inspectTarget = null;
    if (inspectSelectOutline) inspectSelectOutline.style.display = 'none';
    inspectCorners.forEach(function (c) { c.style.display = 'none'; });
    stopInspectScrollTracking();
  }

  var inspectScrollHandler = null;

  function updateInspectOverlayPositions() {
    if (!state.inspectTarget) return;
    var el = state.inspectTarget.element;
    var rect = el.getBoundingClientRect();
    var sx = rect.left + window.scrollX;
    var sy = rect.top + window.scrollY;

    inspectSelectOutline.style.left = sx + 'px';
    inspectSelectOutline.style.top = sy + 'px';
    inspectSelectOutline.style.width = rect.width + 'px';
    inspectSelectOutline.style.height = rect.height + 'px';

    var positions = [
      [sx - 4, sy - 4],
      [sx + rect.width - 4, sy - 4],
      [sx - 4, sy + rect.height - 4],
      [sx + rect.width - 4, sy + rect.height - 4],
    ];
    for (var i = 0; i < 4; i++) {
      inspectCorners[i].style.left = positions[i][0] + 'px';
      inspectCorners[i].style.top = positions[i][1] + 'px';
    }

    // Side panel is CSS-fixed, no repositioning needed
  }

  function startInspectScrollTracking() {
    if (inspectScrollHandler) return;
    inspectScrollHandler = updateInspectOverlayPositions;
    window.addEventListener('scroll', inspectScrollHandler, true);
    window.addEventListener('resize', inspectScrollHandler, false);
  }

  function stopInspectScrollTracking() {
    if (inspectScrollHandler) {
      window.removeEventListener('scroll', inspectScrollHandler, true);
      window.removeEventListener('resize', inspectScrollHandler, false);
      inspectScrollHandler = null;
    }
  }

  function closeInspectPanel() {
    if (inspectPanelEl) {
      inspectPanelEl.remove();
      inspectPanelEl = null;
    }
  }

  // Stub — will be implemented in Task 4
  function openInspectPanel(el, selector, meta) {
    var isFirstOpen = !inspectPanelEl;
    closeInspectPanel();

    var panel = document.createElement('div');
    panel.className = 'dn-inspect-panel' + (isFirstOpen ? ' dn-inspect-panel-enter' : '');
    panel.setAttribute('data-designer-notes', '1');

    // Header
    var header = document.createElement('div');
    header.className = 'dn-inspect-panel-header';

    var tagInfo = document.createElement('div');
    tagInfo.className = 'dn-inspect-panel-tag';
    var tagName = document.createElement('span');
    tagName.className = 'dn-inspect-panel-tag-name';
    tagName.textContent = el.tagName.toLowerCase();
    tagInfo.appendChild(tagName);

    var classes = getElementLabel(el).split('.').slice(1);
    if (classes.length > 0) {
      var tagClass = document.createElement('span');
      tagClass.className = 'dn-inspect-panel-tag-class';
      tagClass.textContent = '.' + classes.join('.');
      tagInfo.appendChild(tagClass);
    }

    var actions = document.createElement('div');
    actions.className = 'dn-inspect-panel-actions';

    var revertBtn = document.createElement('button');
    revertBtn.className = 'dn-inspect-panel-btn dn-inspect-revert-btn';
    revertBtn.title = 'Revert changes';
    revertBtn.textContent = '↩';
    revertBtn.style.display = 'none';
    revertBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleRevertElement();
    });

    var closeBtn = document.createElement('button');
    closeBtn.className = 'dn-inspect-panel-btn';
    closeBtn.title = 'Close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeInspectPanel();
      deselectInspectTarget();
    });

    actions.appendChild(revertBtn);
    actions.appendChild(closeBtn);
    header.appendChild(tagInfo);
    header.appendChild(actions);
    panel.appendChild(header);

    // Build sections
    var computed = window.getComputedStyle(el);
    var rect = el.getBoundingClientRect();

    buildPositionSection(panel, el, rect);
    buildSizeSection(panel, el, computed);
    buildPaddingSection(panel, el, computed);
    buildMarginSection(panel, el, computed);
    buildLayoutSection(panel, el, computed);
    buildAppearanceSection(panel, el, computed);
    buildTypographySection(panel, el, computed);
    buildEffectsSection(panel, el, computed);

    document.body.appendChild(panel);
    inspectPanelEl = panel;
    updateRevertButton(selector);
  }

  function refreshInspectPanel() {
    if (!state.inspectTarget || !inspectPanelEl) return;
    var el = state.inspectTarget.element;
    var selector = state.inspectTarget.selector;
    var meta = state.inspectTarget.meta;
    closeInspectPanel();
    openInspectPanel(el, selector, meta);
  }

  function toggleRevertElement() {
    if (!state.inspectTarget) return;
    var selector = state.inspectTarget.selector;
    var el = state.inspectTarget.element;

    var edit = state.cssEdits.find(function (e) {
      return e.selector === selector && e.page === currentPage();
    });
    if (!edit) return;

    pushUndo('css revert');

    if (edit.reverted) {
      edit.changes.forEach(function (c) {
        if (c.property === 'position' && c.type === 'move') {
          var dx = c.after.x - c.before.x;
          var dy = c.after.y - c.before.y;
          el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
        } else {
          el.style.setProperty(c.property, c.after);
        }
      });
      edit.reverted = false;
    } else {
      edit.changes.forEach(function (c) {
        if (c.property === 'position' && c.type === 'move') {
          el.style.removeProperty('transform');
        } else if (inspectOriginalValues[selector] && inspectOriginalValues[selector][c.property] === c.before) {
          el.style.removeProperty(c.property);
        } else {
          el.style.setProperty(c.property, c.before);
        }
      });
      edit.reverted = true;
    }

    updateRevertButton(selector);
    refreshInspectPanel();
    saveState();
    autoExport();
  }

  function updateRevertButton(selector) {
    if (!inspectPanelEl) return;
    var btn = inspectPanelEl.querySelector('.dn-inspect-revert-btn');
    if (!btn) return;
    var edit = state.cssEdits.find(function (e) {
      return e.selector === selector && e.page === currentPage();
    });
    if (edit && edit.changes.length > 0) {
      btn.style.display = 'flex';
      btn.textContent = edit.reverted ? '↪' : '↩';
      btn.title = edit.reverted ? 'Re-apply changes' : 'Revert changes';
    } else {
      btn.style.display = 'none';
    }
  }

  // =========================================================================
  // INSPECT MODE — V2 SECTION BUILDERS
  // =========================================================================

  function createInspectSection(labelText, cssHint) {
    var section = document.createElement('div');
    section.className = 'dn-inspect-section';

    var label = document.createElement('div');
    label.className = 'dn-inspect-section-label';
    var labelSpan = document.createElement('span');
    labelSpan.textContent = labelText;
    label.appendChild(labelSpan);
    if (cssHint) {
      var hint = document.createElement('span');
      hint.className = 'dn-inspect-css-hint';
      hint.textContent = cssHint;
      label.appendChild(hint);
    }

    var body = document.createElement('div');
    body.className = 'dn-inspect-section-body';

    label.addEventListener('click', function () {
      section.classList.toggle('collapsed');
    });

    section.appendChild(label);
    section.appendChild(body);
    return { section: section, body: body, collapse: function () { section.classList.add('collapsed'); } };
  }

  function createCompactInput(labelText, value, opts) {
    opts = opts || {};
    var field = document.createElement('div');
    field.className = opts.inline ? 'dn-inspect-field-inline' : 'dn-inspect-field';

    var lbl = document.createElement('span');
    lbl.className = 'dn-inspect-field-label';
    lbl.textContent = labelText;
    field.appendChild(lbl);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dn-inspect-input';
    if (opts.dimmed) input.classList.add('dimmed');
    input.value = value;
    if (opts.readOnly) input.readOnly = true;

    var originalValue = value;

    if (!opts.readOnly) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          var parsed = parseNumericValue(input.value);
          if (!parsed) return;
          var step = e.shiftKey ? 10 : 1;
          if (parsed.unit === '' && (opts.prop === 'opacity')) {
            step = e.shiftKey ? 0.1 : 0.01;
          } else if (parsed.unit === '' && opts.prop !== 'font-weight') {
            step = e.shiftKey ? 1 : 0.1;
          }
          var dir = e.key === 'ArrowUp' ? 1 : -1;
          var newNum = Math.round((parsed.num + step * dir) * 100) / 100;
          input.value = newNum + parsed.unit;
          if (opts.onChange) opts.onChange(input.value);
        }
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') {
          e.preventDefault();
          input.value = originalValue;
          if (opts.onChange) opts.onChange(originalValue);
          input.blur();
        }
        e.stopPropagation();
      });

      input.addEventListener('change', function () {
        if (opts.onChange) opts.onChange(input.value);
      });

      input.addEventListener('focus', function () { state.inspectEditingValue = true; });
      input.addEventListener('blur', function () { state.inspectEditingValue = false; });
    }

    field.appendChild(input);
    return field;
  }

  function createSpacingInput(value, opts) {
    opts = opts || {};
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dn-inspect-spacing-input';
    if (opts.dimmed) input.classList.add('dimmed');
    input.value = parseInt(value, 10) || 0;
    var originalValue = value;

    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        var cur = parseInt(input.value, 10) || 0;
        var step = e.shiftKey ? 10 : 1;
        var dir = e.key === 'ArrowUp' ? 1 : -1;
        var newNum = Math.max(0, cur + step * dir);
        input.value = newNum;
        if (opts.onChange) opts.onChange(newNum + (opts.unit || 'px'));
      }
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        input.value = parseInt(originalValue, 10) || 0;
        if (opts.onChange) opts.onChange(originalValue);
        input.blur();
      }
      e.stopPropagation();
    });

    input.addEventListener('change', function () {
      var val = input.value;
      if (!/px|rem|em|%/.test(val)) val = val + (opts.unit || 'px');
      if (opts.onChange) opts.onChange(val);
    });

    input.addEventListener('focus', function () { state.inspectEditingValue = true; });
    input.addEventListener('blur', function () { state.inspectEditingValue = false; });

    return input;
  }

  function createEnumInput(currentValue, options, onChange) {
    var select = document.createElement('select');
    select.className = 'dn-inspect-select';
    var originalValue = currentValue;

    if (options.indexOf(currentValue) === -1) {
      var opt = document.createElement('option');
      opt.value = currentValue;
      opt.textContent = currentValue;
      select.appendChild(opt);
    }
    options.forEach(function (val) {
      var opt = document.createElement('option');
      opt.value = val;
      opt.textContent = val;
      if (val === currentValue) opt.selected = true;
      select.appendChild(opt);
    });

    select.addEventListener('change', function () { onChange(select.value); });
    select.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        select.value = originalValue;
        onChange(originalValue);
        select.blur();
      }
      e.stopPropagation();
    });
    select.addEventListener('focus', function () { state.inspectEditingValue = true; });
    select.addEventListener('blur', function () { state.inspectEditingValue = false; });

    return select;
  }

  function createEnumField(labelText, currentValue, options, onChange) {
    var field = document.createElement('div');
    field.className = 'dn-inspect-field';
    var lbl = document.createElement('span');
    lbl.className = 'dn-inspect-field-label';
    lbl.textContent = labelText;
    field.appendChild(lbl);
    if (options) {
      field.appendChild(createEnumInput(currentValue, options, onChange));
    } else {
      // Numeric input for gap etc.
      var input = document.createElement('input');
      input.type = 'text';
      input.className = 'dn-inspect-input';
      input.value = currentValue;
      var orig = currentValue;
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          var parsed = parseNumericValue(input.value);
          if (!parsed) return;
          var step = e.shiftKey ? 10 : 1;
          var dir = e.key === 'ArrowUp' ? 1 : -1;
          input.value = Math.max(0, parsed.num + step * dir) + parsed.unit;
          onChange(input.value);
        }
        if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        if (e.key === 'Escape') { input.value = orig; onChange(orig); input.blur(); }
        e.stopPropagation();
      });
      input.addEventListener('change', function () { onChange(input.value); });
      input.addEventListener('focus', function () { state.inspectEditingValue = true; });
      input.addEventListener('blur', function () { state.inspectEditingValue = false; });
      field.appendChild(input);
    }
    return field;
  }

  function createColorInput(value, onChange) {
    var wrapper = document.createElement('div');
    wrapper.className = 'dn-inspect-color-controls';
    var originalValue = value;

    var chip = document.createElement('div');
    chip.className = 'dn-inspect-color-chip';
    chip.style.backgroundColor = value;
    var picker = document.createElement('input');
    picker.type = 'color';
    picker.value = rgbToHex(value);
    chip.appendChild(picker);

    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'dn-inspect-input';
    input.value = rgbToHex(value);

    picker.addEventListener('input', function () {
      input.value = picker.value;
      chip.style.backgroundColor = picker.value;
      onChange(picker.value);
    });

    input.addEventListener('change', function () {
      chip.style.backgroundColor = input.value;
      try { picker.value = rgbToHex(input.value); } catch (e) {}
      onChange(input.value);
    });

    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        input.value = rgbToHex(originalValue);
        chip.style.backgroundColor = originalValue;
        onChange(originalValue);
        input.blur();
      }
      if (e.key === 'Enter') input.blur();
      e.stopPropagation();
    });

    input.addEventListener('focus', function () { state.inspectEditingValue = true; });
    input.addEventListener('blur', function () { state.inspectEditingValue = false; });

    wrapper.appendChild(chip);
    wrapper.appendChild(input);
    return wrapper;
  }

  // --- Position Section ---

  function buildPositionSection(panel, el, rect) {
    var s = createInspectSection('POSITION');
    var grid = document.createElement('div');
    grid.className = 'dn-inspect-grid';

    var x = Math.round(rect.left + window.scrollX);
    var y = Math.round(rect.top + window.scrollY);
    var selector = state.inspectTarget ? state.inspectTarget.selector : '';

    grid.appendChild(createCompactInput('X', x, {
      inline: true,
      onChange: function (val) {
        var newX = parseInt(val, 10);
        if (isNaN(newX)) return;
        var deltaX = newX - x;
        var deltaY = 0;
        var edit = state.cssEdits.find(function (e) {
          return e.selector === selector && e.page === currentPage();
        });
        if (edit) {
          var posChange = edit.changes.find(function (c) { return c.property === 'position'; });
          if (posChange) deltaY = posChange.after.y - posChange.before.y;
        }
        recordPositionEdit(selector, el, { x: x, y: y }, { x: newX, y: y + deltaY });
        el.style.transform = 'translate(' + deltaX + 'px, ' + deltaY + 'px)';
        saveState();
        autoExport();
      },
    }));

    grid.appendChild(createCompactInput('Y', y, {
      inline: true,
      onChange: function (val) {
        var newY = parseInt(val, 10);
        if (isNaN(newY)) return;
        var deltaX = 0;
        var deltaY = newY - y;
        var edit = state.cssEdits.find(function (e) {
          return e.selector === selector && e.page === currentPage();
        });
        if (edit) {
          var posChange = edit.changes.find(function (c) { return c.property === 'position'; });
          if (posChange) deltaX = posChange.after.x - posChange.before.x;
        }
        recordPositionEdit(selector, el, { x: x, y: y }, { x: x + deltaX, y: newY });
        el.style.transform = 'translate(' + deltaX + 'px, ' + deltaY + 'px)';
        saveState();
        autoExport();
      },
    }));

    s.body.appendChild(grid);
    panel.appendChild(s.section);
  }

  function recordPositionEdit(selector, el, before, after) {
    if (!state.inspectTarget) return;
    pushUndo('css edit');

    var existing = state.cssEdits.find(function (e) {
      return e.selector === selector && e.page === currentPage();
    });

    var posChange = { property: 'position', type: 'move', before: before, after: after };

    if (existing) {
      var change = existing.changes.find(function (c) { return c.property === 'position'; });
      if (change) {
        change.after = after;
      } else {
        existing.changes.push(posChange);
      }
      existing.timestamp = new Date().toISOString();
    } else {
      var meta = state.inspectTarget.meta;
      state.cssEdits.push({
        id: state.nextCssEditId++,
        selector: selector,
        tag: el.tagName,
        textPreview: meta.textPreview || '',
        page: currentPage(),
        bounds: meta.boundingBox,
        reverted: false,
        changes: [posChange],
        timestamp: new Date().toISOString(),
      });
    }

    updateRevertButton(selector);
  }

  // --- Size Section ---

  function buildSizeSection(panel, el, computed) {
    var s = createInspectSection('SIZE');
    var grid = document.createElement('div');
    grid.className = 'dn-inspect-grid';

    grid.appendChild(createCompactInput('W', computed.width, {
      inline: true, prop: 'width',
      onChange: function (val) { applyInspectValue(el, 'width', val, computed.width); },
    }));
    grid.appendChild(createCompactInput('H', computed.height, {
      inline: true, prop: 'height',
      onChange: function (val) { applyInspectValue(el, 'height', val, computed.height); },
    }));

    s.body.appendChild(grid);

    var grid2 = document.createElement('div');
    grid2.className = 'dn-inspect-grid';
    grid2.style.marginTop = '6px';

    var rotation = computed.transform;
    var rotDeg = '0°';
    if (rotation && rotation !== 'none') {
      var match = rotation.match(/matrix\(([^,]+),\s*([^,]+)/);
      if (match) {
        rotDeg = Math.round(Math.atan2(parseFloat(match[2]), parseFloat(match[1])) * 180 / Math.PI) + '°';
      }
    }

    grid2.appendChild(createCompactInput('⟳', rotDeg, { inline: true, readOnly: true }));
    grid2.appendChild(createCompactInput('◼', computed.borderRadius, {
      inline: true, prop: 'border-radius',
      dimmed: computed.borderRadius === '0px',
      onChange: function (val) { applyInspectValue(el, 'border-radius', val, computed.borderRadius); },
    }));

    s.body.appendChild(grid2);
    panel.appendChild(s.section);
  }

  // --- Padding Section ---

  function buildPaddingSection(panel, el, computed) {
    var s = createInspectSection('PADDING');
    var layout = document.createElement('div');
    layout.className = 'dn-inspect-spacing';

    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    var values = sides.map(function (side) { return computed.getPropertyValue('padding-' + side.toLowerCase()); });

    layout.appendChild(createSpacingInput(values[0], {
      dimmed: values[0] === '0px',
      onChange: function (val) { applyInspectValue(el, 'padding-top', val, values[0]); },
    }));

    var midRow = document.createElement('div');
    midRow.className = 'dn-inspect-spacing-row';
    midRow.appendChild(createSpacingInput(values[3], {
      dimmed: values[3] === '0px',
      onChange: function (val) { applyInspectValue(el, 'padding-left', val, values[3]); },
    }));
    var centerBox = document.createElement('div');
    centerBox.className = 'dn-inspect-spacing-center padding-box';
    midRow.appendChild(centerBox);
    midRow.appendChild(createSpacingInput(values[1], {
      dimmed: values[1] === '0px',
      onChange: function (val) { applyInspectValue(el, 'padding-right', val, values[1]); },
    }));
    layout.appendChild(midRow);

    layout.appendChild(createSpacingInput(values[2], {
      dimmed: values[2] === '0px',
      onChange: function (val) { applyInspectValue(el, 'padding-bottom', val, values[2]); },
    }));

    s.body.appendChild(layout);
    panel.appendChild(s.section);
  }

  // --- Margin Section ---

  function buildMarginSection(panel, el, computed) {
    var s = createInspectSection('MARGIN');
    var layout = document.createElement('div');
    layout.className = 'dn-inspect-spacing';

    var sides = ['Top', 'Right', 'Bottom', 'Left'];
    var values = sides.map(function (side) { return computed.getPropertyValue('margin-' + side.toLowerCase()); });

    layout.appendChild(createSpacingInput(values[0], {
      dimmed: values[0] === '0px',
      onChange: function (val) { applyInspectValue(el, 'margin-top', val, values[0]); },
    }));

    var midRow = document.createElement('div');
    midRow.className = 'dn-inspect-spacing-row';
    midRow.appendChild(createSpacingInput(values[3], {
      dimmed: values[3] === '0px',
      onChange: function (val) { applyInspectValue(el, 'margin-left', val, values[3]); },
    }));
    var centerBox = document.createElement('div');
    centerBox.className = 'dn-inspect-spacing-center margin-box';
    midRow.appendChild(centerBox);
    midRow.appendChild(createSpacingInput(values[1], {
      dimmed: values[1] === '0px',
      onChange: function (val) { applyInspectValue(el, 'margin-right', val, values[1]); },
    }));
    layout.appendChild(midRow);

    layout.appendChild(createSpacingInput(values[2], {
      dimmed: values[2] === '0px',
      onChange: function (val) { applyInspectValue(el, 'margin-bottom', val, values[2]); },
    }));

    s.body.appendChild(layout);
    panel.appendChild(s.section);
  }

  // --- Layout Section ---

  function buildLayoutSection(panel, el, computed) {
    var display = computed.display;
    if (!/^(flex|grid|inline-flex|inline-grid)$/.test(display)) return;

    var s = createInspectSection('LAYOUT', 'display');
    var grid = document.createElement('div');
    grid.className = 'dn-inspect-grid';

    grid.appendChild(createEnumField('gap', computed.gap === 'normal' ? '0' : computed.gap, null, function (val) {
      applyInspectValue(el, 'gap', val, computed.gap);
    }));

    if (/^(flex|inline-flex)$/.test(display)) {
      grid.appendChild(createEnumField('direction', computed.flexDirection, ['row','row-reverse','column','column-reverse'], function (val) {
        applyInspectValue(el, 'flex-direction', val, computed.flexDirection);
      }));
    }

    grid.appendChild(createEnumField('justify', computed.justifyContent, ['flex-start','flex-end','center','space-between','space-around','space-evenly'], function (val) {
      applyInspectValue(el, 'justify-content', val, computed.justifyContent);
    }));

    grid.appendChild(createEnumField('align', computed.alignItems, ['stretch','flex-start','flex-end','center','baseline'], function (val) {
      applyInspectValue(el, 'align-items', val, computed.alignItems);
    }));
    grid.appendChild(alignField);

    s.body.appendChild(grid);
    panel.appendChild(s.section);
  }

  // --- Appearance Section ---

  function buildAppearanceSection(panel, el, computed) {
    var s = createInspectSection('APPEARANCE');

    var fillRow = document.createElement('div');
    fillRow.className = 'dn-inspect-color-row';
    var fillLabel = document.createElement('span');
    fillLabel.className = 'dn-inspect-field-label';
    fillLabel.textContent = 'fill';
    fillRow.appendChild(fillLabel);
    fillRow.appendChild(createColorInput(computed.backgroundColor, function (val) {
      applyInspectValue(el, 'background-color', val, computed.backgroundColor);
    }));
    s.body.appendChild(fillRow);

    if (computed.borderTopStyle !== 'none') {
      var strokeRow = document.createElement('div');
      strokeRow.className = 'dn-inspect-color-row';
      strokeRow.style.marginTop = '6px';
      var strokeLabel = document.createElement('span');
      strokeLabel.className = 'dn-inspect-field-label';
      strokeLabel.textContent = 'stroke';
      strokeRow.appendChild(strokeLabel);
      var strokeControls = document.createElement('div');
      strokeControls.style.display = 'flex';
      strokeControls.style.alignItems = 'center';
      strokeControls.style.gap = '6px';
      strokeControls.appendChild(createColorInput(computed.borderTopColor, function (val) {
        applyInspectValue(el, 'border-color', val, computed.borderTopColor);
      }));
      var widthInp = document.createElement('input');
      widthInp.type = 'text';
      widthInp.className = 'dn-inspect-input';
      widthInp.style.width = '40px';
      widthInp.style.flexShrink = '0';
      widthInp.value = computed.borderTopWidth;
      var widthOrig = computed.borderTopWidth;
      widthInp.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          var parsed = parseNumericValue(widthInp.value);
          if (!parsed) return;
          var step = e.shiftKey ? 10 : 1;
          var dir = e.key === 'ArrowUp' ? 1 : -1;
          widthInp.value = Math.max(0, parsed.num + step * dir) + parsed.unit;
          applyInspectValue(el, 'border-width', widthInp.value, widthOrig);
        }
        if (e.key === 'Enter') { e.preventDefault(); widthInp.blur(); }
        if (e.key === 'Escape') { widthInp.value = widthOrig; applyInspectValue(el, 'border-width', widthOrig, widthOrig); widthInp.blur(); }
        e.stopPropagation();
      });
      widthInp.addEventListener('change', function () { applyInspectValue(el, 'border-width', widthInp.value, widthOrig); });
      widthInp.addEventListener('focus', function () { state.inspectEditingValue = true; });
      widthInp.addEventListener('blur', function () { state.inspectEditingValue = false; });
      strokeControls.appendChild(widthInp);
      strokeRow.appendChild(strokeControls);
      s.body.appendChild(strokeRow);
    }

    var opacityRow = document.createElement('div');
    opacityRow.className = 'dn-inspect-field';
    opacityRow.style.marginTop = '6px';
    var opacityLabel = document.createElement('span');
    opacityLabel.className = 'dn-inspect-field-label';
    opacityLabel.textContent = 'opacity';
    opacityRow.appendChild(opacityLabel);
    var opacityVal = Math.round(parseFloat(computed.opacity) * 100) + '%';
    var opacityInput = document.createElement('input');
    opacityInput.type = 'text';
    opacityInput.className = 'dn-inspect-input';
    opacityInput.value = opacityVal;
    var opacityOriginal = computed.opacity;

    opacityInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        var cur = parseInt(opacityInput.value, 10) || 100;
        var step = e.shiftKey ? 10 : 1;
        var dir = e.key === 'ArrowUp' ? 1 : -1;
        var newVal = Math.max(0, Math.min(100, cur + step * dir));
        opacityInput.value = newVal + '%';
        applyInspectValue(el, 'opacity', String(newVal / 100), opacityOriginal);
      }
      if (e.key === 'Enter') { e.preventDefault(); opacityInput.blur(); }
      if (e.key === 'Escape') {
        e.preventDefault();
        opacityInput.value = Math.round(parseFloat(opacityOriginal) * 100) + '%';
        applyInspectValue(el, 'opacity', opacityOriginal, opacityOriginal);
        opacityInput.blur();
      }
      e.stopPropagation();
    });

    opacityInput.addEventListener('change', function () {
      var val = parseInt(opacityInput.value, 10);
      if (isNaN(val)) return;
      applyInspectValue(el, 'opacity', String(Math.max(0, Math.min(100, val)) / 100), opacityOriginal);
    });

    opacityInput.addEventListener('focus', function () { state.inspectEditingValue = true; });
    opacityInput.addEventListener('blur', function () { state.inspectEditingValue = false; });

    opacityRow.appendChild(opacityInput);
    s.body.appendChild(opacityRow);

    var bgIsDefault = computed.backgroundColor === 'rgba(0, 0, 0, 0)' || computed.backgroundColor === 'transparent';
    var noBorder = computed.borderTopStyle === 'none';
    var opacityIsDefault = computed.opacity === '1';

    panel.appendChild(s.section);
  }

  // --- Typography Section ---

  function buildTypographySection(panel, el, computed) {
    var hasText = false;
    for (var i = 0; i < el.childNodes.length; i++) {
      if (el.childNodes[i].nodeType === 3 && el.childNodes[i].textContent.trim()) { hasText = true; break; }
    }
    if (!hasText) return;

    var s = createInspectSection('TYPE');

    s.body.appendChild(createCompactInput('font', computed.fontFamily.split(',')[0].replace(/['"]/g, ''), {
      prop: 'font-family',
      onChange: function (val) { applyInspectValue(el, 'font-family', val, computed.fontFamily); },
    }));

    var grid1 = document.createElement('div');
    grid1.className = 'dn-inspect-grid';
    grid1.style.marginTop = '6px';
    grid1.appendChild(createCompactInput('size', computed.fontSize, {
      prop: 'font-size',
      onChange: function (val) { applyInspectValue(el, 'font-size', val, computed.fontSize); },
    }));
    grid1.appendChild(createEnumField('weight', computed.fontWeight, ['100','200','300','400','500','600','700','800','900'], function (val) {
      applyInspectValue(el, 'font-weight', val, computed.fontWeight);
    }));
    s.body.appendChild(grid1);

    var grid2 = document.createElement('div');
    grid2.className = 'dn-inspect-grid';
    grid2.style.marginTop = '6px';
    grid2.appendChild(createCompactInput('leading', computed.lineHeight, {
      prop: 'line-height',
      onChange: function (val) { applyInspectValue(el, 'line-height', val, computed.lineHeight); },
    }));
    grid2.appendChild(createCompactInput('tracking', computed.letterSpacing, {
      prop: 'letter-spacing',
      dimmed: computed.letterSpacing === 'normal',
      onChange: function (val) { applyInspectValue(el, 'letter-spacing', val, computed.letterSpacing); },
    }));
    s.body.appendChild(grid2);

    var colorRow = document.createElement('div');
    colorRow.className = 'dn-inspect-color-row';
    colorRow.style.marginTop = '6px';
    var colorLabel = document.createElement('span');
    colorLabel.className = 'dn-inspect-field-label';
    colorLabel.textContent = 'color';
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(createColorInput(computed.color, function (val) {
      applyInspectValue(el, 'color', val, computed.color);
    }));
    s.body.appendChild(colorRow);

    panel.appendChild(s.section);
  }

  // --- Effects Section ---

  function buildEffectsSection(panel, el, computed) {
    if (computed.boxShadow === 'none') return;

    var s = createInspectSection('EFFECTS', 'box-shadow');

    s.body.appendChild(createCompactInput('shadow', computed.boxShadow, {
      prop: 'box-shadow',
      onChange: function (val) { applyInspectValue(el, 'box-shadow', val, computed.boxShadow); },
    }));
    var inp = s.body.querySelector('.dn-inspect-input');
    if (inp) inp.style.textAlign = 'left';

    panel.appendChild(s.section);
  }

  function collapseSpacingForMarkdown(changes) {
    var result = [];
    var sides = ['top', 'right', 'bottom', 'left'];

    ['padding', 'margin'].forEach(function (prop) {
      var sideChanges = sides.map(function (s) {
        return changes.find(function (c) { return c.property === prop + '-' + s; });
      });
      var hasAny = sideChanges.some(function (c) { return c; });
      if (!hasAny) return;

      var allChanged = sideChanges.every(function (c) { return c; });
      if (allChanged) {
        var beforeVals = sideChanges.map(function (c) { return c.before; });
        var afterVals = sideChanges.map(function (c) { return c.after; });
        var allSameBefore = beforeVals.every(function (v) { return v === beforeVals[0]; });
        var allSameAfter = afterVals.every(function (v) { return v === afterVals[0]; });
        result.push({
          property: prop,
          before: allSameBefore ? beforeVals[0] : beforeVals.join(' '),
          after: allSameAfter ? afterVals[0] : afterVals.join(' '),
        });
      } else {
        sideChanges.forEach(function (c) { if (c) result.push(c); });
      }
    });

    changes.forEach(function (c) {
      if (!/^(padding|margin)-/.test(c.property)) result.push(c);
    });

    return result;
  }

  function parseNumericValue(value) {
    var match = value.match(/^(-?[\d.]+)\s*(px|rem|em|%|vh|vw|pt|ch|ex|vmin|vmax)?$/);
    if (match) return { num: parseFloat(match[1]), unit: match[2] || '' };
    var n = parseFloat(value);
    if (!isNaN(n)) return { num: n, unit: '' };
    return null;
  }

  function rgbToHex(rgb) {
    if (!rgb || rgb.charAt(0) === '#') return rgb || '#000000';
    var match = rgb.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!match) return rgb;
    var r = parseInt(match[1]), g = parseInt(match[2]), b = parseInt(match[3]);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  // =========================================================================
  // INSPECT MODE — LIVE PREVIEW & EDIT RECORDING
  // =========================================================================

  var inspectOriginalValues = {};

  function getOriginalValue(selector, prop, computedValue) {
    if (!inspectOriginalValues[selector]) inspectOriginalValues[selector] = {};
    if (!(prop in inspectOriginalValues[selector])) {
      inspectOriginalValues[selector][prop] = computedValue;
    }
    return inspectOriginalValues[selector][prop];
  }

  function applyInspectValue(el, prop, newValue, computedOriginal) {
    if (!state.inspectTarget) return;
    var selector = state.inspectTarget.selector;
    var original = getOriginalValue(selector, prop, computedOriginal);

    el.style.setProperty(prop, newValue);

    if (newValue === original) {
      el.style.removeProperty(prop);
      removeFromCssEdit(selector, prop);
    } else {
      recordCssEdit(selector, prop, original, newValue);
    }

    updateRevertButton(selector);
    saveState();
    autoExport();
  }

  function recordCssEdit(selector, property, before, after) {
    var target = state.inspectTarget;
    if (!target) return;

    pushUndo('css edit');

    var existing = state.cssEdits.find(function (e) {
      return e.selector === selector && e.page === currentPage();
    });

    if (existing) {
      var change = existing.changes.find(function (c) { return c.property === property; });
      if (change) {
        change.after = after;
      } else {
        existing.changes.push({ property: property, before: before, after: after });
      }
      existing.timestamp = new Date().toISOString();
    } else {
      var meta = target.meta;
      state.cssEdits.push({
        id: state.nextCssEditId++,
        selector: selector,
        tag: target.element.tagName,
        textPreview: meta.textPreview || '',
        page: currentPage(),
        bounds: meta.boundingBox,
        reverted: false,
        changes: [{ property: property, before: before, after: after }],
        timestamp: new Date().toISOString(),
      });
    }
  }

  function removeFromCssEdit(selector, property) {
    var edit = state.cssEdits.find(function (e) {
      return e.selector === selector && e.page === currentPage();
    });
    if (!edit) return;
    edit.changes = edit.changes.filter(function (c) { return c.property !== property; });
    if (edit.changes.length === 0) {
      state.cssEdits = state.cssEdits.filter(function (e) { return e !== edit; });
    }
  }

  function clearAllInspectInlineStyles() {
    Object.keys(inspectOriginalValues).forEach(function (selector) {
      var el = document.querySelector(selector);
      if (!el) return;
      Object.keys(inspectOriginalValues[selector]).forEach(function (prop) {
        el.style.removeProperty(prop);
      });
    });
  }

  function reapplyCssEdits() {
    var page = currentPage();
    state.cssEdits.forEach(function (edit) {
      if (edit.page !== page) return;
      if (edit.reverted) return;
      var el = document.querySelector(edit.selector);
      if (!el) {
        edit._stale = true;
        return;
      }
      edit._stale = false;
      var computed = window.getComputedStyle(el);
      edit.changes.forEach(function (c) {
        if (c.property === 'position' && c.type === 'move') {
          var dx = c.after.x - c.before.x;
          var dy = c.after.y - c.before.y;
          el.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)';
        } else {
          getOriginalValue(edit.selector, c.property, computed.getPropertyValue(c.property));
          el.style.setProperty(c.property, c.after);
        }
      });
    });
  }

  // =========================================================================
  // TEXT EDIT — DETECTION & HOVER
  // =========================================================================

  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, SVG: 1, BR: 1, HR: 1, IMG: 1 };

  function isTextElement(el) {
    if (!el || !el.tagName) return false;
    if (SKIP_TAGS[el.tagName]) return false;
    if (el.closest('[data-designer-notes]')) return false;
    var nodes = el.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].nodeType === 3 && nodes[i].textContent.trim().length > 0) {
        return true;
      }
    }
    return false;
  }

  var hoveredTextEl = null;

  function handleTextHover(e) {
    if (!state.textEditMode || state.activeTextEdit) return;
    var target = e.target;
    var textEl = isTextElement(target) ? target : null;
    if (textEl === hoveredTextEl) return;
    if (hoveredTextEl) {
      hoveredTextEl.classList.remove('dn-text-hover');
      hoveredTextEl.style.cursor = '';
    }
    hoveredTextEl = textEl;
    if (hoveredTextEl) {
      hoveredTextEl.classList.add('dn-text-hover');
      hoveredTextEl.style.cursor = 'text';
    }
  }

  function clearTextHover() {
    if (hoveredTextEl) {
      hoveredTextEl.classList.remove('dn-text-hover');
      hoveredTextEl.style.cursor = '';
      hoveredTextEl = null;
    }
  }

  // =========================================================================
  // TEXT EDIT — INLINE EDITING & CONTROLS
  // =========================================================================

  var textControlsEl = null;

  function activateTextEdit(el) {
    if (state.activeTextEdit) dismissTextEdit();
    clearTextHover();
    var before = el.textContent;
    var selector = computeSelector(el);
    var tagName = el.tagName;
    var rect = el.getBoundingClientRect();
    var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    var bounds = {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      x: Math.round(rect.left + scrollX),
      y: Math.round(rect.top + scrollY),
    };
    state.activeTextEdit = {
      element: el,
      before: before,
      selector: selector,
      tagName: tagName,
      bounds: bounds,
    };
    el.contentEditable = 'true';
    el.style.webkitUserModify = 'read-write-plaintext-only';
    el.classList.remove('dn-text-hover');
    el.classList.add('dn-text-editing');
    el.focus();
    el.addEventListener('paste', handleTextPaste);
    el.addEventListener('input', handleTextInput);
    showTextControls(el);
  }

  function handleTextInput() {
    if (state.activeTextEdit) {
      positionTextControls(state.activeTextEdit.element);
    }
  }

  function handleTextPaste(e) {
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  }

  function showTextControls(el) {
    removeTextControls();
    textControlsEl = document.createElement('div');
    textControlsEl.className = 'dn-text-controls';
    textControlsEl.setAttribute('data-designer-notes', 'text-controls');
    textControlsEl.innerHTML =
      '<button class="dn-text-dismiss" data-designer-notes title="Dismiss (Esc)">' +
        '<svg viewBox="0 0 24 24" data-designer-notes><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
      '</button>' +
      '<button class="dn-text-accept" data-designer-notes title="Accept (Enter)">' +
        '<svg viewBox="0 0 24 24" data-designer-notes><polyline points="20 6 9 17 4 12"/></svg>' +
      '</button>';
    textControlsEl.querySelector('.dn-text-dismiss').addEventListener('click', function (e) {
      e.stopPropagation();
      dismissTextEdit();
    });
    textControlsEl.querySelector('.dn-text-accept').addEventListener('click', function (e) {
      e.stopPropagation();
      acceptTextEdit();
    });
    positionTextControls(el);
    document.body.appendChild(textControlsEl);
  }

  function positionTextControls(el) {
    if (!textControlsEl) return;
    var rect = el.getBoundingClientRect();
    var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    textControlsEl.style.position = 'absolute';
    textControlsEl.style.top = (rect.bottom + scrollY + 6) + 'px';
    textControlsEl.style.right = (document.documentElement.clientWidth - rect.right - scrollX) + 'px';
  }

  function removeTextControls() {
    if (textControlsEl && textControlsEl.parentNode) {
      textControlsEl.parentNode.removeChild(textControlsEl);
    }
    textControlsEl = null;
  }

  function acceptTextEdit() {
    if (!state.activeTextEdit) return;
    var edit = state.activeTextEdit;
    var el = edit.element;
    var after = el.textContent;
    el.contentEditable = 'false';
    el.style.webkitUserModify = '';
    el.classList.remove('dn-text-editing');
    el.removeEventListener('paste', handleTextPaste);
    el.removeEventListener('input', handleTextInput);
    removeTextControls();
    if (after !== edit.before) {
      pushUndo('text edit');
      // Check if an existing text edit targets the same element
      var existing = null;
      for (var i = 0; i < state.textEdits.length; i++) {
        if (state.textEdits[i].selector === edit.selector && state.textEdits[i].page === currentPage()) {
          existing = state.textEdits[i];
          break;
        }
      }
      if (existing) {
        // Update existing entry — keep original "before", update "after"
        existing.after = after;
        existing.elementRect = edit.bounds;
        existing.timestamp = new Date().toISOString();
      } else {
        var textEdit = {
          id: state.nextTextEditId++,
          page: currentPage(),
          selector: edit.selector,
          tagName: edit.tagName,
          before: edit.before,
          after: after,
          elementRect: edit.bounds,
          timestamp: new Date().toISOString(),
        };
        state.textEdits.push(textEdit);
      }
      saveState();
      rerenderAllTextIndicators();
      autoExport();
      if (state.panelOpen) renderCommentList();
      updateBadge();
      showToast('Text edit saved');
    }
    state.activeTextEdit = null;
  }

  function dismissTextEdit() {
    if (!state.activeTextEdit) return;
    var edit = state.activeTextEdit;
    var el = edit.element;
    el.textContent = edit.before;
    el.contentEditable = 'false';
    el.style.webkitUserModify = '';
    el.classList.remove('dn-text-editing');
    el.removeEventListener('paste', handleTextPaste);
    el.removeEventListener('input', handleTextInput);
    removeTextControls();
    state.activeTextEdit = null;
  }

  function handleTextClick(e) {
    if (!state.textEditMode) return;
    if (e.target.closest('[data-designer-notes]')) return;
    if (state.activeTextEdit && state.activeTextEdit.element === e.target) return;
    var target = e.target;
    if (!isTextElement(target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    activateTextEdit(target);
  }

  // =========================================================================
  // TEXT EDIT — INDICATORS
  // =========================================================================

  function renderTextIndicator(el, textEdit) {
    var existing = document.querySelector('.dn-text-indicator[data-text-edit-id="' + textEdit.id + '"]');
    if (existing) existing.parentNode.removeChild(existing);
    var indicator = document.createElement('div');
    indicator.className = 'dn-text-indicator';
    indicator.setAttribute('data-designer-notes', 'text-indicator');
    indicator.setAttribute('data-text-edit-id', textEdit.id);
    var num = state.textEdits.indexOf(textEdit) + 1;
    indicator.innerHTML =
      '<div class="dn-text-indicator-bar" data-designer-notes></div>' +
      '<div class="dn-text-indicator-num" data-designer-notes>' + num + '</div>';
    var rect = el.getBoundingClientRect();
    var scrollX = window.pageXOffset || document.documentElement.scrollLeft;
    var scrollY = window.pageYOffset || document.documentElement.scrollTop;
    indicator.style.left = (rect.left + scrollX - 14) + 'px';
    indicator.style.top = (rect.top + scrollY) + 'px';
    indicator.style.height = rect.height + 'px';
    document.body.appendChild(indicator);
  }

  function rerenderAllTextIndicators() {
    var existing = document.querySelectorAll('.dn-text-indicator');
    for (var i = 0; i < existing.length; i++) {
      existing[i].parentNode.removeChild(existing[i]);
    }
    var pageEdits = state.textEdits.filter(function (te) { return te.page === currentPage(); });
    pageEdits.forEach(function (te) {
      var el = document.querySelector(te.selector);
      if (el) renderTextIndicator(el, te);
    });
  }

  function updateBadge() {
    var commentCount = pageComments().length;
    var textEditCount = state.textEdits.filter(function (te) { return te.page === currentPage(); }).length;
    var cssEditCount = state.cssEdits.filter(function (e) { return e.page === currentPage(); }).length;
    var count = commentCount + textEditCount + cssEditCount;
    badgeEl.textContent = count > 0 ? count : '';
    badgeEl.setAttribute('data-count', count);
  }

  function isTyping() {
    var el = document.activeElement;
    return el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable);
  }

  function handleCritClick(e) {
    if (!state.critMode) return;
    if (e.target.closest('[data-designer-notes]')) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (state.editingCommentId) { closePopover(); return; }

    var target = e.target;
    var selector = computeSelector(target);
    var meta = getElementMeta(target);
    var rect = target.getBoundingClientRect();

    var nearestChild = null;
    if (meta.isContainer) {
      var children = target.querySelectorAll('*');
      var cx = e.clientX, cy = e.clientY, best = Infinity;
      children.forEach(function (child) {
        if (child.children.length > 2 || child.hasAttribute('data-designer-notes')) return;
        var cr = child.getBoundingClientRect();
        if (!cr.width || !cr.height) return;
        var d = Math.hypot(cx - (cr.left + cr.width / 2), cy - (cr.top + cr.height / 2));
        if (d < best) {
          best = d;
          nearestChild = {
            tagName: child.tagName,
            text: (child.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 60),
            selector: computeSelector(child),
          };
        }
      });
    }

    var comment = {
      id: state.nextId++,
      text: '',
      page: currentPage(),
      selector: selector,
      tagName: meta.tagName,
      textPreview: meta.textPreview,
      isContainer: meta.isContainer,
      nearestChild: nearestChild,
      elementRect: meta.boundingBox,
      clickOffset: { x: e.clientX - rect.left, y: e.clientY - rect.top },
      pagePosition: { x: Math.round(e.pageX), y: Math.round(e.pageY) },
      timestamp: new Date().toISOString(),
      detached: false,
    };

    pushUndo('add comment');
    state.comments.push(comment);
    saveState();
    renderPin(comment, true, pageComments().length);
    updateBadge();
    openPopover(comment.id);
    if (state.panelOpen) renderCommentList();
  }

  function handleKeydown(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === '.') {
      e.preventDefault(); toggleUIVisibility(); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !isTyping()) {
      e.preventDefault(); undo(); return;
    }
    // Text edit accept/dismiss — must come before isTyping check
    if (state.activeTextEdit && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault(); acceptTextEdit(); return;
    }
    if (state.activeTextEdit && e.key === 'Escape') {
      e.preventDefault(); dismissTextEdit(); return;
    }
    if (e.key === 'c' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping()) {
      e.preventDefault(); toggleCritMode(); return;
    }
    if (e.key === 't' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping()) {
      e.preventDefault(); toggleTextEditMode(); return;
    }
    if (e.key === 'i' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping()) {
      e.preventDefault(); toggleInspectMode(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'C') {
      e.preventDefault(); toggleCritMode(); return;
    }
    if (e.key === 'Escape') {
      if (state.inspectMode && state.inspectEditingValue) return; // handled by input
      if (state.inspectMode && state.inspectTarget) { closeInspectPanel(); deselectInspectTarget(); return; }
      if (state.inspectMode) { toggleInspectMode(); return; }
      if (state.textEditMode) toggleTextEditMode();
      else if (state.editingCommentId) closePopover();
      else if (state.critMode) toggleCritMode();
      else if (state.panelOpen) closePanel();
    }
  }

  function handleDocumentClick(e) {
    if (state.editingCommentId && !e.target.closest('[data-designer-notes]')) closePopover();
  }

  var repositionTimer;
  function handleReposition() {
    clearTimeout(repositionTimer);
    repositionTimer = setTimeout(function () {
      repositionAllPins();
      rerenderAllTextIndicators();
    }, 150);
  }

  // =========================================================================
  // EXPORT
  // =========================================================================

  function generateMarkdown() {
    var dateStr = new Date().toISOString().replace('T', ' ').substring(0, 19);
    var all = state.comments;
    var vw = window.innerWidth;
    var vh = window.innerHeight;
    var md = '# UI Feedback\nGenerated: ' + dateStr + '\nTotal comments: ' + all.length + '\nTotal text edits: ' + state.textEdits.length + '\nTotal CSS edits: ' + state.cssEdits.length + '\nViewport: ' + vw + 'x' + vh + '\n\n---\n';

    var pages = {};
    all.forEach(function (c) { if (!pages[c.page]) pages[c.page] = []; pages[c.page].push(c); });

    var n = 0;
    Object.keys(pages).forEach(function (page) {
      md += '\n## Page: ' + page + '\n\n';
      pages[page].forEach(function (c) {
        n++;
        md += '### Comment ' + n + '\n';
        md += '**Element:** `' + c.selector + '`\n';
        md += '**Tag:** ' + c.tagName + (c.isContainer ? ' (container)' : '');
        if (c.textPreview) md += ' | **Text:** "' + c.textPreview + '"';
        md += '\n';
        if (c.nearestChild) {
          md += '**Nearest child:** `' + c.nearestChild.selector + '` (' + c.nearestChild.tagName + ': "' + c.nearestChild.text + '")\n';
        }
        md += '**Position:** click at (' + c.pagePosition.x + ', ' + c.pagePosition.y + ') on page; offset (' + Math.round(c.clickOffset.x) + ', ' + Math.round(c.clickOffset.y) + ') within element\n';
        md += '**Element bounds:** ' + c.elementRect.width + 'x' + c.elementRect.height + ' at (' + c.elementRect.x + ', ' + c.elementRect.y + ')\n';
        md += c.text ? '\n> ' + c.text.replace(/\n/g, '\n> ') + '\n' : '\n> *(Element flagged for attention)*\n';
        md += '\n---\n';
      });
    });

    // Text edits section
    var pageTextEdits = {};
    state.textEdits.forEach(function (te) {
      if (!pageTextEdits[te.page]) pageTextEdits[te.page] = [];
      pageTextEdits[te.page].push(te);
    });

    if (state.textEdits.length > 0) {
      var teNum = 0;
      Object.keys(pageTextEdits).forEach(function (page) {
        md += '\n## Text Edits — Page: ' + page + '\n\n';
        pageTextEdits[page].forEach(function (te) {
          teNum++;
          md += '### Edit ' + teNum + '\n';
          md += '**Element:** `' + te.selector + '`\n';
          md += '**Tag:** ' + te.tagName + '\n';
          md += '**Before:** "' + te.before.replace(/"/g, '\\"') + '"\n';
          md += '**After:** "' + te.after.replace(/"/g, '\\"') + '"\n';
          md += '**Element bounds:** ' + te.elementRect.width + 'x' + te.elementRect.height + ' at (' + te.elementRect.x + ', ' + te.elementRect.y + ')\n';
          md += '\n---\n';
        });
      });
    }

    // CSS edits section
    var cssEditsByPage = {};
    state.cssEdits.forEach(function (edit) {
      if (!cssEditsByPage[edit.page]) cssEditsByPage[edit.page] = [];
      cssEditsByPage[edit.page].push(edit);
    });

    if (state.cssEdits.length > 0) {
      Object.keys(cssEditsByPage).forEach(function (page) {
        md += '\n## CSS Edits — Page: ' + page + '\n\n';
        cssEditsByPage[page].forEach(function (edit, i) {
          md += '### Element ' + (i + 1) + '\n';
          md += '**Element:** `' + edit.selector + '`\n';
          md += '**Tag:** ' + edit.tag;
          if (edit.textPreview) md += ' | **Text:** "' + edit.textPreview.replace(/\|/g, '\\|').replace(/"/g, '\\"') + '"';
          md += '\n';
          if (edit.bounds) {
            md += '**Element bounds:** ' + Math.round(edit.bounds.width) + 'x' + Math.round(edit.bounds.height) + ' at (' + Math.round(edit.bounds.x) + ', ' + Math.round(edit.bounds.y) + ')\n';
          }
          md += '**Status:** ' + (edit.reverted ? 'reverted' : 'applied') + '\n\n';

          var changes = collapseSpacingForMarkdown(edit.changes);
          md += '| Property | Before | After |\n';
          md += '|----------|--------|-------|\n';
          changes.forEach(function (c) {
            if (c.property === 'position' && c.type === 'move') {
              md += '| position | (' + c.before.x + ', ' + c.before.y + ') | (' + c.after.x + ', ' + c.after.y + ') |\n';
            } else {
              md += '| ' + c.property + ' | ' + c.before + ' | ' + c.after + ' |\n';
            }
          });
          md += '\n---\n\n';
        });
      });
    }

    md += '\n*Exported by designer-notes*\n';
    return md;
  }

  function copyToClipboard() {
    if (state.comments.length === 0 && state.textEdits.length === 0 && state.cssEdits.length === 0) { showToast('No feedback to copy'); return; }
    var md = generateMarkdown();
    navigator.clipboard.writeText(md).then(function () {
      showToast('Copied ' + state.comments.length + ' comments');
    }).catch(function () {
      var ta = document.createElement('textarea');
      ta.value = md; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
      showToast('Copied');
    });
  }

  // =========================================================================
  // INIT
  // =========================================================================

  function init() {
    injectStyles();
    loadState();
    detectServer();
    document.body.appendChild(pinContainer);
    createToggle();
    createPreview();
    createPopover();
    createPanel();
    rerenderAllPins();
    rerenderAllTextIndicators();
    updateBadge();
    reapplyCssEdits();

    createInspectOverlays();
    document.addEventListener('mousemove', handleInspectHover, true);
    document.addEventListener('click', function (e) {
      if (!state.inspectMode) return;
      if (e.target.closest && e.target.closest('.dn-inspect-panel')) return;
      if (e.target.closest && e.target.closest('[data-designer-notes]')) return;
      handleInspectClick(e);
    }, true);

    document.addEventListener('click', handleCritClick, true);
    document.addEventListener('click', handleTextClick, true);
    document.addEventListener('click', handleDocumentClick, false);
    document.addEventListener('keydown', handleKeydown, false);
    document.addEventListener('mousemove', handleTextHover, true);
    window.addEventListener('resize', handleReposition, false);
    window.addEventListener('scroll', handleReposition, true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
