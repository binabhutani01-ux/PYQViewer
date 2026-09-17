const { createClient } = require('@supabase/supabase-js');
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const {
  signSession, setSessionCookie, parseBody,
  getClientIp, lookupGeo, parseDevice,
} = require('../lib/auth');

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const HEAD_TEACHER_EMAIL = (process.env.HEAD_TEACHER_EMAIL || '').toLowerCase();

module.exports = async (req, res) => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const body = parseBody(req);
    const credential = body.credential;
    if (!credential) return res.status(200).json({ success: false, error: 'Missing Google credential.' });
    if (!GOOGLE_CLIENT_ID) return res.status(200).json({ success: false, error: 'Server is missing GOOGLE_CLIENT_ID.' });

    const client = new OAuth2Client(GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email_verified) {
      return res.status(200).json({ success: false, error: 'Google account email is not verified.' });
    }
    const email = String(payload.email).toLowerCase();
    if (!email.endsWith('@gmail.com')) {
      return res.status(200).json({ success: false, error: 'Please register with a Gmail address.' });
    }
    const googleSub = payload.sub;
    const displayName = payload.name || email.split('@')[0];

    // Find existing teacher by google_sub or email
    let { data: existing } = await supabase.from('teachers').select('*').or(`google_sub.eq.${googleSub},email.eq.${email}`).maybeSingle();

    let teacher = existing;
    if (!teacher) {
      const isHead = email === HEAD_TEACHER_EMAIL && HEAD_TEACHER_EMAIL.length > 0;
      const newTeacher = {
        id: 'tch_' + crypto.randomBytes(8).toString('hex'),
        name: displayName,
        email,
        google_sub: googleSub,
        role: isHead ? 'head' : 'teacher',
        status: isHead ? 'approved' : 'pending',
        created_at: new Date().toISOString(),
      };
      const { data: inserted, error: insertErr } = await supabase.from('teachers').insert([newTeacher]).select().maybeSingle();
      if (insertErr) return res.status(200).json({ success: false, error: insertErr.message });
      teacher = inserted;
    }

    if (teacher.status !== 'approved') {
      return res.status(200).json({ success: false, pending: true, error: 'Your account is registered and waiting for approval from the head teacher.' });
    }

    // ---- Log this login + detect new device/location, report to head ----
    const ip = getClientIp(req);
    const geo = await lookupGeo(ip);
    const device = parseDevice(req.headers['user-agent']);
    const deviceKey = crypto.createHash('sha256').update(`${teacher.id}|${device}|${geo.city}|${geo.country}`).digest('hex');

    const { data: priorDevice } = await supabase.from('login_events').select('id').eq('teacher_id', teacher.id).eq('device_key', deviceKey).limit(1).maybeSingle();
    const isNewDevice = !priorDevice;

    await supabase.from('login_events').insert([{
      id: 'evt_' + crypto.randomBytes(8).toString('hex'),
      teacher_id: teacher.id,
      teacher_name: teacher.name,
      ip,
      city: geo.city,
      country: geo.country,
      device,
      device_key: deviceKey,
      is_new_device: isNewDevice,
      created_at: new Date().toISOString(),
    }]);

    const token = signSession({ id: teacher.id, name: teacher.name, role: teacher.role });
    setSessionCookie(res, token);

    return res.status(200).json({
      success: true,
      teacher: { id: teacher.id, name: teacher.name, email: teacher.email, role: teacher.role },
    });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
};
