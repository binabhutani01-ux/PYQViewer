const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const SESSION_SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'pyq_session';

// ---- Password hashing ----
async function hashPassword(plain) {
  return bcrypt.hash(plain, 10);
}
async function comparePassword(plain, hash) {
  if (!hash) return false;
  return bcrypt.compare(plain, hash);
}

// ---- Session tokens (httpOnly cookie, JWT-signed) ----
// payload: { id, name, role }  role: 'teacher' | 'head' | 'owner'
function signSession(payload) {
  if (!SESSION_SECRET) throw new Error('SESSION_SECRET env var is not set.');
  return jwt.sign(payload, SESSION_SECRET, { expiresIn: '180d' });
}
function verifySession(token) {
  if (!token || !SESSION_SECRET) return null;
  try {
    return jwt.verify(token, SESSION_SECRET);
  } catch (e) {
    return null;
  }
}
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  });
  return out;
}
function getSession(req) {
  const cookies = parseCookies(req);
  return verifySession(cookies[COOKIE_NAME]);
}
function setSessionCookie(res, token) {
  const maxAge = 180 * 24 * 60 * 60; // 180 days, matches JWT expiry -> "stay logged in until sign out"
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
}

// ---- Request body parsing (mirrors original uploadthing.js behavior) ----
function parseBody(req) {
  let body = {};
  if (req.body && typeof req.body === 'object') body = req.body;
  else if (typeof req.body === 'string' && req.body.length) {
    try { body = JSON.parse(req.body); } catch (e) { body = {}; }
  }
  if (req.query) body = { ...req.query, ...body };
  return body;
}

// ---- Client network info, for login-event reporting ----
function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || 'unknown';
}

async function reverseGps(latitude, longitude) {
  const lat = Number(latitude), lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  // Prefer MapTiler when a server-side key is configured.
  const maptilerKey = process.env.MAPTILER_API_KEY;
  if (maptilerKey) {
    try {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 2200);
      const r = await fetch(`https://api.maptiler.com/geocoding/${encodeURIComponent(lon)},${encodeURIComponent(lat)}.json?language=en&limit=1&key=${encodeURIComponent(maptilerKey)}`, {signal: controller.signal});
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json();
        const f = data?.features?.[0];
        if (f) {
          const ctx = Array.isArray(f.context) ? f.context : [];
          const find = (...types) => {
            for (const type of types) {
              const hit = ctx.find(x => typeof x.id === 'string' && x.id.startsWith(type + '.'));
              if (hit) return hit.text || hit.name || '';
            }
            return '';
          };
          return {
            city: find('place','municipality','locality') || ((f.place_type||[]).includes('place') ? (f.text || '') : ''),
            region: find('region'),
            country: find('country') || f.properties?.country || ''
          };
        }
      }
    } catch (e) { console.warn('MapTiler GPS reverse geocode failed:', e.message); }
  }

  // Keyless fallback: OpenStreetMap Nominatim. Login volume is low, so this is
  // used only for GPS fixes and only when MapTiler is not configured/available.
  try {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 2200);
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&zoom=10&addressdetails=1`, {
      headers: { 'User-Agent': 'PYQViewer/2.0 GPS reverse geocoder' }, signal: controller.signal
    });
    clearTimeout(timer);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const a = d?.address || {};
    return {
      city: a.city || a.town || a.village || a.municipality || a.county || '',
      region: a.state || a.state_district || '',
      country: a.country || ''
    };
  } catch (e) {
    console.warn('Nominatim GPS reverse geocode failed:', e.message);
    return null;
  }
}

async function lookupGeo(req) {
  const ip = getClientIp(req);
  // Vercel's edge network already resolves every request's geo-IP data and
  // stamps it onto the request as headers — free, instant, no external call,
  // no rate limits. This is far more reliable than calling a third-party API
  // from inside the function (which is what was silently failing before).
  const h = req.headers || {};
  const vCity = h['x-vercel-ip-city'];
  if (vCity) {
    return {
      ip,
      city: decodeURIComponent(vCity),
      region: h['x-vercel-ip-country-region'] || '',
      country: h['x-vercel-ip-country'] || '',
      lat: h['x-vercel-ip-latitude'] ? parseFloat(h['x-vercel-ip-latitude']) : null,
      lon: h['x-vercel-ip-longitude'] ? parseFloat(h['x-vercel-ip-longitude']) : null,
    };
  }
  // Fallback for local dev / non-Vercel hosting, where those headers don't exist.
  if (!ip || ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('::1')) {
    return { ip, city: 'Local/Unknown', region: '', country: '', lat: null, lon: null };
  }
  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!r.ok) throw new Error('geo lookup failed');
    const d = await r.json();
    return { ip, city: d.city || 'Unknown', region: d.region || '', country: d.country_name || '', lat: d.latitude ?? null, lon: d.longitude ?? null };
  } catch (e) {
    return { ip, city: 'Unknown', region: '', country: '', lat: null, lon: null };
  }
}

function parseDevice(userAgent) {
  const ua = userAgent || '';
  let browser = 'Unknown browser';
  if (/Edg\//.test(ua)) browser = 'Edge';
  else if (/Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
  else if (/Firefox\//.test(ua)) browser = 'Firefox';
  let os = 'Unknown OS';
  if (/Windows/.test(ua)) os = 'Windows';
  else if (/Mac OS X/.test(ua)) os = 'macOS';
  else if (/Android/.test(ua)) os = 'Android';
  else if (/iPhone|iPad/.test(ua)) os = 'iOS';
  else if (/Linux/.test(ua)) os = 'Linux';
  return `${browser} on ${os}`;
}

// ---- Live revocation check ----
// Sessions are stateless JWTs, so a signed cookie stays valid until it expires
// even if the owner console force-logs-out the teacher. To make "force logout"
// actually work, every protected endpoint re-checks the teacher's current
// status + session_version against what's baked into the token. Bumping
// session_version (owner action) or setting status away from 'approved'
// immediately invalidates all of that teacher's existing tokens.
async function requireActiveTeacher(supabase, session) {
  if (!session) return { ok: false, error: 'Not signed in.' };
  if (session.role === 'owner') return { ok: true, teacher: null }; // owner uses its own separate cookie/session
  const { data: teacher, error } = await supabase.from('teachers').select('id,name,email,role,status,session_version').eq('id', session.id).maybeSingle();
  if (error) {
    // Don't let a DB/schema hiccup (e.g. the session_version migration not run
    // yet) lock every teacher out of uploading. Log it and fail OPEN instead —
    // worse case is force-logout doesn't work yet, not that nothing works.
    console.error('requireActiveTeacher: lookup failed, failing open —', error.message);
    return { ok: true, teacher: { id: session.id, name: session.name, role: session.role } };
  }
  if (!teacher || teacher.status !== 'approved') return { ok: false, error: 'Your session has ended. Please sign in again.' };
  const tokenSv = session.sv || 0;
  const currentSv = teacher.session_version || 0;
  if (tokenSv !== currentSv) return { ok: false, error: 'You were signed out by an administrator. Please sign in again.' };
  return { ok: true, teacher };
}

module.exports = {
  reverseGps,
  hashPassword, comparePassword,
  signSession, verifySession, getSession, setSessionCookie, clearSessionCookie,
  parseBody, getClientIp, lookupGeo, parseDevice,
  requireActiveTeacher,
};
