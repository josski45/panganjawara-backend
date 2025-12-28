// Image path utilities
const EnvironmentConfig = require('./environmentConfig');

class ImagePathUtils {
  constructor() {
    this.envConfig = new EnvironmentConfig();
  }

  static isHttpUrl(value) {
    return typeof value === 'string' && /^https?:\/\//i.test(value);
  }

  /**
   * Normalize image path to ensure correct format
   * @param {string} path - The original path
   * @returns {string} - Normalized path
   */
  static normalizePath(path) {
    const envConfig = new EnvironmentConfig();
    return envConfig.normalizePath(path);
  }

  /**
   * Generate correct path for new uploads
   * @param {string} filename - The uploaded filename
   * @returns {string} - Correct path format
   */
  static generatePath(filename) {
    const envConfig = new EnvironmentConfig();
    return envConfig.getUploadPath(filename);
  }

  /**
   * Validate if path format is correct for current environment
   * @param {string} path - Path to validate
   * @returns {boolean} - True if path is correct
   */
  static isValidPath(path) {
    if (!path) return false;
    
    const envConfig = new EnvironmentConfig();
    
    if (envConfig.isSubdirectoryDeployment) {
      // For subdirectory deployment, path should start with /uploads/
      return path.startsWith('/uploads/') && 
             !path.includes('/pajar/pajar/') && 
             !path.includes('/uploads/uploads/');
    } else {
      // For local development, path should start with /pajar/uploads/
      return path.startsWith('/pajar/uploads/') && 
             !path.includes('/pajar/pajar/') && 
             !path.includes('/uploads/uploads/');
    }
  }

  /**
   * Extract filename from path
   * @param {string} path - Full path
   * @returns {string} - Filename only
   */
  static extractFilename(path) {
    if (!path) return '';
    
    // Handle different path formats
    if (path.includes('/uploads/')) {
      return path.split('/uploads/').pop();
    }
    
    return path.split('/').pop();
  }

  /**
   * Convert full URL to relative path
   * @param {string} url - Full URL (e.g., https://api.fsu.my.id/pajar/uploads/file.png)
   * @returns {string} - Relative path
   */
  static urlToPath(url) {
    if (!url) return '';
    
    // Extract path from URL
    const urlObj = new URL(url);
    return this.normalizePath(urlObj.pathname);
  }

  /**
   * Build full URL from path
   * @param {string} path - Relative path
   * @param {string} baseUrl - Base URL (optional)
   * @returns {string} - Full URL
   */
  static pathToUrl(path, baseUrl = '') {
    const normalizedPath = this.normalizePath(path);
    return baseUrl ? `${baseUrl.replace(/\/$/, '')}${normalizedPath}` : normalizedPath;
  }

  /**
   * Convert any stored image reference into a public URL.
   * - If already a http(s) URL, returns as-is
   * - If SUPABASE_URL is configured, builds Supabase Storage public URL
   * - Otherwise falls back to normalized relative path
   * @param {string} value - filename | /pajar/uploads/<file> | /uploads/<file> | full URL
   * @param {string} bucket - Supabase Storage bucket (default: uploads)
   * @returns {string}
   */
  static toPublicUrl(value, bucket = 'uploads') {
    if (!value) return '';
    if (this.isHttpUrl(value)) return value;

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const filename = this.extractFilename(value);

    if (supabaseUrl && filename) {
      const base = supabaseUrl.replace(/\/$/, '');
      return `${base}/storage/v1/object/public/${bucket}/${filename}`;
    }

    return this.normalizePath(value);
  }

  /**
   * Get environment configuration
   * @returns {object} - Environment configuration summary
   */
  static getEnvironmentInfo() {
    const envConfig = new EnvironmentConfig();
    return envConfig.getConfigSummary();
  }
}

module.exports = ImagePathUtils;
