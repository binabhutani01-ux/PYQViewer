const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { parseBody } = require('../lib/auth');

const OWNER_COOKIE = 'pyq_owner';
const SECRET = process.env.SESSION_SECRET;

// Credentials live ONLY as hashed environment variables set in Vercel —
// never in this file, never in the database, never visible to the head
// teacher account or any teacher account.
const OWNER_ACCOUNTS = [
  { user: process.env.OWNER1_USER, hash: process.env.OWNER1_HASH },
  { user: process.env.OWNER2_USER, hash: process.env.OWNER2_HASH },
].filter(a => a.user && a.hash);

function getOwnerSession(req) {
  const header = req.headers.cookie || '';
  const match = header.split(';').map(s => s.trim()).find(s => s.startsWith(OWNER_COOKIE + '='));
  if (!match || !SECRET) return null;
  try { return jwt.verify(decodeURIComponent(match.split('=')[1]), SECRET); } catch (e) { return null; }
}

module.exports = async (req, res) => {
  try {
    const body = parseBody(req);
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    if (body.action === 'login') {
      const { username, password } = body;
      const account = OWNER_ACCOUNTS.find(a => a.user === username);
      const ok = account ? await bcrypt.compare(String(password || ''), account.hash) : false;
      if (!ok) return res.status(200).json({ success: false, error: 'Invalid credentials.' });
      const token = jwt.sign({ role: 'owner', user: username }, SECRET, { expiresIn: '12h' });
      res.setHeader('Set-Cookie', `${OWNER_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`);
      return res.status(200).json({ success: true });
    }

    const session = getOwnerSession(req);
    if (!session) return res.status(200).json({ success: false, error: 'Not authorized.' });

    if (body.action === 'logout') {
      res.setHeader('Set-Cookie', `${OWNER_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`);
      return res.status(200).json({ success: true });
    }

    if (body.action === 'status') {
      const { data } = await supabase.from('settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
      return res.status(200).json({ success: true, maintenance: data ? data.value === 'true' : false });
    }

    if (body.action === 'toggle_maintenance') {
      const on = body.on ? 'true' : 'false';
      await supabase.from('settings').upsert({ key: 'maintenance_mode', value: on });
      return res.status(200).json({ success: true, maintenance: on === 'true' });
    }

    if (body.action === 'purge_everything') {
      const { data: rows } = await supabase.from('worksheets').select('file_path');
      await supabase.from('worksheets').delete().neq('id', '');
      const paths = (rows || []).map(r => r.file_path).filter(Boolean);
      if (paths.length) await supabase.storage.from('worksheets').remove(paths);
      return res.status(200).json({ success: true });
    }

    if (body.action === 'overview') {
      const { data: teachers } = await supabase.from('teachers').select('*').order('created_at', { ascending: false });
      const { data: worksheets } = await supabase.from('worksheets').select('id,teacher_id,title,created_at');
      const { data: events } = await supabase.from('login_events').select('*').order('created_at', { ascending: false }).limit(100);
      return res.status(200).json({ success: true, teachers: teachers || [], worksheets: worksheets || [], events: events || [] });
    }

    return res.status(200).json({ success: false, error: 'Unknown action.' });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
};
