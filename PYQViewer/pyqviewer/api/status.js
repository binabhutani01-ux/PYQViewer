const { createClient } = require('@supabase/supabase-js');

const defaults = { customize_enabled: true, default_theme: 'midnight', theme_reset_token: '0', logo_svg: '' };

module.exports = async (req, res) => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data, error } = await supabase.from('settings').select('key,value').in('key', ['maintenance_mode','customize_enabled','default_theme','theme_reset_token','logo_svg']);
    if (error) return res.status(200).json({ success: true, maintenance: false, ...defaults });
    const map = Object.fromEntries((data || []).map(x => [x.key, x.value]));
    return res.status(200).json({
      success: true,
      maintenance: map.maintenance_mode === 'true',
      customize_enabled: map.customize_enabled !== 'false',
      default_theme: map.default_theme || defaults.default_theme,
      theme_reset_token: map.theme_reset_token || defaults.theme_reset_token,
      logo_svg: map.logo_svg || defaults.logo_svg,
    });
  } catch (err) {
    return res.status(200).json({ success: true, maintenance: false, ...defaults });
  }
};
