import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role key (server-side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Vercel Serverless Function to handle worksheet database operations
 * Called from the frontend at /api/uploadthing
 */
export default async function handler(req, res) {
  // Enable CORS for browser requests
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action, title, subject, file_url, file_path, id, newPasscode } = req.body;

  try {
    switch (action) {
      case 'get_passcode':
        return await getPasscode(res);

      case 'get_all':
        return await getAllWorksheets(res);

      case 'insert':
        return await insertWorksheet(res, { title, subject, file_url, file_path });

      case 'delete':
        return await deleteWorksheet(res, id);

      case 'update_passcode':
        return await updatePasscode(res, newPasscode);

      case 'purge':
        return await purgeAllWorksheets(res);

      default:
        return res.status(400).json({ success: false, error: 'Unknown action' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * Retrieve the teacher passcode from settings
 */
async function getPasscode(res) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'passcode')
    .single();

  if (error) {
    return res.status(200).json({ passcode: '1324' }); // Default fallback
  }

  return res.status(200).json({ passcode: data?.value || '1324' });
}

/**
 * Get all worksheets from the database
 */
async function getAllWorksheets(res) {
  const { data, error } = await supabase
    .from('worksheets')
    .select('id, title, subject, file_url, file_path, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(400).json({ worksheets: [], error: error.message });
  }

  return res.status(200).json({ worksheets: data || [] });
}

/**
 * Insert a new worksheet record
 */
async function insertWorksheet(res, { title, subject, file_url, file_path }) {
  // Validate input
  if (!title || !subject || !file_url) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: title, subject, file_url'
    });
  }

  // Generate unique ID
  const id = `${subject}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  const { data, error } = await supabase
    .from('worksheets')
    .insert([
      {
        id,
        title,
        subject,
        file_url,
        file_path: file_path || null,
        created_at: new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  return res.status(201).json({
    success: true,
    message: 'Worksheet uploaded successfully',
    worksheet: data?.[0] || { id, title, subject, file_url }
  });
}

/**
 * Delete a worksheet by ID
 */
async function deleteWorksheet(res, id) {
  if (!id) {
    return res.status(400).json({ success: false, error: 'Missing worksheet ID' });
  }

  // First, get the file_path to delete from storage
  const { data: worksheet, error: fetchError } = await supabase
    .from('worksheets')
    .select('file_path')
    .eq('id', id)
    .single();

  if (fetchError) {
    return res.status(404).json({ success: false, error: 'Worksheet not found' });
  }

  // Delete from database
  const { error: deleteError } = await supabase
    .from('worksheets')
    .delete()
    .eq('id', id);

  if (deleteError) {
    return res.status(400).json({ success: false, error: deleteError.message });
  }

  // Delete from storage if file_path exists
  if (worksheet?.file_path) {
    await supabase.storage.from('worksheets').remove([worksheet.file_path]);
  }

  return res.status(200).json({
    success: true,
    message: 'Worksheet deleted successfully'
  });
}

/**
 * Update the teacher passcode
 */
async function updatePasscode(res, newPasscode) {
  if (!newPasscode || newPasscode.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 6 characters'
    });
  }

  const { error } = await supabase
    .from('settings')
    .update({ value: newPasscode })
    .eq('key', 'passcode');

  if (error) {
    return res.status(400).json({ success: false, error: error.message });
  }

  return res.status(200).json({
    success: true,
    message: 'Password updated successfully'
  });
}

/**
 * Delete all worksheets (purge repository)
 */
async function purgeAllWorksheets(res) {
  // Get all worksheet file paths
  const { data: worksheets, error: fetchError } = await supabase
    .from('worksheets')
    .select('file_path');

  if (!fetchError && worksheets && worksheets.length > 0) {
    // Delete all files from storage
    const filePaths = worksheets
      .map(w => w.file_path)
      .filter(fp => fp !== null && fp !== undefined);

    if (filePaths.length > 0) {
      await supabase.storage.from('worksheets').remove(filePaths);
    }
  }

  // Delete all records from database
  const { error: deleteError } = await supabase.from('worksheets').delete().neq('id', '');

  if (deleteError) {
    return res.status(400).json({ success: false, error: deleteError.message });
  }

  return res.status(200).json({
    success: true,
    message: 'All worksheets purged successfully'
  });
}
