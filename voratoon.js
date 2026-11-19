/**
 * Netlify Function - Voratoon scraper proxy
 * Source: https://13.voratoon.com
 * Node 18+ (global fetch)
 */
const BASE_URL = 'https://13.voratoon.com';
const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'Referer': `${BASE_URL}/`
};

function extractSlug(input) {
  if (!input || typeof input !== 'string') return '';
  return input.trim()
    .replace(/^https?:\/\/[^/]+/i, '')
    .replace(/^\/?(?:series\/)?/i, '')
    .replace(/\/chapter\/.*$/i, '')
    .replace(/^\/+|\/+$/g, '');
}

function extractChapterIndex(input) {
  if (input === undefined || input === null) return '';
  const str = String(input).trim();
  const urlMatch = str.match(/\/chapter\/([^/?#]+)/i);
  if (urlMatch) return urlMatch[1];
  const prefixMatch = str.match(/^(?:chapter|ch|bab)[-_ ]*([0-9]+(?:\.[0-9]+)?)$/i);
  if (prefixMatch) return prefixMatch[1];
  return str.replace(/^\/+|\/+$/g, '');
}

async function fetchPage(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: DEFAULT_HEADERS,
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Situs sumber mengembalikan HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function parseJsonAtKey(str, key) {
  const idx = str.indexOf(key);
  if (idx === -1) return null;
  const sub = str.slice(idx + key.length);
  let depth = 0, endIdx = -1, inString = false, escape = false;
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (!inString) {
      if (c === '{' || c === '[') depth++;
      else if (c === '}' || c === ']') {
        depth--;
        if (depth === 0) { endIdx = i + 1; break; }
      }
    }
  }
  if (endIdx !== -1) {
    try { return JSON.parse(sub.slice(0, endIdx)); } catch { return null; }
  }
  return null;
}

function extractInitialData(html) {
  const pushRegex = /self\.__next_f\.push\(\[1,\s*"((?:[^"\\]|\\.)*)"\]\)/g;
  const chunks = [];
  let match;
  while ((match = pushRegex.exec(html)) !== null) {
    try { chunks.push(JSON.parse(`"${match[1]}"`)); }
    catch {
      chunks.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t'));
    }
  }
  for (const chunk of chunks) {
    if (chunk.includes('"initialData":')) {
      const data = parseJsonAtKey(chunk, '"initialData":');
      if (data) return data;
    }
  }
  const combined = chunks.join('');
  return combined.includes('"initialData":')
    ? parseJsonAtKey(combined, '"initialData":') : null;
}

function normalizeChapter(raw, seriesSlug) {
  if (!raw) return null;
  const d = raw.data || {};
  const index = raw.chapterIndex !== undefined ? raw.chapterIndex :
    (d.index !== undefined ? d.index : null);
  return {
    id: raw.id || null,
    seriesId: raw.seriesId || d.seriesId || null,
    chapterIndex: index,
    title: d.title || (index !== null ? `Chapter ${index}` : ''),
    createdAt: raw.createdAt || null,
    views: raw.views?.total ? Number(raw.views.total) :
      (typeof raw.views === 'number' ? raw.views : 0),
    url: seriesSlug && index !== null
      ? `${BASE_URL}/series/${seriesSlug}/chapter/${index}` : ''
  };
}

function normalizeSeries(raw) {
  if (!raw) return null;
  const d = raw.data || {};
  const genres = Array.isArray(d.genres) ? d.genres.map(g => ({
    id: g.id, name: g.data?.name || g.name || '',
    description: g.data?.description || ''
  })) : [];
  const chapters = (raw.chapters || []).map(c => normalizeChapter(c, d.slug));
  return {
    id: raw.id || null, title: d.title || '', nativeTitle: d.nativeTitle || '',
    slug: d.slug || '', coverImage: d.coverImage || '',
    backgroundImage: d.backgroundImage || '', synopsis: (d.synopsis || '').trim(),
    author: d.author || '',
    rating: typeof d.rating === 'number' ? d.rating : parseFloat(d.rating) || 0,
    totalChapters: d.totalChapters || String(chapters.length || 0),
    releaseDate: d.releaseDate || '', status: d.status || '',
    format: d.format || '', type: d.type || '',
    isHot: Boolean(d.isHot), isPinned: Boolean(d.isPinned),
    isRecommended: Boolean(d.isRecommended), animeAdaptation: Boolean(d.animeAdaptation),
    genres, chapters,
    url: d.slug ? `${BASE_URL}/series/${d.slug}` : ''
  };
}

async function getHome() {
  const html = await fetchPage(`${BASE_URL}/`);
  const data = extractInitialData(html);
  if (!data) throw new Error('Data beranda tidak ditemukan. Struktur situs mungkin berubah atau akses diblokir.');
  return {
    banner: (data.banner || []).map(normalizeSeries).filter(Boolean),
    popular: (data.popular || []).map(normalizeSeries).filter(Boolean),
    updates: (data.updates || []).map(normalizeSeries).filter(Boolean),
    newSeries: (data.newSeries || []).map(normalizeSeries).filter(Boolean),
    completed: (data.completed || []).map(normalizeSeries).filter(Boolean),
    announcements: (data.announcements || []).map(a => ({
      id: a.id, content: a.content || a.data?.title || '', createdAt: a.createdAt
    }))
  };
}

async function getCatalog(options = {}) {
  const params = new URLSearchParams();
  for (const key of ['q', 'genre', 'status', 'format', 'type', 'anime', 'min', 'page']) {
    const value = options[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      if (key === 'page' && Number(value) <= 1) continue;
      if (key === 'min' && Number(value) <= 0) continue;
      params.set(key, String(value).trim());
    }
  }
  if (options.sort && String(options.sort).toLowerCase() !== 'new') {
    params.set('sort', String(options.sort).toLowerCase());
  }
  const url = `${BASE_URL}/browse${params.toString() ? `?${params}` : ''}`;
  const html = await fetchPage(url);
  const data = extractInitialData(html);
  if (!data) throw new Error('Data katalog tidak ditemukan. Coba lagi beberapa saat.');
  const series = (data.series || []).map(normalizeSeries).filter(Boolean);
  const meta = data.seriesMeta || { total: series.length, page: Number(options.page) || 1, lastPage: 1 };
  return {
    meta: {
      total: Number(meta.total || 0), page: Number(meta.page || options.page || 1),
      lastPage: Number(meta.lastPage || 1)
    },
    filters: data.filters || {}, count: series.length, series
  };
}

async function getGenres() {
  const html = await fetchPage(`${BASE_URL}/browse`);
  const data = extractInitialData(html);
  if (!data || !data.genres) throw new Error('Daftar genre tidak berhasil dimuat.');
  return data.genres.map(g => ({
    id: g.id, name: g.data?.name || g.name || '',
    description: g.data?.description || ''
  }));
}

async function getRanking(options = {}) {
  let period = 'Daily', page = 1, kind = 'comics';
  if (typeof options === 'string') period = options;
  else if (options && typeof options === 'object') {
    period = options.period || period;
    page = Math.max(1, parseInt(options.page, 10) || 1);
    kind = options.kind || kind;
  }
  const formattedPeriod = period.charAt(0).toUpperCase() + period.slice(1).toLowerCase();
  const params = new URLSearchParams();
  if (kind !== 'comics') params.set('kind', kind);
  params.set('period', formattedPeriod);
  if (page > 1) params.set('page', String(page));
  const html = await fetchPage(`${BASE_URL}/ranking?${params}`);
  const data = extractInitialData(html);
  if (!data) throw new Error('Data ranking tidak berhasil dimuat.');
  const rawComics = data.comics || [];
  const meta = data.comicsMeta || { total: rawComics.length, page, lastPage: 1 };
  return {
    meta: {
      total: Number(meta.total || 0), page: Number(meta.page || page),
      lastPage: Number(meta.lastPage || 1),
      period: data.initialPeriod || formattedPeriod, kind: data.initialKind || kind
    },
    fetchedAt: data.fetchedAt || null, count: rawComics.length,
    comics: rawComics.map(normalizeSeries).filter(Boolean)
  };
}

async function getDetail(slugOrUrl) {
  const cleanSlug = extractSlug(slugOrUrl);
  if (!cleanSlug) throw new Error('Slug komik belum diisi.');
  const html = await fetchPage(`${BASE_URL}/series/${cleanSlug}`);
  const data = extractInitialData(html);
  if (!data || !data.series || !data.series[0]) throw new Error(`Komik "${cleanSlug}" tidak ditemukan atau gagal dibaca.`);
  const seriesRaw = data.series[0];
  const detail = normalizeSeries(seriesRaw);
  const allChaptersRaw = data.chapters || seriesRaw.chapters || [];
  const chapters = allChaptersRaw.map(c => normalizeChapter(c, cleanSlug)).filter(Boolean);
  chapters.sort((a, b) => {
    const na = Number(a.chapterIndex), nb = Number(b.chapterIndex);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return nb - na;
    return String(b.chapterIndex).localeCompare(String(a.chapterIndex), undefined, { numeric: true });
  });
  detail.chapters = chapters;
  detail.totalChapters = String(chapters.length);
  detail.firstChapter = chapters.length ? chapters[chapters.length - 1] : null;
  detail.latestChapter = chapters.length ? chapters[0] : null;
  return detail;
}

async function getChapter(slugOrUrl, chapterIndexOrUrl) {
  const cleanSlug = extractSlug(slugOrUrl);
  if (!cleanSlug) throw new Error('Slug komik belum diisi.');
  const cleanIndex = extractChapterIndex(chapterIndexOrUrl);
  if (!cleanIndex) throw new Error('Nomor chapter belum diisi.');
  const html = await fetchPage(`${BASE_URL}/series/${cleanSlug}/chapter/${cleanIndex}`);
  const data = extractInitialData(html);
  if (!data || !data.chapter) throw new Error(`Chapter ${cleanIndex} tidak ditemukan atau gagal dibaca.`);
  const ch = data.chapter;
  const seriesInfo = data.series?.[0] ? normalizeSeries(data.series[0]) : null;
  const images = (ch.data?.images || []).map((url, idx) => ({ page: idx + 1, url }));
  const indices = (data.chapters || [])
    .map(c => c.chapterIndex !== undefined ? c.chapterIndex : c.data?.index)
    .filter(x => x !== undefined && x !== null);
  indices.sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  });
  const currentPos = indices.findIndex(idx => String(idx) === String(cleanIndex) || Number(idx) === Number(cleanIndex));
  const prev = currentPos > 0 ? indices[currentPos - 1] : null;
  const next = currentPos !== -1 && currentPos < indices.length - 1 ? indices[currentPos + 1] : null;
  const resolvedIndex = ch.chapterIndex !== undefined ? ch.chapterIndex : cleanIndex;
  return {
    id: ch.id || null, seriesSlug: cleanSlug, seriesTitle: seriesInfo?.title || '',
    chapterIndex: resolvedIndex, title: ch.data?.title || `Chapter ${resolvedIndex}`,
    createdAt: ch.createdAt || null, views: ch.views?.total ? Number(ch.views.total) : 0,
    totalImages: images.length, images,
    navigation: {
      current: resolvedIndex, prev, next,
      prevUrl: prev !== null ? `${BASE_URL}/series/${cleanSlug}/chapter/${prev}` : null,
      nextUrl: next !== null ? `${BASE_URL}/series/${cleanSlug}/chapter/${next}` : null,
      first: indices[0] ?? null, latest: indices[indices.length - 1] ?? null,
      allChapters: indices
    }
  };
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': statusCode === 200 ? 'public, max-age=60, s-maxage=120' : 'no-store'
    },
    body: JSON.stringify(payload)
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'GET') return json(405, { ok: false, error: 'Metode tidak didukung.' });
  const p = event.queryStringParameters || {};
  const action = String(p.action || 'home').toLowerCase();
  try {
    let result;
    switch (action) {
      case 'home':
        result = await getHome();
        break;
      case 'search':
      case 'catalog':
        result = await getCatalog({
          q: p.q || '', genre: p.genre || '', status: p.status || '',
          format: p.format || '', type: p.type || '', anime: p.anime || '',
          sort: p.sort || 'new', min: p.min || '', page: p.page || 1
        });
        break;
      case 'detail':
        result = await getDetail(p.slug || p.id || p.url || '');
        break;
      case 'chapter':
        result = await getChapter(p.slug || p.id || '', p.chapter || p.index || '');
        break;
      case 'ranking':
        result = await getRanking({ period: p.period || 'Daily', page: p.page || 1, kind: 'comics' });
        break;
      case 'genres':
        result = await getGenres();
        break;
      default:
        return json(400, { ok: false, error: 'Action tidak dikenal.' });
    }
    return json(200, { ok: true, action, data: result });
  } catch (error) {
    return json(502, {
      ok: false,
      action,
      error: error?.message || 'Gagal mengambil data dari sumber.'
    });
  }
};
