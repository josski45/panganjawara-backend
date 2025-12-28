const ImagePathUtils = require('../utils/imagePathUtils');

class Post {
  constructor(db) {
    this.db = db;
  }

  // Helper method to normalize image path
  normalizePath(path) {
    return ImagePathUtils.toPublicUrl(path);
  }

  // Membuat post baru
  async create(postData) {
    const { title, content, author } = postData;
    const query = 'INSERT INTO posts (title, content, author, created_at) VALUES (?, ?, ?, NOW())';
    const [result] = await this.db.execute(query, [title, content, author]);
    return result.insertId;
  }

  // Mendapatkan semua post (dengan gambar dan view count)
  async getAll(limit = 10, offset = 0) {
    const query = `
      SELECT p.*, 
        p.view_count,
        p.like_count,
        p.shared_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'post' AND entity_id = p.id) as image_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p 
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await this.db.execute(query, [limit, offset]);
    
    // Get images for each post
    for (let post of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['post', post.id]);
      
      // Path sudah include /pajar/uploads/ dari database, tidak perlu ditambahkan lagi
      post.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Mendapatkan post berdasarkan ID (dengan gambar)
  async getById(id) {
    const postQuery = `
      SELECT p.*, 
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p 
      WHERE p.id = ?
    `;
    const [postRows] = await this.db.execute(postQuery, [id]);
    
    if (postRows.length === 0) return null;

    const post = postRows[0];

    // Get images
    const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
    const [imageRows] = await this.db.execute(imageQuery, ['post', id]);
    
    // Normalize path untuk handle berbagai kondisi path
    post.images = imageRows.map(img => ({
      ...img,
      path: this.normalizePath(img.path)
    }));
    
    return post;
  }

  // Memperbarui post
  async update(id, postData) {
    const { title, content } = postData;
    const query = 'UPDATE posts SET title = ?, content = ?, updated_at = NOW() WHERE id = ?';
    const [result] = await this.db.execute(query, [title, content, id]);
    return result.affectedRows > 0;
  }

  // Menghapus post
  async delete(id) {
    // Hapus gambar terkait
    await this.db.execute('DELETE FROM images WHERE entity_type = ? AND entity_id = ?', ['post', id]);
    
    // Hapus statistik terkait
    await this.db.execute('DELETE FROM statistics WHERE entity_type = ? AND entity_id = ?', ['post', id]);
    
    // Hapus komentar terkait terlebih dahulu
    await this.db.execute('DELETE FROM comments WHERE post_id = ?', [id]);
    
    // Hapus post
    const query = 'DELETE FROM posts WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Increment view count
  async incrementViewCount(id) {
    const query = 'UPDATE posts SET view_count = view_count + 1 WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Like functionality
  async toggleLike(id, userIp, userAgent) {
    // Check if user already liked this post
    const checkQuery = 'SELECT id FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [existing] = await this.db.execute(checkQuery, [userIp, userAgent, 'post', id]);

    if (existing.length > 0) {
      // Unlike - remove like and decrement count
      const deleteQuery = 'DELETE FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
      await this.db.execute(deleteQuery, [userIp, userAgent, 'post', id]);
      
      const updateQuery = 'UPDATE posts SET like_count = like_count - 1 WHERE id = ? AND like_count > 0';
      await this.db.execute(updateQuery, [id]);
      
      return { liked: false, action: 'unliked' };
    } else {
      // Like - add like and increment count
      const insertQuery = 'INSERT INTO likes (user_ip, user_agent, content_type, content_id) VALUES (?, ?, ?, ?)';
      await this.db.execute(insertQuery, [userIp, userAgent, 'post', id]);
      
      const updateQuery = 'UPDATE posts SET like_count = like_count + 1 WHERE id = ?';
      await this.db.execute(updateQuery, [id]);
      
      return { liked: true, action: 'liked' };
    }
  }

  // Check if user has liked this post
  async hasUserLiked(id, userIp, userAgent) {
    const query = 'SELECT id FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [rows] = await this.db.execute(query, [userIp, userAgent, 'post', id]);
    return rows.length > 0;
  }

  // Share functionality
  async toggleShare(id, userIp, userAgent) {
    // Check if user already shared this post
    const checkQuery = 'SELECT id FROM shares WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [existing] = await this.db.execute(checkQuery, [userIp, userAgent, 'post', id]);

    if (existing.length > 0) {
      // Unshare - remove share and decrement count
      const deleteQuery = 'DELETE FROM shares WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
      await this.db.execute(deleteQuery, [userIp, userAgent, 'post', id]);
      
      const updateQuery = 'UPDATE posts SET shared_count = shared_count - 1 WHERE id = ? AND shared_count > 0';
      await this.db.execute(updateQuery, [id]);
      
      return { shared: false, action: 'unshared' };
    } else {
      // Share - add share and increment count
      const insertQuery = 'INSERT INTO shares (user_ip, user_agent, content_type, content_id) VALUES (?, ?, ?, ?)';
      await this.db.execute(insertQuery, [userIp, userAgent, 'post', id]);
      
      const updateQuery = 'UPDATE posts SET shared_count = shared_count + 1 WHERE id = ?';
      await this.db.execute(updateQuery, [id]);
      
      return { shared: true, action: 'shared' };
    }
  }

  // Check if user has shared this post
  async hasUserShared(id, userIp, userAgent) {
    const query = 'SELECT id FROM shares WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [rows] = await this.db.execute(query, [userIp, userAgent, 'post', id]);
    return rows.length > 0;
  }

  // Increment share count (for external shares without tracking)
  async incrementShareCount(id) {
    const query = 'UPDATE posts SET shared_count = shared_count + 1 WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Get total count of posts (for pagination)
  async getTotalCount() {
    const query = 'SELECT COUNT(*) as total FROM posts';
    const [rows] = await this.db.execute(query);
    return rows[0].total;
  }

  // Search posts
  async search(searchTerm, limit = 10, offset = 0) {
    const query = `
      SELECT p.*, 
        p.view_count,
        p.like_count,
        p.shared_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'post' AND entity_id = p.id) as image_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count
      FROM posts p
      WHERE (title LIKE ? OR content LIKE ? OR author LIKE ?)
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;
    const searchPattern = `%${searchTerm}%`;
    const [rows] = await this.db.execute(query, [searchPattern, searchPattern, searchPattern, limit, offset]);
    
    // Get images for each post
    for (let post of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['post', post.id]);
      
      // Path sudah include /pajar/uploads/ dari database, tidak perlu ditambahkan lagi
      post.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Get total count for search results
  async getSearchTotalCount(searchTerm) {
    const query = `
      SELECT COUNT(*) as total FROM posts 
      WHERE (title LIKE ? OR content LIKE ? OR author LIKE ?)
    `;
    const searchPattern = `%${searchTerm}%`;
    const [rows] = await this.db.execute(query, [searchPattern, searchPattern, searchPattern]);
    return rows[0].total;
  }

  // Get trending posts based on popularity metrics
  async getTrending(limit = 10, offset = 0) {
    const query = `
      SELECT p.*, 
        p.view_count,
        p.like_count,
        p.shared_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'post' AND entity_id = p.id) as image_count,
        (SELECT COUNT(*) FROM comments WHERE post_id = p.id) as comment_count,
        ((p.view_count * 1) + (p.like_count * 3) + (p.shared_count * 5)) as popularity_score
      FROM posts p
      ORDER BY popularity_score DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await this.db.execute(query, [limit, offset]);
    
    // Get images for each post
    for (let post of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['post', post.id]);
      
      // Path sudah include /pajar/uploads/ dari database, tidak perlu ditambahkan lagi
      post.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }
}

module.exports = Post;
