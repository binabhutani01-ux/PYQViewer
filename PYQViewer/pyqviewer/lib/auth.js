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

async function lookupGeo(ip) {
  if (!ip || ip === 'unknown' || ip.startsWith('127.') || ip.startsWith('::1')) {
    return { city: 'Local/Unknown', country: '' };
  }
  try {
    const r = await fetch(`https://ipapi.co/${ip}/json/`);
    if (!r.ok) throw new Error('geo lookup failed');
    const d = await r.json();
    return { city: d.city || 'Unknown', country: d.country_name || '' };
  } catch (e) {
    return { city: 'Unknown', country: '' };
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

module.exports = {
  hashPassword, comparePassword,
  signSession, verifySession, getSession, setSessionCookie, clearSessionCookie,
  parseBody, getClientIp, lookupGeo, parseDevice,
};
