const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: rows } = await supabase.from('settings').select('key,value').in('key', ['maintenance_mode','site_theme','site_font','site_motion','site_density','site_radius','site_glass','site_accent','site_accent2','site_background','site_bg1','site_bg2']);
    const map = Object.fromEntries((rows||[]).map(r=>[r.key,r.value]));
    const appearance = {
      theme: ['original','paper','operator','glass','graphite','soft-dusk','porcelain','mint','solar','liquid-chrome','aurora','plasma','ocean-light','terminal','midnight-rose','studio-light'].includes(map.site_theme) ? map.site_theme : 'original',
      font: map.site_font || 'sf', motion: map.site_motion || 'balanced', density: map.site_density || 'balanced', radius: map.site_radius || 'balanced', glass: Number(map.site_glass || 70), accent: map.site_accent || null, accent2: map.site_accent2 || null, background: map.site_background || null, bg1: map.site_bg1 || null, bg2: map.site_bg2 || null
    };
    return res.status(200).json({ success:true, maintenance:map.maintenance_mode === 'true', appearance });
  } catch (err) {
    return res.status(200).json({ success: true, maintenance: false });
  }
};
