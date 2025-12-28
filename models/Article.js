class Article {
  constructor(db) {
    this.db = db;
    this.ImagePathUtils = require('../utils/imagePathUtils');
  }

  // Helper method to normalize image path using environment-aware utils
  normalizePath(filenameOrPath) {
    return this.ImagePathUtils.toPublicUrl(filenameOrPath);
  }

  // Membuat article baru
  async create(articleData) {
    const { title, content, excerpt, author, status = 'draft', tags, featured = false } = articleData;
    const publishedAt = status === 'published' ? 'NOW()' : 'NULL';
    
    const query = `INSERT INTO articles (title, content, excerpt, author, status, tags, featured, created_at, published_at) 
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ${publishedAt})`;
    
    const [result] = await this.db.execute(query, [title, content, excerpt, author, status, tags, featured]);
    return result.insertId;
  }

  // Mendapatkan semua articles dengan paginasi
  async getAll(limit = 10, offset = 0, status = null) {
    let query = `
      SELECT a.*, 
        a.view_count,
        a.like_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'article' AND entity_id = a.id) as image_count
      FROM articles a
    `;
    let params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await this.db.execute(query, params);
    
    // Get images for each article
    for (let article of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['article', article.id]);
      
      // Add /pajar/ prefix to image paths
      article.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Mendapatkan artikel berdasarkan ID (dengan gambar)
  async getById(id) {
    const articleQuery = 'SELECT * FROM articles WHERE id = ?';
    const [articleRows] = await this.db.execute(articleQuery, [id]);
    
    if (articleRows.length === 0) return null;

    const article = articleRows[0];

    // Get images
    const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
    const [imageRows] = await this.db.execute(imageQuery, ['article', id]);
    
    // Add /pajar/ prefix to image paths
    article.images = imageRows.map(img => ({
      ...img,
      path: this.normalizePath(img.path)
    }));
    
    return article;
  }

  // Update article
  async update(id, articleData) {
    const { title, content, excerpt, status, tags, featured } = articleData;
    let publishedAt = '';
    let params = [title || null, content || null, excerpt || null, status || null, tags || null, featured || null];

    // Set published_at if status is published and wasn't published before
    if (status === 'published') {
      const [current] = await this.db.execute('SELECT status, published_at FROM articles WHERE id = ?', [id]);
      if (current[0] && current[0].status !== 'published') {
        publishedAt = ', published_at = NOW()';
      }
    }

    const query = `UPDATE articles SET title = ?, content = ?, excerpt = ?, status = ?, 
                   tags = ?, featured = ?, updated_at = NOW()${publishedAt} WHERE id = ?`;
    
    params.push(id);
    const [result] = await this.db.execute(query, params);
    return result.affectedRows > 0;
  }

  // Increment view count
  async incrementViewCount(id) {
    const query = 'UPDATE articles SET view_count = view_count + 1 WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Delete article (and associated images)
  async delete(id) {
    // Delete associated images records (files should be cleaned up separately)
    await this.db.execute('DELETE FROM images WHERE entity_type = ? AND entity_id = ?', ['article', id]);
    
    // Delete statistics
    await this.db.execute('DELETE FROM statistics WHERE entity_type = ? AND entity_id = ?', ['article', id]);
    
    // Delete article
    const query = 'DELETE FROM articles WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Get featured articles
  async getFeatured(limit = 5, offset = 0) {
    const query = `
      SELECT a.*, 
        a.view_count,
        a.like_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'article' AND entity_id = a.id) as image_count
      FROM articles a
      WHERE status = 'published' AND featured = 1
      ORDER BY published_at DESC LIMIT ? OFFSET ?
    `;
    const [rows] = await this.db.execute(query, [limit, offset]);
    
    // Get images for each featured article
    for (let article of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['article', article.id]);
      
      // Add /pajar/ prefix to image paths
      article.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Search articles
  async search(searchTerm, limit = 10, offset = 0) {
    const query = `
      SELECT a.*, 
        a.view_count,
        a.like_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'article' AND entity_id = a.id) as image_count
      FROM articles a
      WHERE (title LIKE ? OR content LIKE ? OR tags LIKE ?) AND status = 'published'
      ORDER BY created_at DESC LIMIT ? OFFSET ?
    `;
    const searchPattern = `%${searchTerm}%`;
    const [rows] = await this.db.execute(query, [searchPattern, searchPattern, searchPattern, limit, offset]);
    
    // Get images for each search result article
    for (let article of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['article', article.id]);
      
      // Add /pajar/ prefix to image paths
      article.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Get trending articles based on popularity metrics
  async getTrending(limit = 10, offset = 0) {
    const query = `
      SELECT a.*, 
        a.view_count,
        a.like_count,
        a.shared_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'article' AND entity_id = a.id) as image_count,
        ((a.view_count * 1) + (a.like_count * 3) + (a.shared_count * 5)) as popularity_score
      FROM articles a
      WHERE status = 'published'
      ORDER BY popularity_score DESC, published_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await this.db.execute(query, [limit, offset]);
    
    // Get images for each trending article
    for (let article of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['article', article.id]);
      
      // Add /pajar/ prefix to image paths
      article.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Like functionality with enhanced fingerprinting
  async toggleLike(id, clientInfo) {
    // Create unique identifier from multiple factors
    const uniqueId = `${clientInfo.fingerprint}`;
    
    // Check if user already liked this article using fingerprint
    const checkQuery = 'SELECT id FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [existing] = await this.db.execute(checkQuery, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);

    if (existing.length > 0) {
      // Unlike - remove like and decrement count
      const deleteQuery = 'DELETE FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
      await this.db.execute(deleteQuery, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);
      
      const updateQuery = 'UPDATE articles SET like_count = like_count - 1 WHERE id = ? AND like_count > 0';
      await this.db.execute(updateQuery, [id]);
      
      return { liked: false, action: 'unliked' };
    } else {
      // Like - add like and increment count
      const insertQuery = 'INSERT INTO likes (user_ip, user_agent, content_type, content_id) VALUES (?, ?, ?, ?)';
      await this.db.execute(insertQuery, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);
      
      const updateQuery = 'UPDATE articles SET like_count = like_count + 1 WHERE id = ?';
      await this.db.execute(updateQuery, [id]);
      
      return { liked: true, action: 'liked' };
    }
  }

  // Check if user has liked this article with enhanced fingerprinting
  async hasUserLiked(id, clientInfo) {
    const uniqueId = `${clientInfo.fingerprint}`;
    const query = 'SELECT id FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [rows] = await this.db.execute(query, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);
    return rows.length > 0;
  }

  // Share functionality with enhanced fingerprinting
  async toggleShare(id, clientInfo) {
    const uniqueId = `${clientInfo.fingerprint}`;
    
    // Check if user already shared this article
    const checkQuery = 'SELECT id FROM shares WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [existing] = await this.db.execute(checkQuery, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);

    if (existing.length > 0) {
      // Unshare - remove share and decrement count
      const deleteQuery = 'DELETE FROM shares WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
      await this.db.execute(deleteQuery, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);
      
      const updateQuery = 'UPDATE articles SET shared_count = shared_count - 1 WHERE id = ? AND shared_count > 0';
      await this.db.execute(updateQuery, [id]);
      
      return { shared: false, action: 'unshared' };
    } else {
      // Share - add share and increment count
      const insertQuery = 'INSERT INTO shares (user_ip, user_agent, content_type, content_id) VALUES (?, ?, ?, ?)';
      await this.db.execute(insertQuery, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);
      
      const updateQuery = 'UPDATE articles SET shared_count = shared_count + 1 WHERE id = ?';
      await this.db.execute(updateQuery, [id]);
      
      return { shared: true, action: 'shared' };
    }
  }

  // Check if user has shared this article with enhanced fingerprinting
  async hasUserShared(id, clientInfo) {
    const uniqueId = `${clientInfo.fingerprint}`;
    const query = 'SELECT id FROM shares WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [rows] = await this.db.execute(query, [uniqueId.substring(0, 45), clientInfo.userAgent.substring(0, 255), 'article', id]);
    return rows.length > 0;
  }

  // Increment share count (for external shares without tracking)
  async incrementShareCount(id) {
    const query = 'UPDATE articles SET shared_count = shared_count + 1 WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Get total count of articles (for pagination)
  async getTotalCount(status = null) {
    let query = 'SELECT COUNT(*) as total FROM articles';
    let params = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    const [rows] = await this.db.execute(query, params);
    return rows[0].total;
  }

  // Get total count for search results
  async getSearchTotalCount(searchTerm) {
    const query = `
      SELECT COUNT(*) as total FROM articles 
      WHERE (title LIKE ? OR content LIKE ? OR tags LIKE ?) AND status = 'published'
    `;
    const searchPattern = `%${searchTerm}%`;
    const [rows] = await this.db.execute(query, [searchPattern, searchPattern, searchPattern]);
    return rows[0].total;
  }

  // Get total count of featured articles
  async getFeaturedTotalCount() {
    const query = 'SELECT COUNT(*) as total FROM articles WHERE status = ? AND featured = ?';
    const [rows] = await this.db.execute(query, ['published', 1]);
    return rows[0].total;
  }

  // Get total count of trending articles (same as published articles)
  async getTrendingTotalCount() {
    const query = 'SELECT COUNT(*) as total FROM articles WHERE status = ?';
    const [rows] = await this.db.execute(query, ['published']);
    return rows[0].total;
  }
}

module.exports = Article;
