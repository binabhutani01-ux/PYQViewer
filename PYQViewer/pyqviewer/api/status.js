const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data } = await supabase.from('settings').select('key,value').in('key', ['maintenance_mode', 'site_theme', 'site_font']);
    const map = {};
    (data || []).forEach(row => { map[row.key] = row.value; });
    return res.status(200).json({
      success: true,
      maintenance: map.maintenance_mode === 'true',
      theme: map.site_theme || 'default',
      font: map.site_font || 'Inter',
    });
  } catch (err) {
    return res.status(200).json({ success: true, maintenance: false, theme: 'default', font: 'Inter' });
  }
};
