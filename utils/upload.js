// File upload utilities
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const ImagePathUtils = require('./imagePathUtils');

// Check if running in Vercel serverless environment
const isVercel = process.env.VERCEL || process.env.VERCEL_ENV;

// Ensure uploads directory exists (only for non-Vercel environments)
const uploadsDir = path.join(__dirname, '../uploads');
if (!isVercel) {
  try {
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
  } catch (err) {
    console.warn('Could not create uploads directory:', err.message);
  }
}

// Configure storage based on environment
// Vercel: use memory storage (files handled by Supabase Storage)
// Local: use disk storage
const storage = isVercel 
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: function (req, file, cb) {
        cb(null, uploadsDir);
      },
      filename: function (req, file, cb) {
        const uniqueName = uuidv4() + path.extname(file.originalname);
        cb(null, uniqueName);
      }
    });

// File filter for images only
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Multer configuration
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 10 // Maximum 10 files
  }
});

// Helper function to save multiple image records to database
async function saveImageRecords(db, entityType, entityId, files) {
  if (!files || files.length === 0) return [];

  const imageRecords = [];
  for (const file of files) {
    // Use ImagePathUtils to generate correct path
    const correctPath = ImagePathUtils.generatePath(file.filename);
    
    const imageData = {
      entity_type: entityType, // 'post', 'comment', 'article', 'event'
      entity_id: entityId,
      filename: file.filename,
      original_name: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      path: correctPath // Guaranteed to be /pajar/uploads/filename.ext
    };

    const query = `INSERT INTO images (entity_type, entity_id, filename, original_name, mimetype, size, path, created_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`;
    
    const [result] = await db.execute(query, [
      imageData.entity_type,
      imageData.entity_id,
      imageData.filename,
      imageData.original_name,
      imageData.mimetype,
      imageData.size,
      imageData.path
    ]);

    imageRecords.push({ ...imageData, id: result.insertId });
  }

  return imageRecords;
}

// Helper function to get images for an entity
async function getImagesByEntity(db, entityType, entityId) {
  const query = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
  const [rows] = await db.execute(query, [entityType, entityId]);
  
  // Convert stored paths to public URLs (Supabase Storage if configured)
  const ImagePathUtils = require('./imagePathUtils');
  return rows.map(image => ({
    ...image,
    path: ImagePathUtils.toPublicUrl(image.path || image.filename)
  }));
}

module.exports = {
  upload,
  saveImageRecords,
  getImagesByEntity,
  uploadsDir
};
