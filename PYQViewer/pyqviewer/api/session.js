const { createClient } = require('@supabase/supabase-js');
const { getSession, clearSessionCookie, parseBody } = require('../lib/auth');

module.exports = async (req, res) => {
  try {
    const body = parseBody(req);

    if (body.action === 'logout') {
      clearSessionCookie(res);
      return res.status(200).json({ success: true });
    }

    const session = getSession(req);
    if (!session) return res.status(200).json({ success: true, loggedIn: false });

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: teacher } = await supabase.from('teachers').select('id,name,email,role,status').eq('id', session.id).maybeSingle();
    if (!teacher || teacher.status !== 'approved') {
      clearSessionCookie(res);
      return res.status(200).json({ success: true, loggedIn: false });
    }

    return res.status(200).json({ success: true, loggedIn: true, teacher });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
};
