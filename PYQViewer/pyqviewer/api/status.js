const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data } = await supabase.from('settings').select('value').eq('key', 'maintenance_mode').maybeSingle();
    return res.status(200).json({ success: true, maintenance: data ? data.value === 'true' : false });
  } catch (err) {
    return res.status(200).json({ success: true, maintenance: false });
  }
};
