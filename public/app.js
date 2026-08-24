/**
 * LexiRead - Client Application Logic
 */

// STATE
let state = {
  token: localStorage.getItem('lexiread_token') || null,
  user: null,
  articles: [],
  currentArticle: null,
  selectedDate: null,
  streak: { streakDays: 0, todayArticles: [], fullHistory: {} },
  fontSize: parseInt(localStorage.getItem('lexiread_fontsize') || '16', 10),
  activeTheme: localStorage.getItem('lexiread_theme') || 'theme-light',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth(), // 0-11
  currentMode: 'read', // 'read' | 'type'
  typing: {
    sentences: [],
    currentIndex: 0
  }
};

// DOM ELEMENTS
const brandHome = document.getElementById('brand-home');
const articleListContainer = document.getElementById('article-list-container');
const issueDateLabel = document.getElementById('issue-date-label');
const returnTodayBtn = document.getElementById('return-today-btn');
const canvasHeadline = document.getElementById('canvas-headline');
const canvasAuthor = document.getElementById('canvas-author');
const canvasStandfirst = document.getElementById('canvas-standfirst');
const canvasBody = document.getElementById('canvas-body');
const articleCanvas = document.getElementById('article-canvas');
const markReadBtn = document.getElementById('mark-read-btn');
const markReadCheckbox = document.getElementById('mark-read-checkbox');
const markReadText = document.getElementById('mark-read-text');
const dailyProgressFill = document.getElementById('daily-progress-fill');
const dailyProgressText = document.getElementById('daily-progress-text');
const authSection = document.getElementById('auth-section');

// MODE TOGGLE
const modeReadBtn = document.getElementById('mode-read-btn');
const modeTypeBtn = document.getElementById('mode-type-btn');

// TYPING CANVAS ELEMENTS
const typingCanvas = document.getElementById('typing-canvas');
const typingStepBadge = document.getElementById('typing-step-badge');
const typingProgressFill = document.getElementById('typing-progress-fill');
const typingSpeakBtn = document.getElementById('typing-speak-btn');
const typingActiveBox = document.getElementById('typing-active-box');
const typingTargetDisplay = document.getElementById('typing-target-display');
const typingInputField = document.getElementById('typing-input-field');
const typingPrevBtn = document.getElementById('typing-prev-btn');
const typingSkipBtn = document.getElementById('typing-skip-btn');

// CALENDAR ELEMENTS
const calendarModal = document.getElementById('calendar-modal');
const openCalendarBtn = document.getElementById('open-calendar-btn');
const closeCalendarBtn = document.getElementById('close-calendar-btn');
const calPrevMonthBtn = document.getElementById('cal-prev-month');
const calNextMonthBtn = document.getElementById('cal-next-month');
const calMonthYearLabel = document.getElementById('cal-month-year-label');
const calendarDaysGrid = document.getElementById('calendar-days-grid');

// SIMPLE MEMO ELEMENTS
const memoModal = document.getElementById('memo-modal');
const openMemoBtn = document.getElementById('open-memo-btn');
const closeMemoBtn = document.getElementById('close-memo-btn');
const memoTextarea = document.getElementById('memo-textarea');

// AUTH MODAL ELEMENTS
const authModal = document.getElementById('auth-modal');
const closeAuthBtn = document.getElementById('close-auth-btn');
const tabLoginBtn = document.getElementById('tab-login-btn');
const tabRegisterBtn = document.getElementById('tab-register-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginError = document.getElementById('login-error');
const regError = document.getElementById('reg-error');

const fontDecBtn = document.getElementById('font-dec-btn');
const fontIncBtn = document.getElementById('font-inc-btn');
const toastEl = document.getElementById('toast');

// ----------------------------------------------------
// API REQUEST HELPER
// ----------------------------------------------------
async function apiRequest(endpoint, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }
  const resp = await fetch(endpoint, { ...options, headers });
  if (resp.status === 401 && state.token) {
    logoutUser();
    throw new Error('Session expired');
  }
  return resp;
}

function showToast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), 2500);
}

// ----------------------------------------------------
// LOCAL DATE HELPER & HISTORY STORAGE
// ----------------------------------------------------
function getLocalDateKey(d = new Date()) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalHistory() {
  try {
    return JSON.parse(localStorage.getItem('lexiread_reading_history') || '{}');
  } catch (e) {
    return {};
  }
}

function saveLocalHistory(hist) {
  localStorage.setItem('lexiread_reading_history', JSON.stringify(hist));
}

// ----------------------------------------------------
// INITIALIZATION
// ----------------------------------------------------
document.addEventListener('DOMContentLoaded', async () => {
  // Prune legacy test records from localStorage on startup
  const localHist = getLocalHistory();
  delete localHist['2026-08-20'];
  delete localHist['2026-08-21'];
  delete localHist['2026-08-22'];
  saveLocalHistory(localHist);

  state.selectedDate = getLocalDateKey();
  applyTheme(state.activeTheme);
  applyFontSize(state.fontSize);
  setupEventListeners();

  // Simple Memo auto-load, local cache & cloud sync
  if (memoTextarea) {
    memoTextarea.value = localStorage.getItem('lexiread_memo') || '';
    memoTextarea.addEventListener('input', () => {
      const val = memoTextarea.value;
      localStorage.setItem('lexiread_memo', val);
      if (state.user) {
        syncMemoToServer(val);
      }
    });
  }

  // Pronunciation on double-click in article
  if (canvasBody) {
    canvasBody.addEventListener('dblclick', () => {
      const sel = window.getSelection().toString().trim();
      const clean = sel.replace(/[^\w\s'-]/g, '').trim();
      if (clean && clean.length > 1) {
        speakWordBrowser(clean);
      }
    });
  }

  calculateLocalStreak(getLocalHistory());
  await checkAuthSession();
  await loadArticlesForDate(state.selectedDate);

  if (state.user) {
    await loadUserData();
  }

  // Start live day-change watcher
  startMidnightWatcher();
});

function setupEventListeners() {
  // Mode Switchers
  if (modeReadBtn) modeReadBtn.addEventListener('click', () => switchReaderMode('read'));
  if (modeTypeBtn) modeTypeBtn.addEventListener('click', () => switchReaderMode('type'));

  // Typing Input listener
  if (typingInputField) {
    typingInputField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSentenceEnterAdvance(e);
      }
    });
  }
  if (typingPrevBtn) typingPrevBtn.addEventListener('click', goToPreviousSentence);
  if (typingSkipBtn) typingSkipBtn.addEventListener('click', advanceToNextSentence);
  if (typingSpeakBtn) typingSpeakBtn.addEventListener('click', speakCurrentTypingSentence);

  // Return to Today Button
  if (returnTodayBtn) {
    returnTodayBtn.addEventListener('click', () => {
      const today = getLocalDateKey();
      state.selectedDate = today;
      loadArticlesForDate(today);
    });
  }

  // Theme Buttons
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      applyTheme(theme);
    });
  });

  // Font resizers
  if (fontDecBtn) {
    fontDecBtn.addEventListener('click', () => {
      if (state.fontSize > 13) {
        state.fontSize -= 1;
        applyFontSize(state.fontSize);
      }
    });
  }
  if (fontIncBtn) {
    fontIncBtn.addEventListener('click', () => {
      if (state.fontSize < 24) {
        state.fontSize += 1;
        applyFontSize(state.fontSize);
      }
    });
  }

  // Calendar Modal triggers
  if (openCalendarBtn) openCalendarBtn.addEventListener('click', openCalendarModal);
  if (closeCalendarBtn) closeCalendarBtn.addEventListener('click', () => calendarModal.style.display = 'none');
  
  if (calPrevMonthBtn) {
    calPrevMonthBtn.addEventListener('click', () => {
      state.calMonth -= 1;
      if (state.calMonth < 0) { state.calMonth = 11; state.calYear -= 1; }
      renderCalendar();
    });
  }
  if (calNextMonthBtn) {
    calNextMonthBtn.addEventListener('click', () => {
      state.calMonth += 1;
      if (state.calMonth > 11) { state.calMonth = 0; state.calYear += 1; }
      renderCalendar();
    });
  }

  // Memo Modal triggers
  if (openMemoBtn) {
    openMemoBtn.addEventListener('click', () => {
      if (memoModal) memoModal.style.display = 'flex';
      if (memoTextarea) memoTextarea.focus();
    });
  }
  if (closeMemoBtn) {
    closeMemoBtn.addEventListener('click', () => {
      if (memoModal) memoModal.style.display = 'none';
    });
  }

  // Auth Modal
  if (closeAuthBtn) {
    closeAuthBtn.addEventListener('click', () => {
      authModal.style.display = 'none';
    });
  }
  if (tabLoginBtn) tabLoginBtn.addEventListener('click', () => switchAuthTab('login'));
  if (tabRegisterBtn) tabRegisterBtn.addEventListener('click', () => switchAuthTab('register'));
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);
  if (registerForm) registerForm.addEventListener('submit', handleRegisterSubmit);

  // Toggle Mark Article as Read
  if (markReadBtn) {
    markReadBtn.addEventListener('click', () => {
      if (state.currentArticle) {
        toggleArticleReadStatus(state.currentArticle.id);
      }
    });
  }

  // Close modals on outside click
  document.addEventListener('click', (e) => {
    if (e.target === calendarModal) calendarModal.style.display = 'none';
    if (e.target === memoModal) memoModal.style.display = 'none';
    if (e.target === authModal) authModal.style.display = 'none';
  });
}

// ----------------------------------------------------
// LIVE DAY-CHANGE & MIDNIGHT WATCHER
// ----------------------------------------------------
let lastObservedDate = getLocalDateKey();

function startMidnightWatcher() {
  setInterval(checkIfDayChanged, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkIfDayChanged();
    }
  });
}

async function checkIfDayChanged() {
  const currentToday = getLocalDateKey();
  if (currentToday !== lastObservedDate) {
    lastObservedDate = currentToday;
    showToast(`🌙 A new day has arrived (${currentToday})! Loading fresh columns...`);
    state.selectedDate = currentToday;
    await loadArticlesForDate(currentToday);
    calculateLocalStreak(getLocalHistory());
  }
}

// ----------------------------------------------------
// THEME & FONT MANAGEMENT
// ----------------------------------------------------
function applyTheme(theme) {
  document.body.className = theme;
  state.activeTheme = theme;
  localStorage.setItem('lexiread_theme', theme);
  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.theme === theme);
  });
}

function applyFontSize(size) {
  state.fontSize = size;
  localStorage.setItem('lexiread_fontsize', size.toString());
  if (canvasBody) {
    canvasBody.style.fontSize = `${size}px`;
  }
}

// ----------------------------------------------------
// ARTICLE LOADING FOR SELECTED DATE
// ----------------------------------------------------
async function loadArticlesForDate(dateStr) {
  const isToday = (dateStr === getLocalDateKey());
  
  if (issueDateLabel) {
    issueDateLabel.textContent = isToday ? "Today's Columns" : `Columns (${dateStr})`;
  }
  if (returnTodayBtn) {
    returnTodayBtn.style.display = isToday ? 'none' : 'inline-block';
  }

  if (articleListContainer) {
    articleListContainer.innerHTML = `
      <div class="loading-spinner">
        <div class="spinner"></div>
        <p>Loading columns for ${dateStr}...</p>
      </div>
    `;
  }

  try {
    const endpoint = `/api/articles/${dateStr}`;
    const resp = await fetch(endpoint);
    const data = await resp.json();
    state.articles = data.articles || [];

    if (state.articles.length > 0) {
      renderSidebarArticles();
      selectArticle(state.articles[0]);
    } else {
      if (articleListContainer) {
        articleListContainer.innerHTML = `<p class="loading-spinner">No columns available for ${dateStr}.</p>`;
      }
    }
  } catch (err) {
    console.error('Failed to load articles:', err);
    if (articleListContainer) {
      articleListContainer.innerHTML = '<p class="loading-spinner">Failed to connect to article feed.</p>';
    }
  }
}

function renderSidebarArticles() {
  if (!articleListContainer) return;
  articleListContainer.innerHTML = '';
  
  const dateKey = state.selectedDate || getLocalDateKey();
  const localHist = getLocalHistory();
  const readArticles = localHist[dateKey] || state.streak.todayArticles || [];

  state.articles.forEach((art, idx) => {
    const isRead = readArticles.includes(art.id);
    const card = document.createElement('div');
    card.className = `article-card-item ${state.currentArticle && state.currentArticle.id === art.id ? 'active' : ''}`;
    card.innerHTML = `
      <div class="card-num-row">
        <span class="card-num">COLUMN #${idx + 1}</span>
        <span class="card-checkbox ${isRead ? 'checked' : ''}" title="Click to toggle read status">
          ${isRead ? '☑ Read' : '☐ Check'}
        </span>
      </div>
      <h3 class="card-title ${isRead ? 'completed-text' : ''}">${escapeHTML(art.title)}</h3>
      <div class="card-author">By ${escapeHTML(art.author)} &bull; ${art.estimatedReadingTime} min</div>
    `;

    // Clicking checkbox directly toggles status
    const checkboxEl = card.querySelector('.card-checkbox');
    checkboxEl.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleArticleReadStatus(art.id);
    });

    // Clicking card selects article
    card.addEventListener('click', () => selectArticle(art));
    articleListContainer.appendChild(card);
  });

  updateDailyProgress();
}

function selectArticle(article) {
  state.currentArticle = article;
  renderSidebarArticles();

  if (canvasHeadline) canvasHeadline.textContent = article.title;
  if (canvasAuthor) canvasAuthor.innerHTML = `By <strong>${escapeHTML(article.author)}</strong>`;

  // Deduplicate standfirst if it duplicates paragraph[0]
  const firstPara = article.paragraphs[0] || '';
  if (article.standfirst && article.standfirst.trim() && canvasStandfirst) {
    const sNorm = article.standfirst.toLowerCase().replace(/[^a-z0-9]/g, '');
    const p0Norm = firstPara.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (sNorm === p0Norm || p0Norm.startsWith(sNorm) || sNorm.startsWith(p0Norm)) {
      canvasStandfirst.style.display = 'none';
    } else {
      canvasStandfirst.textContent = article.standfirst;
      canvasStandfirst.style.display = 'block';
    }
  } else if (canvasStandfirst) {
    canvasStandfirst.style.display = 'none';
  }

  // Update read button
  updateMarkReadButtonState();

  // Render clean text paragraphs
  if (canvasBody) {
    canvasBody.innerHTML = '';
    article.paragraphs.forEach(para => {
      const pEl = document.createElement('p');
      pEl.textContent = para;
      canvasBody.appendChild(pEl);
    });
  }

  // Initialize sentences for Typing Practice Mode
  extractSentencesForArticle(article);

  if (state.currentMode === 'type') {
    startTypingSession();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateMarkReadButtonState() {
  if (!state.currentArticle || !markReadBtn) return;
  const dateKey = state.selectedDate || getLocalDateKey();
  const localHist = getLocalHistory();
  const readArticles = localHist[dateKey] || state.streak.todayArticles || [];
  const isRead = readArticles.includes(state.currentArticle.id);

  if (isRead) {
    markReadBtn.classList.add('completed');
    if (markReadCheckbox) markReadCheckbox.textContent = '☑';
    if (markReadText) markReadText.textContent = 'Completed (Click to undo)';
  } else {
    markReadBtn.classList.remove('completed');
    if (markReadCheckbox) markReadCheckbox.textContent = '☐';
    if (markReadText) markReadText.textContent = 'Mark as Read';
  }
}

function updateDailyProgress() {
  const total = state.articles.length || 5;
  const dateKey = state.selectedDate || getLocalDateKey();
  const localHist = getLocalHistory();
  const readList = localHist[dateKey] || state.streak.todayArticles || [];
  const completed = readList.length;
  const pct = Math.min(100, Math.round((completed / total) * 100));

  if (dailyProgressFill) dailyProgressFill.style.width = `${pct}%`;
  if (dailyProgressText) {
    const isToday = (dateKey === getLocalDateKey());
    dailyProgressText.textContent = isToday ? `${completed}/${total} Read Today` : `${completed}/${total} Read on ${dateKey}`;
  }
}

// ----------------------------------------------------
// MODE SWITCHER (READING VS TYPING PRACTICE)
// ----------------------------------------------------
function switchReaderMode(mode) {
  state.currentMode = mode;
  if (mode === 'read') {
    if (modeReadBtn) modeReadBtn.classList.add('active');
    if (modeTypeBtn) modeTypeBtn.classList.remove('active');
    if (articleCanvas) articleCanvas.style.display = 'block';
    if (typingCanvas) typingCanvas.style.display = 'none';
  } else {
    if (modeTypeBtn) modeTypeBtn.classList.add('active');
    if (modeReadBtn) modeReadBtn.classList.remove('active');
    if (articleCanvas) articleCanvas.style.display = 'none';
    if (typingCanvas) typingCanvas.style.display = 'flex';
    startTypingSession();
  }
}

// ----------------------------------------------------
// SENTENCE TYPING & TRANSCRIPTION (따라쓰기 / 필사)
// ----------------------------------------------------
function extractSentencesForArticle(article) {
  if (!article || !article.paragraphs) {
    state.typing.sentences = [];
    return;
  }

  const sentences = [];
  article.paragraphs.forEach(p => {
    const matched = p.match(/[^.!?]+[.!?]+["'”]?|[^.!?]+$/g) || [];
    matched.forEach(s => {
      const trimmed = s.trim().replace(/\s+/g, ' ');
      if (trimmed.length >= 10) {
        sentences.push(trimmed);
      }
    });
  });

  state.typing.sentences = sentences;
}

function startTypingSession() {
  if (!state.typing.sentences || state.typing.sentences.length === 0) {
    if (state.currentArticle) {
      extractSentencesForArticle(state.currentArticle);
    }
  }

  state.typing.currentIndex = 0;
  if (typingActiveBox) typingActiveBox.style.display = 'flex';

  renderCurrentTypingSentence();
  if (typingInputField) {
    typingInputField.value = '';
    setTimeout(() => typingInputField.focus(), 100);
  }
}

function renderCurrentTypingSentence() {
  const total = state.typing.sentences.length;
  const currIdx = state.typing.currentIndex;

  if (currIdx >= total) {
    finishTypingSession();
    return;
  }

  const targetSentence = state.typing.sentences[currIdx];

  // Update HUD
  if (typingStepBadge) typingStepBadge.textContent = `Sentence ${currIdx + 1} of ${total}`;
  const pct = Math.round(((currIdx + 1) / total) * 100);
  if (typingProgressFill) typingProgressFill.style.width = `${pct}%`;

  // Clean, non-distracting readable plain text display
  if (typingTargetDisplay) {
    typingTargetDisplay.textContent = targetSentence;
  }

  // Update Previous button disabled state
  if (typingPrevBtn) {
    typingPrevBtn.disabled = (currIdx === 0);
  }
}

function handleSentenceEnterAdvance(e) {
  if (e) e.preventDefault();
  const inputVal = typingInputField ? typingInputField.value.trim() : '';
  if (inputVal.length > 0) {
    advanceToNextSentence();
  }
}

function goToPreviousSentence() {
  if (state.typing.currentIndex > 0) {
    state.typing.currentIndex -= 1;
    if (typingInputField) {
      typingInputField.value = '';
    }
    renderCurrentTypingSentence();
    if (typingInputField) typingInputField.focus();
  }
}

function advanceToNextSentence() {
  state.typing.currentIndex += 1;
  if (typingInputField) {
    typingInputField.value = '';
  }

  const total = state.typing.sentences.length;
  if (state.typing.currentIndex < total) {
    renderCurrentTypingSentence();
    if (typingInputField) typingInputField.focus();
  } else {
    finishTypingSession();
  }
}

function speakCurrentTypingSentence() {
  const currIdx = state.typing.currentIndex;
  const targetSentence = state.typing.sentences[currIdx];
  if (!targetSentence) return;

  speakWordBrowser(targetSentence);
}

function finishTypingSession() {
  showToast('🎉 All sentences in this column transcribed! Returning to reading mode.');
  setTimeout(() => {
    switchReaderMode('read');
  }, 1200);
}

// ----------------------------------------------------
// READING PROGRESS & TOGGLE COMPLETION
// ----------------------------------------------------
async function toggleArticleReadStatus(articleId) {
  const dateKey = state.selectedDate || getLocalDateKey();
  const localHist = getLocalHistory();
  if (!localHist[dateKey]) localHist[dateKey] = [];

  const isAlreadyRead = localHist[dateKey].includes(articleId);
  const nextCompleted = !isAlreadyRead;

  if (nextCompleted) {
    localHist[dateKey].push(articleId);
  } else {
    localHist[dateKey] = localHist[dateKey].filter(id => id !== articleId);
  }
  saveLocalHistory(localHist);

  // Update in-memory state
  state.streak.todayArticles = localHist[dateKey];
  state.streak.fullHistory = { ...(state.streak.fullHistory || {}), ...localHist };

  calculateLocalStreak(localHist);

  renderSidebarArticles();
  updateMarkReadButtonState();
  if (calendarModal && calendarModal.style.display === 'flex') {
    renderCalendar();
  }

  if (nextCompleted) {
    showToast(`Column completed! (${localHist[dateKey].length}/5 on ${dateKey}) 🔥`);
  } else {
    showToast('Column marked as unread.');
  }

  // If logged in, sync with server
  if (state.user) {
    try {
      const resp = await apiRequest('/api/user/toggle-read-article', {
        method: 'POST',
        body: JSON.stringify({ articleId, completed: nextCompleted, date: dateKey })
      });
      if (resp.ok) {
        const data = await resp.json();
        state.streak.streakDays = data.streakDays;
      }
    } catch (e) {
      console.warn('Background streak sync failed:', e);
    }
  }
}

function calculateLocalStreak(hist) {
  let streak = 0;
  const cur = new Date();
  const todayKey = getLocalDateKey(cur);

  if ((hist[todayKey] || []).length > 0) {
    streak = 1;
    for (let i = 1; i <= 365; i++) {
      const past = new Date(Date.now() - i * 86400000);
      const k = getLocalDateKey(past);
      if ((hist[k] || []).length > 0) {
        streak++;
      } else {
        break;
      }
    }
  } else {
    const yest = new Date(Date.now() - 86400000);
    const yestKey = getLocalDateKey(yest);
    if ((hist[yestKey] || []).length > 0) {
      streak = 1;
      for (let i = 2; i <= 365; i++) {
        const past = new Date(Date.now() - i * 86400000);
        const k = getLocalDateKey(past);
        if ((hist[k] || []).length > 0) {
          streak++;
        } else {
          break;
        }
      }
    }
  }

  state.streak.streakDays = streak;
}

// ----------------------------------------------------
// READING CALENDAR MODAL & DATE JUMPING
// ----------------------------------------------------
function openCalendarModal() {
  renderCalendar();
  if (calendarModal) calendarModal.style.display = 'flex';
}

function renderCalendar() {
  if (!calendarDaysGrid) return;
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  if (calMonthYearLabel) {
    calMonthYearLabel.textContent = `${monthNames[state.calMonth]} ${state.calYear}`;
  }
  calendarDaysGrid.innerHTML = '';

  const firstDay = new Date(state.calYear, state.calMonth, 1).getDay(); // 0 is Sun
  const daysInMonth = new Date(state.calYear, state.calMonth + 1, 0).getDate();

  const todayKey = getLocalDateKey();
  const localHist = getLocalHistory();
  const mergedHist = { ...localHist, ...(state.streak.fullHistory || {}) };

  // Empty leading cells
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement('div');
    emptyCell.className = 'cal-day-cell empty';
    calendarDaysGrid.appendChild(emptyCell);
  }

  const SERVICE_START_DATE = '2026-08-23';

  // Days of the month
  for (let d = 1; d <= daysInMonth; d++) {
    const monthStr = String(state.calMonth + 1).padStart(2, '0');
    const dayStr = String(d).padStart(2, '0');
    const dateKey = `${state.calYear}-${monthStr}-${dayStr}`;

    const readArticles = mergedHist[dateKey] || [];
    const readCount = readArticles.length;

    const cell = document.createElement('div');
    cell.className = 'cal-day-cell';

    const isBeforeLaunch = (dateKey < SERVICE_START_DATE);
    const isFuture = (dateKey > todayKey);

    if (isBeforeLaunch) {
      cell.classList.add('disabled-day');
      cell.title = 'Service launched on August 23, 2026';
    } else if (isFuture) {
      cell.classList.add('future-day');
      cell.title = 'Future date (columns published daily)';
    } else {
      if (dateKey === todayKey) {
        cell.classList.add('today');
      }

      if (readCount >= 5) {
        cell.classList.add('fully-read');
      } else if (readCount > 0) {
        cell.classList.add('partially-read');
      }

      cell.title = `Click to load columns for ${dateKey} (${readCount}/5 completed)`;
    }

    cell.innerHTML = `
      <span class="cal-day-num">${d}</span>
      ${(!isBeforeLaunch && !isFuture) ? (readCount >= 5 ? '<span class="cal-day-read-count">5/5 ✓</span>' : (readCount > 0 ? `<span class="cal-day-read-count">${readCount}/5</span>` : '')) : ''}
    `;

    // Clicking a date cell
    cell.addEventListener('click', async () => {
      if (isBeforeLaunch) {
        showToast('LexiRead officially launched on August 23, 2026.');
        return;
      }
      if (isFuture) {
        showToast(`Columns for ${dateKey} will be published on that day!`);
        return;
      }
      calendarModal.style.display = 'none';
      state.selectedDate = dateKey;
      await loadArticlesForDate(dateKey);
      showToast(`Loaded columns for ${dateKey}`);
    });

    calendarDaysGrid.appendChild(cell);
  }
}

// ----------------------------------------------------
// PRONUNCIATION / SPEECH SYNTHESIS
// ----------------------------------------------------
function speakWordBrowser(word) {
  if (!word) return;
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel(); // cancel previous utterance
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }
}

// ----------------------------------------------------
// DAILY STREAK & DATA SYNC
// ----------------------------------------------------
let memoSyncTimeout = null;

function syncMemoToServer(memoText) {
  if (!state.user) return;
  clearTimeout(memoSyncTimeout);
  memoSyncTimeout = setTimeout(() => {
    apiRequest('/api/user/memo', {
      method: 'POST',
      body: JSON.stringify({ memo: memoText })
    }).catch(() => {});
  }, 500);
}

async function loadUserMemoFromServer() {
  if (!state.user) return;
  try {
    const resp = await apiRequest('/api/user/memo');
    if (resp.ok) {
      const data = await resp.json();
      if (typeof data.memo === 'string') {
        const localMemo = localStorage.getItem('lexiread_memo') || '';
        if (data.memo) {
          localStorage.setItem('lexiread_memo', data.memo);
          if (memoTextarea) memoTextarea.value = data.memo;
        } else if (localMemo) {
          syncMemoToServer(localMemo);
        }
      }
    }
  } catch (err) {
    console.error('Failed to load user memo:', err);
  }
}

async function loadUserStreak() {
  if (!state.user) return;
  try {
    const resp = await apiRequest('/api/user/streak');
    const data = await resp.json();
    state.streak = data;
    renderSidebarArticles();
  } catch (err) {
    console.error('Failed to load streak:', err);
  }
}

async function loadUserData() {
  await Promise.all([loadUserStreak(), loadUserMemoFromServer()]);
}

// ----------------------------------------------------
// AUTHENTICATION (SIGN UP & LOGIN)
// ----------------------------------------------------
async function checkAuthSession() {
  if (!state.token) {
    renderAuthSection();
    return;
  }
  try {
    const resp = await apiRequest('/api/auth/me');
    if (resp.ok) {
      const data = await resp.json();
      state.user = data.user;
      renderAuthSection();
    } else {
      logoutUser();
    }
  } catch (err) {
    logoutUser();
  }
}

function renderAuthSection() {
  if (!authSection) return;
  if (state.user) {
    authSection.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="font-size:13px; font-weight:600; color:var(--text-headline);">👤 ${escapeHTML(state.user.username)}</span>
        <button class="btn btn-outline" id="logout-btn" style="padding:4px 8px; font-size:11px;">Logout</button>
      </div>
    `;
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);
  } else {
    authSection.innerHTML = `<button class="btn btn-primary" id="open-login-btn">Sign In</button>`;
    const openLogin = document.getElementById('open-login-btn');
    if (openLogin) openLogin.addEventListener('click', () => openAuthModal());
  }
}

function openAuthModal(msg = '') {
  if (!authModal) return;
  if (loginError) loginError.textContent = msg;
  if (regError) regError.textContent = '';
  switchAuthTab('login');
  authModal.style.display = 'flex';
}

function switchAuthTab(tab) {
  if (tab === 'login') {
    if (tabLoginBtn) tabLoginBtn.classList.add('active');
    if (tabRegisterBtn) tabRegisterBtn.classList.remove('active');
    if (loginForm) loginForm.style.display = 'block';
    if (registerForm) registerForm.style.display = 'none';
  } else {
    if (tabRegisterBtn) tabRegisterBtn.classList.add('active');
    if (tabLoginBtn) tabLoginBtn.classList.remove('active');
    if (registerForm) registerForm.style.display = 'block';
    if (loginForm) loginForm.style.display = 'none';
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  if (loginError) loginError.textContent = '';
  const email = document.getElementById('login-email')?.value;
  const password = document.getElementById('login-password')?.value;

  try {
    const resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (loginError) loginError.textContent = data.error || 'Login failed';
      return;
    }

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('lexiread_token', data.token);

    if (authModal) authModal.style.display = 'none';
    renderAuthSection();
    await loadUserData();
    showToast(`Welcome back, ${state.user.username}!`);
  } catch (err) {
    if (loginError) loginError.textContent = 'Server connection error';
  }
}

async function handleRegisterSubmit(e) {
  e.preventDefault();
  if (regError) regError.textContent = '';
  const username = document.getElementById('reg-username')?.value;
  const email = document.getElementById('reg-email')?.value;
  const password = document.getElementById('reg-password')?.value;

  try {
    const resp = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password })
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (regError) regError.textContent = data.error || 'Registration failed';
      return;
    }

    state.token = data.token;
    state.user = data.user;
    localStorage.setItem('lexiread_token', data.token);

    if (authModal) authModal.style.display = 'none';
    renderAuthSection();
    await loadUserData();
    showToast(`Account created! Welcome, ${state.user.username}!`);
  } catch (err) {
    if (regError) regError.textContent = 'Server connection error';
  }
}

function logoutUser() {
  state.token = null;
  state.user = null;
  state.streak = { streakDays: 0, todayArticles: [], fullHistory: {} };
  localStorage.removeItem('lexiread_token');
  renderAuthSection();
  renderSidebarArticles();
  showToast('You have been logged out.');
}

// UTILITY
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}
