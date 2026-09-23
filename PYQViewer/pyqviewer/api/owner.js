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

    if (body.action === 'appearance_get') {
      const { data: rows, error } = await supabase.from('settings').select('key,value').in('key', ['site_theme','site_font','site_motion','site_density','site_radius','site_glass','site_accent','site_accent2','site_background','site_bg1','site_bg2']);
      if (error) return res.status(200).json({success:false,error:error.message});
      const map = Object.fromEntries((rows||[]).map(r=>[r.key,r.value]));
      return res.status(200).json({success:true,appearance:{theme:['original','paper','operator','glass','graphite','soft-dusk','porcelain','mint','solar','liquid-chrome','aurora','plasma','ocean-light','terminal','midnight-rose','studio-light'].includes(map.site_theme)?map.site_theme:'original',font:map.site_font||'sf',motion:map.site_motion||'balanced',density:map.site_density||'balanced',radius:map.site_radius||'balanced',glass:Number(map.site_glass||70),accent:map.site_accent||null,accent2:map.site_accent2||null,background:map.site_background||null,bg1:map.site_bg1||null,bg2:map.site_bg2||null}});
    }
    if (body.action === 'appearance_update') {
      const theme=['original','paper','operator','glass','graphite','soft-dusk','porcelain','mint','solar','liquid-chrome','aurora','plasma','ocean-light','terminal','midnight-rose','studio-light'].includes(body.theme)?body.theme:'original';
      const font=['sf','system','inter','jakarta','manrope','dm','outfit','space','ibm','source','nunito','work','poppins','lato'].includes(body.font)?body.font:'sf';
      const motion=['cinematic','balanced','low','off'].includes(body.motion)?body.motion:'balanced';
      const density=['compact','balanced','roomy'].includes(body.density)?body.density:'balanced';
      const radius=['sharp','balanced','round'].includes(body.radius)?body.radius:'balanced';
      const glass=Math.min(100,Math.max(20,Number(body.glass ?? 70)));
      const cleanColor=v=>/^#[0-9a-fA-F]{6}$/.test(String(v||''))?String(v):''; const accent=cleanColor(body.accent); const accent2=cleanColor(body.accent2); const allowedBackgrounds=['auto','original','aurora','soft-aurora','dark-veil','liquid-flow','chrome-waves','plasma','threads','ripple-grid','dot-field','paper-grid','matrix-grid','sunset-rays','clean-glow','soft-orbs','silk','light-pillar','grainient','color-bends','prismatic-burst']; const background=(body.background==='auto'||allowedBackgrounds.includes(body.background))?body.background:''; const bg1=cleanColor(body.bg1); const bg2=cleanColor(body.bg2); const values=[{key:'site_theme',value:theme},{key:'site_font',value:font},{key:'site_motion',value:motion},{key:'site_density',value:density},{key:'site_radius',value:radius},{key:'site_glass',value:String(glass)},{key:'site_accent',value:accent},{key:'site_accent2',value:accent2},{key:'site_background',value:background},{key:'site_bg1',value:bg1},{key:'site_bg2',value:bg2}];
      const {error}=await supabase.from('settings').upsert(values,{onConflict:'key'});
      if(error)return res.status(200).json({success:false,error:error.message});
      const {data:verify,error:verifyErr}=await supabase.from('settings').select('key,value').in('key',values.map(v=>v.key));
      if(verifyErr)return res.status(200).json({success:false,error:verifyErr.message});
      const m=Object.fromEntries((verify||[]).map(r=>[r.key,r.value]));
      return res.status(200).json({success:true,appearance:{theme:m.site_theme,font:m.site_font,motion:m.site_motion,density:m.site_density,radius:m.site_radius,glass:Number(m.site_glass||glass),accent:m.site_accent||null,accent2:m.site_accent2||null,background:m.site_background||null,bg1:m.site_bg1||null,bg2:m.site_bg2||null}});
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
      return res.status(200).json({
        success: true,
        teachers: teachers || [],
        worksheets: worksheets || [],
        subjects: subjects || [],
        sub_subjects: subSubjects || [],
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
      const { error } = await supabase.from('teachers').delete().eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'create_subject_as_teacher') {
      const name = String(body.name || '').trim();
      const teacherId = String(body.teacher_id || '').trim();
      if (!name || !teacherId) return res.status(200).json({ success: false, error: 'Teacher and subject name are required.' });
      const { data: teacher } = await supabase.from('teachers').select('id,name').eq('id', teacherId).maybeSingle();
      if (!teacher) return res.status(200).json({ success: false, error: 'Teacher not found.' });
      const { data, error } = await supabase.from('subjects').insert([{
        id:'sub_' + require('crypto').randomBytes(6).toString('hex'), name, created_by:teacher.id, created_by_name:teacher.name, status:'approved', approved_by:null, created_at:new Date().toISOString()
      }]).select().maybeSingle();
      if (error) return res.status(200).json({ success:false, error:error.message });
      return res.status(200).json({ success:true, subject:data });
    }

    if (body.action === 'create_subsubject_as_teacher') {
      const name = String(body.name || '').trim();
      const teacherId = String(body.teacher_id || '').trim();
      const subjectId = String(body.subject_id || '').trim();
      if (!name || !teacherId || !subjectId) return res.status(200).json({ success:false, error:'Teacher, parent subject and sub-subject name are required.' });
      const [{ data: teacher }, { data: subject }] = await Promise.all([
        supabase.from('teachers').select('id,name').eq('id',teacherId).maybeSingle(),
        supabase.from('subjects').select('id').eq('id',subjectId).maybeSingle()
      ]);
      if (!teacher) return res.status(200).json({ success:false, error:'Teacher not found.' });
      if (!subject) return res.status(200).json({ success:false, error:'Subject not found.' });
      const { data, error } = await supabase.from('sub_subjects').insert([{
        id:'ssub_' + require('crypto').randomBytes(6).toString('hex'), subject_id:subjectId, name, created_by:teacher.id, created_by_name:teacher.name, created_at:new Date().toISOString()
      }]).select().maybeSingle();
      if (error) return res.status(200).json({ success:false, error:error.message });
      return res.status(200).json({ success:true, sub_subject:data });
    }

    if (body.action === 'approve_subject' || body.action === 'deauthenticate_subject') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing subject id.' });
      const patch = body.action === 'approve_subject' ? { status: 'approved' } : { status: 'pending', approved_by: null };
      const { error } = await supabase.from('subjects').update(patch).eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
    }

    if (body.action === 'delete_subject') {
      const id = body.id;
      if (!id) return res.status(200).json({ success: false, error: 'Missing subject id.' });
      const { data: subs } = await supabase.from('sub_subjects').select('id').eq('subject_id', id);
      const subIds = (subs || []).map(x=>x.id);
      const { data: subjectFiles } = await supabase.from('worksheets').select('file_path').eq('subject_id', id);
      const { error: wsErr } = await supabase.from('worksheets').delete().eq('subject_id', id);
      if (wsErr) return res.status(200).json({ success:false, error:wsErr.message });
      const paths = (subjectFiles || []).map(x=>x.file_path).filter(Boolean);
      if(paths.length) await supabase.storage.from('worksheets').remove(paths);
      if(subIds.length){
        const { error: ssErr } = await supabase.from('sub_subjects').delete().in('id', subIds);
        if(ssErr) return res.status(200).json({ success:false, error:ssErr.message });
      }
      const { error } = await supabase.from('subjects').delete().eq('id', id);
      if (error) return res.status(200).json({ success: false, error: error.message });
      return res.status(200).json({ success: true });
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
