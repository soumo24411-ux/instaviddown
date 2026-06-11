// VOIDGRAB Instagram downloader function.
// Modes:
//   ?status=1                -> health check
//   ?url=<instagram_url>     -> fetch media links from RapidAPI
//   ?proxy=1&url=<media_url> -> proxy media as a forced download

const API_HOST = 'instagram-post-reels-stories-downloader-api.p.rapidapi.com';
const API_TIMEOUT_MS = 18000;
const PROXY_TIMEOUT_MS = 26000;

exports.handler = async function (event, context) {
  const requestId = context && context.awsRequestId ? context.awsRequestId : `vg_${Date.now()}`;
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: corsHeaders, body: '' };
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed', requestId }, corsHeaders);

  const params = event.queryStringParameters || {};
  if (params.status === '1') {
    return json(200, { ok: true, service: 'VOIDGRAB API', requestId, timestamp: new Date().toISOString() }, corsHeaders);
  }

  const targetUrl = (params.url || '').trim();
  if (!targetUrl) return json(400, { error: 'URL parameter missing', requestId }, corsHeaders);

  if (params.proxy === '1') {
    return proxyMedia(targetUrl, corsHeaders, requestId);
  }

  if (!isValidInstagramUrl(targetUrl)) {
    return json(400, { error: 'Paste a valid public Instagram Reel, post, TV, or share URL.', requestId }, corsHeaders);
  }

  const rapidApiKey = process.env.RAPIDAPI_KEY;
  if (!rapidApiKey) {
    console.error('[VOIDGRAB]', requestId, 'Missing RAPIDAPI_KEY');
    return json(500, { error: 'Server configuration error. Downloader API key is not configured.', requestId }, corsHeaders);
  }

  try {
    const apiUrl = `https://${API_HOST}/download?url=${encodeURIComponent(targetUrl)}`;
    const response = await fetchWithRetry(apiUrl, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'x-rapidapi-host': API_HOST,
        'x-rapidapi-key': rapidApiKey,
        'User-Agent': 'VOIDGRAB/1.0 (+https://instaviddown.netlify.app)',
      },
    }, API_TIMEOUT_MS, 2, requestId);

    const rawText = await response.text();
    console.log('[VOIDGRAB]', requestId, 'RapidAPI status', response.status, 'bytes', rawText.length);

    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return json(502, { error: 'Downloader provider rejected the server credentials.', requestId }, corsHeaders);
      }
      if (response.status === 429) {
        return json(429, { error: 'Rate limit reached. Wait a moment and retry.', requestId }, corsHeaders);
      }
      return json(502, { error: 'Instagram provider failed to load this page. Copy a fresh public Reel link and retry.', requestId }, corsHeaders);
    }

    let data;
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch (err) {
      console.error('[VOIDGRAB]', requestId, 'Invalid JSON from provider');
      return json(502, { error: 'Downloader provider returned an invalid response. Retry shortly.', requestId }, corsHeaders);
    }

    const normalized = normalizeProviderResponse(data);
    if (!normalized.links.length) {
      return json(404, {
        error: 'No downloadable media was found. The Reel may be private, expired, or unavailable.',
        requestId,
      }, corsHeaders);
    }

    return json(200, { ...data, normalized, requestId }, corsHeaders);
  } catch (err) {
    console.error('[VOIDGRAB]', requestId, 'Function error', err.name, err.message);
    const timedOut = err.name === 'AbortError' || /timeout/i.test(err.message);
    return json(timedOut ? 504 : 502, {
      error: timedOut ? 'Request timed out while contacting the downloader provider. Retry with a fresh link.' : 'Failed to reach downloader provider.',
      requestId,
    }, corsHeaders);
  }
};

async function proxyMedia(targetUrl, corsHeaders, requestId) {
  if (!isSafeProxyUrl(targetUrl)) {
    return json(400, { error: 'Proxy URL must be a valid HTTPS media URL.', requestId }, corsHeaders);
  }

  try {
    const response = await fetchWithTimeout(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 12; Mobile) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36',
        'Referer': 'https://www.instagram.com/',
        'Accept': 'video/mp4,video/*,audio/*,*/*;q=0.8',
      },
    }, PROXY_TIMEOUT_MS);

    if (!response.ok) {
      console.error('[VOIDGRAB]', requestId, 'Proxy upstream status', response.status);
      return json(502, { error: 'Direct download source failed. Use the fallback link.', requestId }, corsHeaders);
    }

    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get('content-type') || guessContentType(targetUrl);
    const ext = contentType.includes('audio') ? 'mp3' : 'mp4';

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="voidgrab_download.${ext}"`,
        'Content-Length': String(buffer.byteLength),
        'Accept-Ranges': 'bytes',
      },
      body: Buffer.from(buffer).toString('base64'),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('[VOIDGRAB]', requestId, 'Proxy error', err.name, err.message);
    return json(504, { error: 'Download proxy timed out. Use the fallback link.', requestId }, corsHeaders);
  }
}

function json(statusCode, payload, headers) {
  return {
    statusCode,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
  };
}

function isValidInstagramUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return ['instagram.com', 'instagr.am'].includes(host) && /\/(reel|p|tv|share)\//.test(url.pathname);
  } catch (err) {
    return false;
  }
}

function isSafeProxyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname);
  } catch (err) {
    return false;
  }
}

async function fetchWithRetry(url, options, timeoutMs, retries, requestId) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === retries) return response;
      console.warn('[VOIDGRAB]', requestId, 'Retrying provider request', attempt + 1, 'status', response.status);
      await delay(450 * (attempt + 1));
    } catch (err) {
      lastError = err;
      if (attempt === retries) throw err;
      console.warn('[VOIDGRAB]', requestId, 'Retrying provider request after error', err.name);
      await delay(450 * (attempt + 1));
    }
  }
  throw lastError || new Error('Provider request failed');
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeProviderResponse(data) {
  const root = data && (data.result || data.data || data);
  const links = [];
  const seen = new Set();
  let title = '';
  let thumbnail = '';
  let duration = '';
  let fileSize = '';

  function push(url, quality, type) {
    if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url) || seen.has(url)) return;
    if (/instagram\.com\/(reel|p|tv)\//i.test(url)) return;
    seen.add(url);
    links.push({ url, quality: quality || 'HD', type: type || 'video' });
  }

  function scan(obj) {
    if (!obj || typeof obj !== 'object') return;
    title = title || obj.title || obj.caption || obj.description || '';
    thumbnail = thumbnail || obj.thumbnail || obj.thumbnail_url || obj.thumb || obj.cover || obj.image || '';
    duration = duration || obj.duration || obj.video_duration || '';
    fileSize = fileSize || obj.file_size || obj.filesize || obj.size || '';
    ['download_url', 'video_url', 'url', 'src', 'hd', 'sd'].forEach((key) => push(obj[key], obj.quality || obj.label || key.toUpperCase(), obj.type));
    ['links', 'versions', 'medias', 'media', 'videos', 'items', 'resources'].forEach((key) => {
      if (Array.isArray(obj[key])) obj[key].forEach((item) => (typeof item === 'string' ? push(item, 'HD', 'video') : scan(item)));
    });
  }

  if (Array.isArray(root)) root.forEach(scan);
  else scan(root);

  return {
    title: title || 'Instagram Reel',
    thumbnail,
    duration: duration || 'Unknown',
    fileSize: fileSize || 'Calculated on download',
    quality: links[0] ? links[0].quality : 'HD',
    links,
  };
}

function guessContentType(url) {
  return /\.mp3(\?|$)/i.test(url) ? 'audio/mpeg' : 'video/mp4';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
