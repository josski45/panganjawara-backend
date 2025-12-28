// Supabase Storage Upload Utilities for Vercel deployment
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

const MAX_UPLOAD_FILE_MB = parseInt(process.env.UPLOAD_MAX_FILE_MB || '5', 10);
const MAX_UPLOAD_FILES = parseInt(process.env.UPLOAD_MAX_FILES || '10', 10);
const MAX_UPLOAD_FILE_SIZE = (Number.isFinite(MAX_UPLOAD_FILE_MB) ? MAX_UPLOAD_FILE_MB : 5) * 1024 * 1024;

// Use memory storage for Vercel (no local filesystem in serverless)
const storage = multer.memoryStorage();

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Multer configuration for memory storage
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_FILE_SIZE,
    files: Number.isFinite(MAX_UPLOAD_FILES) ? MAX_UPLOAD_FILES : 10
  }
});

// Upload file to Supabase Storage
async function uploadToSupabase(supabase, file, bucket = 'uploads') {
  const filename = uuidv4() + path.extname(file.originalname);
  
  const { data, error } = await supabase.storage
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
      cacheControl: '3600',
      upsert: false
    });
  
  if (error) {
    console.error('Supabase upload error:', error);
    throw new Error(`Failed to upload file: ${error.message}`);
  }
  
  // Get public URL
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(filename);
  
  return {
    filename,
    path: urlData.publicUrl,
    storage_type: 'supabase'
  };
}

// Helper function to save multiple image records to database (PostgreSQL version)
async function saveImageRecords(db, supabase, entityType, entityId, files, bucket = 'uploads') {
  if (!files || files.length === 0) return [];

  const imageRecords = [];
  
  for (const file of files) {
    try {
      // Upload to Supabase Storage
      const uploadResult = await uploadToSupabase(supabase, file, bucket);
      
      const imageData = {
        entity_type: entityType,
        entity_id: entityId,
        filename: uploadResult.filename,
        original_name: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
        path: uploadResult.path,
        storage_type: uploadResult.storage_type
      };

      // PostgreSQL INSERT with RETURNING
      const query = `
        INSERT INTO images (entity_type, entity_id, filename, original_name, mimetype, size, path, storage_type, created_at) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        RETURNING id
      `;
      
      const [result] = await db.execute(query, [
        imageData.entity_type,
        imageData.entity_id,
        imageData.filename,
        imageData.original_name,
        imageData.mimetype,
        imageData.size,
        imageData.path,
        imageData.storage_type
      ]);

      imageRecords.push({ 
        ...imageData, 
        id: result[0]?.id || result.insertId 
      });
    } catch (error) {
      console.error('Error saving image:', error);
      // Continue with other files even if one fails
    }
  }

  return imageRecords;
}

// Helper function to get images for an entity (PostgreSQL version)
async function getImagesByEntity(db, entityType, entityId) {
  const query = 'SELECT * FROM images WHERE entity_type = $1 AND entity_id = $2 ORDER BY created_at ASC';
  const [rows] = await db.execute(query, [entityType, entityId]);
  return rows;
}

// Delete image from Supabase Storage
async function deleteFromSupabase(supabase, filename, bucket = 'uploads') {
  const { error } = await supabase.storage
    .from(bucket)
    .remove([filename]);
  
  if (error) {
    console.error('Supabase delete error:', error);
    throw new Error(`Failed to delete file: ${error.message}`);
  }
  
  return true;
}

// Delete image record and file
async function deleteImageRecord(db, supabase, imageId, bucket = 'uploads') {
  // Get image info first
  const [images] = await db.execute('SELECT * FROM images WHERE id = $1', [imageId]);
  
  if (images.length === 0) {
    return false;
  }
  
  const image = images[0];
  
  // Delete from Supabase Storage if stored there
  if (image.storage_type === 'supabase') {
    try {
      await deleteFromSupabase(supabase, image.filename, bucket);
    } catch (error) {
      console.error('Error deleting from Supabase:', error);
    }
  }
  
  // Delete from database
  await db.execute('DELETE FROM images WHERE id = $1', [imageId]);
  
  return true;
}

module.exports = {
  upload,
  uploadToSupabase,
  saveImageRecords,
  getImagesByEntity,
  deleteFromSupabase,
  deleteImageRecord
};
