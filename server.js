const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'daily-english-reader-secret-key-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// DATA STORAGE (JSON File Database)
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const VOCAB_FILE = path.join(DATA_DIR, 'vocab.json');
const STREAKS_FILE = path.join(DATA_DIR, 'streaks.json');
const ARCHIVES_FILE = path.join(DATA_DIR, 'archives.json');
const SEEN_HISTORY_FILE = path.join(DATA_DIR, 'seen_history.json');

function loadJSON(file, defaultVal = {}) {
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return defaultVal; }
  }
  return defaultVal;
}
function saveJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function getTodayLocalDate() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ----------------------------------------------------
// AUTH MIDDLEWARE
// ----------------------------------------------------
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
}

// ----------------------------------------------------
// ARTICLE SCRAPER (The Guardian Opinion with Deduplication)
// ----------------------------------------------------
const BOILERPLATE_PATTERNS = [
  /^sign up to/i, /^free newsletter/i, /^enter your email/i,
  /guardian columnists and writers on what they/i, /^photograph\s*:/i,
  /^photograph by/i, /^image\s*:/i, /^illustration\s*:/i,
  /^explore more on these topics/i, /^reuse this content/i,
  /^follow us on/i, /^comments on this piece/i, /^listen to the latest/i,
  /terms and conditions apply/i, /to order a copy/i, /guardianbookshop/i,
  /is published by/i, /is released in/i, /is available from/i
];

function isBoilerplate(text) {
  const t = text.trim();
  return BOILERPLATE_PATTERNS.some(pat => pat.test(t));
}

function isAuthorBio(text, author) {
  if (!text) return false;
  const t = text.toLowerCase();
  const a = author.toLowerCase();
  const bioWords = [' is a ', ' is an ', ' is professor', ' is the author of', ' is founder of', 'columnist at', 'is a lawyer', 'is a journalist', 'is a writer', 'is a senior fellow'];
  if (a && t.includes(a) && bioWords.some(w => t.includes(w))) return true;
  return /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+\s+is\s+(a|an|the|professor|director|founder|co-founder|senior)/.test(text);
}

async function scrapeGuardianOpinionArticles(count = 5, seenUrls = new Set()) {
  const rssUrl = 'https://www.theguardian.com/commentisfree/rss';
  const resp = await axios.get(rssUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    timeout: 10000
  });

  const $ = cheerio.load(resp.data, { xmlMode: true });
  const items = $('item').toArray();
  const articles = [];

  for (let i = 0; i < items.length && articles.length < count; i++) {
    const item = $(items[i]);
    const rawTitle = item.find('title').text().trim();
    const link = item.find('link').text().trim();
    const pubDate = item.find('pubDate').text().trim();

    // Skip previously seen/read articles
    if (seenUrls.has(link)) {
      continue;
    }

    let title = rawTitle;
    let author = 'Guardian Columnist';
    if (rawTitle.includes(' | ')) {
      const parts = rawTitle.split(' | ');
      title = parts[0].trim();
      author = parts[parts.length - 1].trim();
    }

    try {
      const artResp = await axios.get(link, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      const art$ = cheerio.load(artResp.data);

      const main = art$('#maincontent, article').first();
      main.find('aside, figure, figcaption, gu-island, form, button, input, iframe, nav, header, footer, svg, style, script, noscript, [data-component="submeta"], [data-component="newsletter-signup"]').remove();

      let standfirst = art$('[data-gu-name="standfirst"], .content__standfirst').first().text().trim();
      if (isBoilerplate(standfirst)) standfirst = '';

      const paragraphs = [];
      main.find('p').each((_, p) => {
        const text = art$(p).text().replace(/\s+/g, ' ').trim();
        if (text.length > 40 && !isBoilerplate(text) && !isAuthorBio(text, author)) {
          paragraphs.push(text);
        }
      });

      // Deduplicate if standfirst matches first paragraph
      if (standfirst && paragraphs.length > 0) {
        const sNorm = standfirst.toLowerCase().replace(/[^a-z0-9]/g, '');
        const p0Norm = paragraphs[0].toLowerCase().replace(/[^a-z0-9]/g, '');
        if (sNorm === p0Norm || p0Norm.startsWith(sNorm) || sNorm.startsWith(p0Norm)) {
          standfirst = '';
        }
      }

      if (paragraphs.length >= 4) {
        const wordCount = paragraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0);
        articles.push({
          id: `art-${articles.length + 1}-${Buffer.from(title).toString('base64').substring(0, 8)}`,
          title,
          author,
          standfirst,
          url: link,
          pubDate,
          paragraphs,
          wordCount,
          estimatedReadingTime: Math.ceil(wordCount / 180)
        });
      }
    } catch (err) {
      console.error(`Error scraping ${link}:`, err.message);
    }
  }

  return articles;
}

// ----------------------------------------------------
// ARCHIVES & MIDNIGHT PRE-FETCH LOGIC
// ----------------------------------------------------
async function getOrCreateArticlesForDate(dateStr) {
  const archives = loadJSON(ARCHIVES_FILE, {});
  if (archives[dateStr] && archives[dateStr].length > 0) {
    return archives[dateStr];
  }

  const today = getTodayLocalDate();
  if (dateStr !== today && archives[dateStr]) {
    return archives[dateStr];
  }

  // Fetch new articles for today
  console.log(`[Auto-Prefetch] Fetching 5 fresh columns for ${dateStr}...`);
  const seenHistory = loadJSON(SEEN_HISTORY_FILE, []);
  const seenUrls = new Set(seenHistory.map(item => item.url));

  const articles = await scrapeGuardianOpinionArticles(5, seenUrls);
  if (articles.length > 0) {
    archives[dateStr] = articles;
    saveJSON(ARCHIVES_FILE, archives);

    // Update seen history
    articles.forEach(a => {
      seenHistory.push({ url: a.url, title: a.title, date: dateStr });
    });
    saveJSON(SEEN_HISTORY_FILE, seenHistory);
    console.log(`[Auto-Prefetch] Archived ${articles.length} new articles for ${dateStr}.`);
  }

  return articles;
}

// Check every 30 minutes to auto-prefetch when date rolls over at midnight
setInterval(async () => {
  try {
    const today = getTodayLocalDate();
    const archives = loadJSON(ARCHIVES_FILE, {});
    if (!archives[today] || archives[today].length === 0) {
      console.log(`[Scheduler] Midnight rollover detected! Pre-fetching for ${today}...`);
      await getOrCreateArticlesForDate(today);
    }
  } catch (e) {
    console.error('[Scheduler Error]:', e.message);
  }
}, 30 * 60 * 1000);

// ----------------------------------------------------
// REST APIS: ARTICLES & ARCHIVES
// ----------------------------------------------------
app.get('/api/articles/dates', (req, res) => {
  const archives = loadJSON(ARCHIVES_FILE, {});
  const today = getTodayLocalDate();
  const datesSet = new Set(Object.keys(archives));
  datesSet.add(today);

  const sortedDates = Array.from(datesSet).sort().reverse();
  res.json({ dates: sortedDates, today });
});

app.get('/api/articles/today', async (req, res) => {
  try {
    const today = getTodayLocalDate();
    const articles = await getOrCreateArticlesForDate(today);
    res.json({ date: today, articles });
  } catch (err) {
    console.error('Failed to get today\'s articles:', err);
    res.status(500).json({ error: 'Failed to retrieve articles' });
  }
});

app.get('/api/articles/:date', async (req, res) => {
  try {
    const dateStr = req.params.date;
    const articles = await getOrCreateArticlesForDate(dateStr);
    res.json({ date: dateStr, articles });
  } catch (err) {
    res.status(500).json({ error: 'Failed to retrieve archive' });
  }
});

// ----------------------------------------------------
// REST APIS: ENGLISH-ENGLISH DICTIONARY PROXY
// ----------------------------------------------------
const DICT_CACHE = {};

app.get('/api/dictionary/:word', async (req, res) => {
  const word = req.params.word.trim().toLowerCase().replace(/[^a-z'-]/g, '');
  if (!word || word.length < 2) {
    return res.status(400).json({ error: 'Invalid word' });
  }

  if (DICT_CACHE[word]) {
    return res.json(DICT_CACHE[word]);
  }

  try {
    const dictResp = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
      timeout: 6000
    });

    const data = dictResp.data[0];
    let phonetic = data.phonetic || (data.phonetics && data.phonetics.find(p => p.text)?.text) || '';
    let audioUrl = (data.phonetics && data.phonetics.find(p => p.audio && p.audio.length > 0)?.audio) || '';

    const meanings = (data.meanings || []).map(m => ({
      partOfSpeech: m.partOfSpeech,
      definitions: (m.definitions || []).slice(0, 3).map(d => ({
        definition: d.definition,
        example: d.example || null,
        synonyms: (d.synonyms || []).slice(0, 4)
      }))
    }));

    const result = {
      word: data.word,
      phonetic,
      audioUrl,
      meanings: meanings.slice(0, 3)
    };

    DICT_CACHE[word] = result;
    res.json(result);
  } catch (err) {
    res.status(404).json({
      error: `Definition for "${word}" not found in standard dictionary.`,
      word
    });
  }
});

// ----------------------------------------------------
// REST APIS: AUTH
// ----------------------------------------------------
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const users = loadJSON(USERS_FILE, []);
  const cleanEmail = email.trim().toLowerCase();

  if (users.some(u => u.email === cleanEmail)) {
    return res.status(400).json({ error: 'Email already registered' });
  }

  const salt = bcrypt.genSaltSync(10);
  const passwordHash = bcrypt.hashSync(password, salt);

  const newUser = {
    id: 'usr_' + Date.now(),
    username: username.trim(),
    email: cleanEmail,
    passwordHash,
    createdAt: new Date().toISOString()
  };

  users.push(newUser);
  saveJSON(USERS_FILE, users);

  const token = jwt.sign({ id: newUser.id, username: newUser.username, email: newUser.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: newUser.id, username: newUser.username, email: newUser.email } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const users = loadJSON(USERS_FILE, []);
  const cleanEmail = email.trim().toLowerCase();
  const user = users.find(u => u.email === cleanEmail);

  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ id: user.id, username: user.username, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email } });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// ----------------------------------------------------
// REST APIS: WORDBOOK
// ----------------------------------------------------
app.get('/api/user/vocab', authMiddleware, (req, res) => {
  const allVocab = loadJSON(VOCAB_FILE, {});
  const userVocab = allVocab[req.user.id] || [];
  res.json({ vocab: userVocab });
});

app.post('/api/user/vocab', authMiddleware, (req, res) => {
  const { word, phonetic, partOfSpeech, definition, example, articleTitle } = req.body;
  if (!word || !definition) {
    return res.status(400).json({ error: 'Word and definition required' });
  }

  const allVocab = loadJSON(VOCAB_FILE, {});
  if (!allVocab[req.user.id]) allVocab[req.user.id] = [];

  const existingIdx = allVocab[req.user.id].findIndex(v => v.word.toLowerCase() === word.toLowerCase());
  const newEntry = {
    id: 'voc_' + Date.now(),
    word: word.trim(),
    phonetic: phonetic || '',
    partOfSpeech: partOfSpeech || '',
    definition: definition || '',
    example: example || '',
    articleTitle: articleTitle || '',
    savedAt: new Date().toISOString()
  };

  if (existingIdx >= 0) {
    allVocab[req.user.id][existingIdx] = newEntry;
  } else {
    allVocab[req.user.id].unshift(newEntry);
  }

  saveJSON(VOCAB_FILE, allVocab);
  res.json({ success: true, entry: newEntry });
});

app.delete('/api/user/vocab/:id', authMiddleware, (req, res) => {
  const allVocab = loadJSON(VOCAB_FILE, {});
  if (!allVocab[req.user.id]) return res.json({ success: true });

  allVocab[req.user.id] = allVocab[req.user.id].filter(v => v.id !== req.params.id && v.word !== req.params.id);
  saveJSON(VOCAB_FILE, allVocab);
  res.json({ success: true });
});

// ----------------------------------------------------
// REST APIS: STREAK & CALENDAR
// ----------------------------------------------------
app.get('/api/user/streak', authMiddleware, (req, res) => {
  const allStreaks = loadJSON(STREAKS_FILE, {});
  const userStreak = allStreaks[req.user.id] || {
    streakDays: 0,
    lastReadDate: null,
    totalReadCount: 0,
    history: {}
  };

  const today = getTodayLocalDate();
  const todayArticles = userStreak.history[today] || [];

  res.json({
    streakDays: userStreak.streakDays || 0,
    lastReadDate: userStreak.lastReadDate,
    totalReadCount: userStreak.totalReadCount || 0,
    todayCompleted: todayArticles.length,
    todayArticles,
    fullHistory: userStreak.history || {}
  });
});

app.post('/api/user/toggle-read-article', authMiddleware, (req, res) => {
  const { articleId, completed, date } = req.body;
  if (!articleId) return res.status(400).json({ error: 'Article ID required' });

  const allStreaks = loadJSON(STREAKS_FILE, {});
  if (!allStreaks[req.user.id]) {
    allStreaks[req.user.id] = { streakDays: 0, lastReadDate: null, totalReadCount: 0, history: {} };
  }

  const userRecord = allStreaks[req.user.id];
  const targetDate = date || getTodayLocalDate();
  if (!userRecord.history) userRecord.history = {};
  if (!userRecord.history[targetDate]) userRecord.history[targetDate] = [];

  const isAlreadyRead = userRecord.history[targetDate].includes(articleId);

  if (completed !== false && !isAlreadyRead) {
    userRecord.history[targetDate].push(articleId);
    userRecord.totalReadCount = (userRecord.totalReadCount || 0) + 1;

    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    if (userRecord.lastReadDate === yesterday) {
      userRecord.streakDays = (userRecord.streakDays || 0) + 1;
    } else if (userRecord.lastReadDate !== targetDate) {
      userRecord.streakDays = 1;
    }
    userRecord.lastReadDate = targetDate;
  } else if (completed === false && isAlreadyRead) {
    userRecord.history[targetDate] = userRecord.history[targetDate].filter(id => id !== articleId);
    userRecord.totalReadCount = Math.max(0, (userRecord.totalReadCount || 1) - 1);
  }

  saveJSON(STREAKS_FILE, allStreaks);

  res.json({
    success: true,
    isRead: userRecord.history[targetDate].includes(articleId),
    streakDays: userRecord.streakDays,
    todayArticles: userRecord.history[targetDate],
    fullHistory: userRecord.history
  });
});

// START SERVER
app.listen(PORT, async () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Global English Reader Server running on port ${PORT}`);
  console.log(`👉 Open http://localhost:${PORT} in your browser`);
  console.log(`======================================================\n`);

  // Initial prefetch for today
  try {
    const today = getTodayLocalDate();
    await getOrCreateArticlesForDate(today);
  } catch (e) {
    console.error('Initial pre-fetch note:', e.message);
  }
});
