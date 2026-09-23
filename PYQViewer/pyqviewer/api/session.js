const { createClient } = require('@supabase/supabase-js');
const { getSession, clearSessionCookie, parseBody, requireActiveTeacher } = require('../lib/auth');

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
    const check = await requireActiveTeacher(supabase, session);
    if (!check.ok) {
      clearSessionCookie(res);
      return res.status(200).json({ success: true, loggedIn: false });
    }

    if (body.action === 'appearance_get' || body.action === 'appearance_update' || body.action === 'appearance_reset') {
      const teacherId = check.teacher.id;
      const key = `teacher_appearance:${teacherId}`;
      const defaults = {theme:'original',font:'sf',motion:'balanced',density:'balanced',radius:'balanced',glass:70,accent:null,accent2:null,background:null,bg1:null,bg2:null};
      const allowedThemes = ['original','paper','operator','glass','graphite','soft-dusk','porcelain','mint','solar','liquid-chrome','aurora','plasma','ocean-light','terminal','midnight-rose','studio-light'];
      const allowedFonts = ['sf','system','inter','jakarta','manrope','dm','outfit','space','ibm','source','nunito','work','poppins','lato'];
      const allowedMotion = ['cinematic','balanced','low','off'];
      const allowedDensity = ['compact','balanced','roomy'];
      const allowedRadius = ['sharp','balanced','round'];
      const allowedBackgrounds = ['auto','original','aurora','soft-aurora','dark-veil','liquid-flow','chrome-waves','plasma','threads','ripple-grid','dot-field','paper-grid','matrix-grid','sunset-rays','clean-glow','soft-orbs','silk','light-pillar','grainient','color-bends','prismatic-burst'];
      const cleanColor = v => /^#[0-9a-fA-F]{6}$/.test(String(v||'')) ? String(v) : null;
      if(body.action === 'appearance_reset'){
        const { error } = await supabase.from('settings').delete().eq('key', key);
        if(error) return res.status(200).json({success:false,error:error.message});
        return res.status(200).json({success:true,appearance:null});
      }
      const {data:row,error:readErr}=await supabase.from('settings').select('value').eq('key',key).maybeSingle();
      if(readErr) return res.status(200).json({success:false,error:readErr.message});
      if(body.action === 'appearance_get'){
        let stored=null; try{ stored=row&&row.value?JSON.parse(row.value):null; }catch(e){stored=null;}
        return res.status(200).json({success:true,appearance:stored?{...defaults,...stored}:null});
      }
      const theme=allowedThemes.includes(body.theme)?body.theme:defaults.theme;
      const font=allowedFonts.includes(body.font)?body.font:defaults.font;
      const motion=allowedMotion.includes(body.motion)?body.motion:defaults.motion;
      const density=allowedDensity.includes(body.density)?body.density:defaults.density;
      const radius=allowedRadius.includes(body.radius)?body.radius:defaults.radius;
      const glass=Math.min(100,Math.max(20,Number(body.glass??70)));
      const background=(body.background==='auto'||allowedBackgrounds.includes(body.background))?body.background:null;
      const bg1=cleanColor(body.bg1), bg2=cleanColor(body.bg2);
      const appearance={theme,font,motion,density,radius,glass,accent:cleanColor(body.accent),accent2:cleanColor(body.accent2),background,bg1,bg2};
      const {error}=await supabase.from('settings').upsert({key,value:JSON.stringify(appearance)},{onConflict:'key'});
      if(error)return res.status(200).json({success:false,error:error.message});
      return res.status(200).json({success:true,appearance});
    }

    const { session_version, ...teacher } = check.teacher;
    return res.status(200).json({ success: true, loggedIn: true, teacher });
  } catch (err) {
    return res.status(200).json({ success: false, error: err.message });
  }
};
