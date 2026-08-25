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

// ----------------------------------------------------
// DYNAMIC SEO & SITEMAP ROUTES (Google Search Console)
// ----------------------------------------------------
app.get('/robots.txt', (req, res) => {
  const host = req.get('host') || 'lexiread-app.onrender.com';
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}`;
  res.type('text/plain; charset=utf-8');
  res.send(`User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (req, res) => {
  const host = req.get('host') || 'lexiread-app.onrender.com';
  const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}`;
  const today = getTodayLocalDate();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${baseUrl}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`;

  res.type('application/xml; charset=utf-8');
  res.send(xml);
});

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
  /^sign up to/i,
  /^free newsletter/i,
  /^enter your email/i,
  /guardian columnists and writers on what they/i,
  /^photograph\s*:/i,
  /^photograph by/i,
  /^image\s*:/i,
  /^illustration\s*:/i,
  /^explore more on these topics/i,
  /^reuse this content/i,
  /^follow us on/i,
  /^comments on this piece/i,
  /^listen to the latest/i,
  /terms and conditions apply/i,
  /privacy notice/i,
  /to order a copy/i,
  /guardianbookshop/i,
  /is published by/i,
  /is released in/i,
  /is available from/i,
  /is published as part of/i,
  /in partnership with/i,
  /part of a partnership/i,
  /supported by a grant/i,
  /do you have an opinion on the issues raised/i,
  /submit a response of up to/i,
  /publication in our letters section/i,
  /letters section, please/i,
  /please click here/i,
  /tell us in the comments/i,
  /share your story/i,
  /we want to hear from you/i,
  /email us at/i,
  /this article was amended on/i,
  /this piece was amended on/i,
  /in the uk and ireland.*helpline/i,
  /in the us.*helpline/i
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

const CATEGORY_CHANNELS = [
  {
    name: 'Culture & Books',
    tag: 'Culture',
    feeds: [
      'https://www.theguardian.com/books/rss',
      'https://www.theguardian.com/culture/rss'
    ]
  },
  {
    name: 'Life & Psychology',
    tag: 'Life',
    feeds: [
      'https://www.theguardian.com/lifeandstyle/rss'
    ]
  },
  {
    name: 'Science & Tech',
    tag: 'Science',
    feeds: [
      'https://www.theguardian.com/science/rss',
      'https://www.theguardian.com/technology/rss'
    ]
  },
  {
    name: 'The Long Read',
    tag: 'Long Read',
    feeds: [
      'https://www.theguardian.com/news/series/the-long-read/rss'
    ]
  },
  {
    name: 'Global Ideas',
    tag: 'Global',
    feeds: [
      'https://www.theguardian.com/commentisfree/rss',
      'https://www.theguardian.com/world/rss'
    ]
  }
];

async function scrapeSingleCategoryArticle(channel, seenUrls) {
  for (const feedUrl of channel.feeds) {
    try {
      const resp = await axios.get(feedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      const $ = cheerio.load(resp.data, { xmlMode: true });
      const items = $('item').toArray();

      for (const itemEl of items) {
        const item = $(itemEl);
        const rawTitle = item.find('title').text().trim();
        const link = item.find('link').text().trim();
        const pubDate = item.find('pubDate').text().trim();

        if (!link || seenUrls.has(link)) continue;
        const lowerTitle = rawTitle.toLowerCase();
        if (lowerTitle.includes('video') || lowerTitle.includes('podcast') || lowerTitle.includes('in pictures') || lowerTitle.includes('gallery')) {
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

          // Extract real author byline if available
          const byline = art$('address, [rel="author"], [data-component="meta-byline"]').first().text().trim() || art$('meta[name="author"]').attr('content');
          if (byline && author === 'Guardian Columnist') {
            author = byline.replace(/^By\s+/i, '').trim();
          }

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
            return {
              category: channel.name,
              categoryTag: channel.tag,
              title,
              author,
              standfirst,
              url: link,
              pubDate,
              paragraphs,
              wordCount,
              estimatedReadingTime: Math.ceil(wordCount / 180)
            };
          }
        } catch (err) {
          // Continue trying other articles in feed
        }
      }
    } catch (err) {
      console.error(`Feed ${feedUrl} error:`, err.message);
    }
  }
  return null;
}

async function scrapeGuardianOpinionArticles(count = 5, seenUrls = new Set()) {
  const articles = [];
  const localSeen = new Set(seenUrls);

  for (let i = 0; i < CATEGORY_CHANNELS.length && articles.length < count; i++) {
    const channel = CATEGORY_CHANNELS[i];
    const article = await scrapeSingleCategoryArticle(channel, localSeen);
    if (article) {
      article.id = `art-${articles.length + 1}-${Buffer.from(article.title).toString('base64').substring(0, 8)}`;
      localSeen.add(article.url);
      articles.push(article);
    }
  }

  // Failover: If any category failed to return an article, fill up to count from backup feed
  if (articles.length < count) {
    try {
      const backupResp = await axios.get('https://www.theguardian.com/commentisfree/rss', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 10000
      });
      const $ = cheerio.load(backupResp.data, { xmlMode: true });
      const items = $('item').toArray();

      for (const itemEl of items) {
        if (articles.length >= count) break;
        const link = $(itemEl).find('link').text().trim();
        if (!link || localSeen.has(link)) continue;

        const rawTitle = $(itemEl).find('title').text().trim();
        let title = rawTitle;
        let author = 'Guardian Columnist';
        if (rawTitle.includes(' | ')) {
          const parts = rawTitle.split(' | ');
          title = parts[0].trim();
          author = parts[parts.length - 1].trim();
        }

        try {
          const artResp = await axios.get(link, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
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

          if (paragraphs.length >= 4) {
            const wordCount = paragraphs.reduce((sum, p) => sum + p.split(/\s+/).length, 0);
            localSeen.add(link);
            articles.push({
              id: `art-${articles.length + 1}-${Buffer.from(title).toString('base64').substring(0, 8)}`,
              category: 'Global Ideas',
              categoryTag: 'Global',
              title,
              author,
              standfirst,
              url: link,
              pubDate: $(itemEl).find('pubDate').text().trim(),
              paragraphs,
              wordCount,
              estimatedReadingTime: Math.ceil(wordCount / 180)
            });
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      console.error('Backup scraper error:', e.message);
    }
  }

  return articles;
}

// Calculate the furthest ahead local date currently on Earth (UTC+14)
function getGlobalMaxLocalDate() {
  const d = new Date(Date.now() + 14 * 3600 * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTodayLocalDate() {
  return getGlobalMaxLocalDate();
}

const SERVICE_START_DATE = '2026-08-23';

function sanitizeArchives() {
  const archives = loadJSON(ARCHIVES_FILE, {});
  const maxAllowed = getGlobalMaxLocalDate();
  let modified = false;
  for (const dateKey of Object.keys(archives)) {
    if (dateKey < SERVICE_START_DATE || dateKey > maxAllowed) {
      delete archives[dateKey];
      modified = true;
    }
  }
  if (modified) saveJSON(ARCHIVES_FILE, archives);
  return archives;
}

// ----------------------------------------------------
// ARCHIVES & MIDNIGHT PRE-FETCH LOGIC
// ----------------------------------------------------
async function getOrCreateArticlesForDate(dateStr) {
  // STRICT RULE 1: Before service start date (2026-08-23), no columns exist
  if (!dateStr || dateStr < SERVICE_START_DATE) {
    return [];
  }

  const archives = sanitizeArchives();
  if (archives[dateStr] && archives[dateStr].length > 0) {
    return archives[dateStr];
  }

  const maxAllowed = getGlobalMaxLocalDate();
  // STRICT RULE 2: Future dates beyond today anywhere on Earth cannot be fetched
  if (dateStr > maxAllowed) {
    return [];
  }

  // Fetch new articles for today (or valid date on/after launch)
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

// Check every 10 minutes to auto-prefetch when date rolls over
setInterval(async () => {
  try {
    const today = getTodayLocalDate();
    if (today >= SERVICE_START_DATE) {
      const archives = sanitizeArchives();
      if (!archives[today] || archives[today].length === 0) {
        console.log(`[Scheduler] New date detected! Pre-fetching for ${today}...`);
        await getOrCreateArticlesForDate(today);
      }
    }
  } catch (e) {
    console.error('[Scheduler Error]:', e.message);
  }
}, 10 * 60 * 1000);

// Auto-prefetch on startup
(async () => {
  try {
    const today = getTodayLocalDate();
    if (today >= SERVICE_START_DATE) {
      await getOrCreateArticlesForDate(today);
    }
  } catch (e) {
    console.error('Initial prefetch error:', e.message);
  }
})();

// ----------------------------------------------------
// REST APIS: ARTICLES & ARCHIVES
// ----------------------------------------------------
app.get('/api/articles/dates', (req, res) => {
  const archives = sanitizeArchives();
  const today = getTodayLocalDate();
  const validDates = Object.keys(archives).filter(d => d >= SERVICE_START_DATE && d <= today);
  if (!validDates.includes(today) && today >= SERVICE_START_DATE) {
    validDates.push(today);
  }

  const sortedDates = validDates.sort().reverse();
  res.json({ dates: sortedDates, today, startDate: SERVICE_START_DATE });
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
// REST APIS: PER-COLUMN MEMO & NOTEPAD SYNC
// ----------------------------------------------------
const MEMOS_FILE = path.join(DATA_DIR, 'memos.json');

app.get('/api/user/memo', authMiddleware, (req, res) => {
  const allMemos = loadJSON(MEMOS_FILE, {});
  const userMemos = allMemos[req.user.id] || {};
  if (typeof userMemos === 'string') {
    res.json({ memos: { '_general': userMemos }, memo: userMemos });
  } else {
    res.json({ memos: userMemos, memo: userMemos['_general'] || '' });
  }
});

app.post('/api/user/memo', authMiddleware, (req, res) => {
  const { memo, articleId, memos } = req.body;
  const allMemos = loadJSON(MEMOS_FILE, {});
  if (!allMemos[req.user.id] || typeof allMemos[req.user.id] !== 'object') {
    allMemos[req.user.id] = {};
  }
  
  if (memos && typeof memos === 'object') {
    allMemos[req.user.id] = { ...allMemos[req.user.id], ...memos };
  } else if (articleId) {
    allMemos[req.user.id][articleId] = typeof memo === 'string' ? memo : '';
  } else if (typeof memo === 'string') {
    allMemos[req.user.id]['_general'] = memo;
  }
  
  saveJSON(MEMOS_FILE, allMemos);
  res.json({ success: true, memos: allMemos[req.user.id] });
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

// ----------------------------------------------------
// REST APIS: ADMIN & USER STATS
// ----------------------------------------------------
app.get('/api/admin/stats', (req, res) => {
  const users = loadJSON(USERS_FILE, []);
  const streaks = loadJSON(STREAKS_FILE, {});
  const memos = loadJSON(MEMOS_FILE, {});

  const sanitizedUsers = users.map(u => ({
    username: u.username,
    email: u.email,
    joinedAt: u.createdAt
  }));

  res.json({
    totalRegisteredUsers: users.length,
    users: sanitizedUsers,
    activeStreakUsersCount: Object.keys(streaks).length,
    usersWithMemosCount: Object.keys(memos).length,
    serverTime: new Date().toISOString()
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
