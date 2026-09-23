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

const THEMES = new Set(['midnight','ocean','orchid','ember','forest','graphite']);
function cleanSvg(svg){
  let s = String(svg || '').trim();
  if (!s || !/^<svg[\s>]/i.test(s)) throw new Error('Logo must be an SVG document.');
  if (s.length > 250000) throw new Error('Logo SVG is too large.');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '').replace(/\s(on[a-z]+)\s*=\s*(\"[^\"]*\"|\'[^\']*\'|[^\s>]+)/gi, '').replace(/javascript:/gi,'');
  return s;
}

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

    if (body.action === 'get_settings') {
      const { data, error } = await supabase.from('settings').select('key,value').in('key', ['customize_enabled','default_theme','theme_reset_token','logo_svg']);
      if (error) return res.status(200).json({ success: false, error: error.message });
      const map = Object.fromEntries((data || []).map(x => [x.key, x.value]));
      return res.status(200).json({ success: true, settings: {
        customize_enabled: map.customize_enabled !== 'false',
        default_theme: map.default_theme || 'midnight',
        theme_reset_token: map.theme_reset_token || '0',
        logo_svg: map.logo_svg || ''
      }});
    }

    if (body.action === 'set_customization') {
      const enabled = !!body.enabled;
      const { error } = await supabase.from('settings').upsert({ key: 'customize_enabled', value: enabled ? 'true' : 'false' }, { onConflict: 'key' });
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, enabled });
    }

    if (body.action === 'set_default_theme') {
      const theme = String(body.theme || 'midnight');
      if (!THEMES.has(theme)) return res.status(200).json({ success: false, error: 'Invalid theme.' });
      const { error } = await supabase.from('settings').upsert({ key: 'default_theme', value: theme }, { onConflict: 'key' });
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, theme });
    }

    if (body.action === 'reset_all_themes') {
      const token = String(Date.now());
      const { error } = await supabase.from('settings').upsert({ key: 'theme_reset_token', value: token }, { onConflict: 'key' });
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, theme_reset_token: token });
    }

    if (body.action === 'set_logo') {
      try {
        const svg = cleanSvg(body.svg);
        const { error } = await supabase.from('settings').upsert({ key: 'logo_svg', value: svg }, { onConflict: 'key' });
        if (error) return res.status(200).json({ success: false, error: error.message });
        return res.status(200).json({ success: true });
      } catch (e) { return res.status(200).json({ success: false, error: e.message }); }
    }

    if (body.action === 'clear_logo') {
      const { error } = await supabase.from('settings').upsert({ key: 'logo_svg', value: '' }, { onConflict: 'key' });
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'toggle_maintenance') {
      const on = body.on ? 'true' : 'false';
      const { error } = await supabase.from('settings').upsert({ key: 'maintenance_mode', value: on }, { onConflict: 'key' });
      if (error) return res.status(200).json({ success: false, error: 'Could not save: ' + error.message });
      // Read the row back rather than trusting the write — if this ever
      // silently no-ops again (bad onConflict target, RLS, etc.) the owner
      // console will show the real state instead of a false "success".
      const { data: verify, error: verifyErr } = await supabase.from('settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
      if (verifyErr || !verify || verify.value !== on) {
        return res.status(200).json({ success: false, error: 'Write did not persist — check that the settings table exists with (key text primary key, value text).' });
      }
      return res.status(200).json({ success: true, maintenance: verify.value === 'true' });
    }


    // Hide a login's location from the map without deleting the login record.
    // IP, teacher, event ID, timestamp and all other login information remain intact.
    if (body.action === 'hide_login_location') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing login event id.' });
      const { error } = await supabase
        .from('login_events')
        .update({ location_hidden: true })
        .eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    // Restore all locations that were hidden from the map.
    if (body.action === 'restore_map_locations') {
      const { error } = await supabase
        .from('login_events')
        .update({ location_hidden: false })
        .eq('location_hidden', true);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'purge_everything') {
      const { data: rows } = await supabase.from('worksheets').select('file_path');
      await supabase.from('worksheets').delete().neq('id', '');
      const paths = (rows || []).map(r => r.file_path).filter(Boolean);
      if (paths.length) await supabase.storage.from('worksheets').remove(paths);
      return res.status(200).json({ success: true });
    }

    // ---- Full site overview: every teacher, subject, worksheet, login event ----
    if (body.action === 'overview') {
      const { data: teachers } = await supabase.from('teachers').select('*').order('created_at', { ascending: false });
      const { data: worksheets } = await supabase.from('worksheets').select('*').order('created_at', { ascending: false });
      const { data: subjects } = await supabase.from('subjects').select('*').order('name');
      const { data: subSubjects } = await supabase.from('sub_subjects').select('*').order('name');
      const { data: events } = await supabase.from('login_events').select('*').order('created_at', { ascending: false }).limit(100);
      const subRows = subSubjects || [];
      const subjectRows = (subjects || []).map(s => ({
        ...s,
        sub_subjects: subRows.filter(ss => String(ss.subject_id) === String(s.id))
      }));
      return res.status(200).json({
        success: true,
        teachers: teachers || [],
        worksheets: worksheets || [],
        subjects: subjectRows,
        sub_subjects: subRows,
        events: events || [],
      });
    }

    // ---- Owner has full head-teacher powers, from its own console, no
    // dependency on also holding a teacher session cookie ----

    if (body.action === 'approve_teacher' || body.action === 'reject_teacher') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing teacher id.' });
      if (body.action === 'approve_teacher') {
        const { error } = await supabase.from('teachers').update({ status: 'approved' }).eq('id', id);
        if (error) return res.status(200).json({ success: false, error: error.message });
      } else {
        const { error } = await supabase.from('teachers').delete().eq('id', id);
        if (error) return res.status(200).json({ success: false, error: error.message });
      }
      return res.status(200).json({ success: true });
    }

    if (body.action === 'update_teacher') {
      const id = body.id; if (!id) return res.status(200).json({ success: false, error: 'Missing teacher id.' });
      const patch = {};
      if (body.name != null && String(body.name).trim()) patch.name = String(body.name).trim();
      if (body.role != null) { if (!['teacher','head'].includes(body.role)) return res.status(200).json({ success: false, error: 'Invalid role.' }); patch.role = body.role; }
      if (body.status != null) { if (!['approved','pending'].includes(body.status)) return res.status(200).json({ success: false, error: 'Invalid status.' }); patch.status = body.status; }
      const { error } = await supabase.from('teachers').update(patch).eq('id', id); if (error) return res.status(200).json({ success: false, error: error.message });
      if (patch.name) await supabase.from('worksheets').update({ teacher_name: patch.name }).eq('teacher_id', id);
      return res.status(200).json({ success: true });
    }

    if (body.action === 'set_teacher_role') {
      const id = body.id;
      const role = body.role;
      if (!id || !['teacher', 'head'].includes(role)) return res.status(200).json({ success: false, error: 'Missing/invalid id or role.' });
      const { error } = await supabase.from('teachers').update({ role }).eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    // ---- Force-logout: bump session_version so that teacher's existing
    // signed cookie stops being accepted the next time any endpoint checks it ----
    if (body.action === 'force_logout_teacher') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing teacher id.' });
      const { data: t } = await supabase.from('teachers').select('session_version').eq('id', id).maybeSingle();
      if (!t) return res.status(200).json({ success: false, error: 'Teacher not found.' });
      const { error } = await supabase.from('teachers').update({ session_version: (t.session_version || 0) + 1 }).eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'delete_teacher') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing teacher id.' });
      // Keep historical worksheets/logins usable while removing the account.
      await supabase.from('worksheets').update({ teacher_id: null, teacher_name: 'Former teacher' }).eq('teacher_id', id);
      await supabase.from('login_events').update({ teacher_id: null }).eq('teacher_id', id);
      await supabase.from('subjects').update({ created_by: null }).eq('created_by', id);
      await supabase.from('subjects').update({ approved_by: null }).eq('approved_by', id);
      await supabase.from('sub_subjects').update({ created_by: null }).eq('created_by', id);
      const { error } = await supabase.from('teachers').delete().eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'approve_subject' || body.action === 'deauthenticate_subject') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing subject id.' });
      const patch = body.action === 'approve_subject' ? { status: 'approved' } : { status: 'pending', approved_by: null };
      const { error } = await supabase.from('subjects').update(patch).eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'create_subject') {
      const name = String(body.name || '').trim();
      if (!name) return res.status(200).json({ success: false, error: 'Subject name required.' });
      const { data, error } = await supabase.from('subjects').insert([{ id: 'sub_dev_' + Date.now(), name, created_by: null, created_by_name: 'Developer', status: 'approved', approved_by: null, created_at: new Date().toISOString() }]).select().maybeSingle();
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, subject: data });
    }

    if (body.action === 'update_subject') {
      const id = body.id, name = String(body.name || '').trim();
      if (!id || !name) return res.status(200).json({ success: false, error: 'Subject id and name are required.' });
      const { error } = await supabase.from('subjects').update({ name }).eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'delete_subject') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing subject id.' });
      const { data: files } = await supabase.from('worksheets').select('id,file_path').eq('subject_id', id);
      if ((files || []).length) {
        await supabase.from('worksheets').delete().eq('subject_id', id);
        const paths = files.map(x => x.file_path).filter(Boolean); if (paths.length) await supabase.storage.from('worksheets').remove(paths);
      }
      await supabase.from('sub_subjects').delete().eq('subject_id', id);
      const { error } = await supabase.from('subjects').delete().eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'create_subsubject') {
      const subjectId = String(body.subject_id || ''), name = String(body.name || '').trim();
      if (!subjectId || !name) return res.status(200).json({ success: false, error: 'Subject and sub-subject name are required.' });
      const { data, error } = await supabase.from('sub_subjects').insert([{ id: 'ssub_dev_' + Date.now(), subject_id: subjectId, name, created_by: null, created_by_name: 'Developer', created_at: new Date().toISOString() }]).select().maybeSingle();
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true, sub_subject: data });
    }

    if (body.action === 'update_subsubject') {
      const id = body.id, name = String(body.name || '').trim(), subjectId = body.subject_id ? String(body.subject_id) : undefined;
      if (!id || !name) return res.status(200).json({ success: false, error: 'Sub-subject id and name are required.' });
      const patch = subjectId ? { name, subject_id: subjectId } : { name };
      const { error } = await supabase.from('sub_subjects').update(patch).eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'delete_subsubject') {
      const id = body.id; if (!id) return res.status(200).json({ success: false, error: 'Missing sub-subject id.' });
      const { error: clearErr } = await supabase.from('worksheets').update({ sub_subject_id: null }).eq('sub_subject_id', id); if (clearErr) return res.status(200).json({ success: false, error: clearErr.message });
      const { error } = await supabase.from('sub_subjects').delete().eq('id', id); if (error) return res.status(200).json({ success: false, error: error.message }); return res.status(200).json({ success: true });
    }

    if (body.action === 'update_worksheet') {
      const id = body.id; if (!id) return res.status(200).json({ success: false, error: 'Missing worksheet id.' });
      const patch = {};
      if (body.title != null) { const title=String(body.title).trim(); if(!title) return res.status(200).json({ success:false,error:'Worksheet title cannot be empty.' }); patch.title=title; }
      if (body.subject_id != null) {
        const { data: subj } = await supabase.from('subjects').select('id').eq('id', body.subject_id).maybeSingle();
        if(!subj) return res.status(200).json({success:false,error:'Subject not found.'});
        patch.subject_id=body.subject_id;
      }
      if (body.sub_subject_id !== undefined) {
        if(body.sub_subject_id){
          const { data: ss } = await supabase.from('sub_subjects').select('id,subject_id').eq('id',body.sub_subject_id).maybeSingle();
          if(!ss) return res.status(200).json({success:false,error:'Sub-subject not found.'});
          const targetSubject=patch.subject_id || (await supabase.from('worksheets').select('subject_id').eq('id',id).maybeSingle()).data?.subject_id;
          if(targetSubject && String(ss.subject_id)!==String(targetSubject)) return res.status(200).json({success:false,error:'Sub-subject does not belong to the selected subject.'});
        }
        patch.sub_subject_id=body.sub_subject_id || null;
      }
      if (body.teacher_id !== undefined) {
        const { data: t } = await supabase.from('teachers').select('id,name').eq('id', body.teacher_id).maybeSingle(); if (!t) return res.status(200).json({ success: false, error: 'Teacher not found.' }); patch.teacher_id=t.id; patch.teacher_name=t.name;
      }
      const { data, error } = await supabase.from('worksheets').update(patch).eq('id', id).select().maybeSingle(); if (error) return res.status(200).json({ success: false, error: error.message }); return res.status(200).json({ success: true, worksheet: data });
    }

    if (body.action === 'create_worksheet') {
      const title=String(body.title||'Untitled Worksheet').trim(), file_url=String(body.file_url||''), file_path=body.file_path||null, subject_id=body.subject_id||null, sub_subject_id=body.sub_subject_id||null, teacher_id=body.teacher_id||null;
      if (!title || !file_url || !subject_id || !teacher_id) return res.status(200).json({ success: false, error: 'Title, file, subject and teacher are required.' });
      const { data:t }=await supabase.from('teachers').select('id,name').eq('id',teacher_id).maybeSingle(); if(!t) return res.status(200).json({success:false,error:'Teacher not found.'});
      const { data:subj }=await supabase.from('subjects').select('id').eq('id',subject_id).maybeSingle(); if(!subj) return res.status(200).json({success:false,error:'Subject not found.'});
      if(sub_subject_id){ const { data:ss }=await supabase.from('sub_subjects').select('id,subject_id').eq('id',sub_subject_id).maybeSingle(); if(!ss) return res.status(200).json({success:false,error:'Sub-subject not found.'}); if(String(ss.subject_id)!==String(subject_id)) return res.status(200).json({success:false,error:'Sub-subject does not belong to the selected subject.'}); }
      const row={id:'ws_dev_'+Date.now(),title,file_url,file_path,subject_id,sub_subject_id,teacher_id:t.id,teacher_name:t.name,created_at:new Date().toISOString()};
      const { data, error }=await supabase.from('worksheets').insert([row]).select().maybeSingle(); if(error) return res.status(200).json({success:false,error:error.message}); return res.status(200).json({success:true,worksheet:data});
    }

    if (body.action === 'delete_worksheet') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing worksheet id.' });
      const { data: existing } = await supabase.from('worksheets').select('file_path').eq('id', id).maybeSingle();
      const { error } = await supabase.from('worksheets').delete().eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      if (existing && existing.file_path) await supabase.storage.from('worksheets').remove([existing.file_path]);
      return res.status(200).json({ success: true });
    }

    return res.status(200).json({ success: false, error: 'Unknown action.' });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
};
