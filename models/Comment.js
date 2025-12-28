class Comment {
  constructor(db) {
    this.db = db;
    this.ImagePathUtils = require('../utils/imagePathUtils');
  }

  // Helper method to normalize image path using environment-aware utils
  normalizePath(filenameOrPath) {
    return this.ImagePathUtils.toPublicUrl(filenameOrPath);
  }

  // Membuat komentar baru
  async create(commentData) {
    const { post_id, author, content } = commentData;
    const query = 'INSERT INTO comments (post_id, author, content, created_at) VALUES (?, ?, ?, NOW())';
    const [result] = await this.db.execute(query, [post_id, author, content]);
    return result.insertId;
  }

  // Mendapatkan semua komentar untuk sebuah post (dengan gambar)
  async getByPostId(post_id) {
    const query = `
      SELECT c.*, 
        c.like_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'comment' AND entity_id = c.id) as image_count
      FROM comments c 
      WHERE post_id = ? 
      ORDER BY created_at ASC
    `;
    const [rows] = await this.db.execute(query, [post_id]);
    
    // Get images for each comment
    for (let comment of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['comment', comment.id]);
      comment.images = imageRows.map(img => ({ ...img, path: this.normalizePath(img.path) }));
    }
    
    return rows;
  }

  // Mendapatkan semua komentar (admin only)
  async getAll(limit = 50, offset = 0) {
    const query = `
      SELECT c.*, 
        p.title as post_title,
        c.like_count,
        (SELECT COUNT(*) FROM images WHERE entity_type = 'comment' AND entity_id = c.id) as image_count
      FROM comments c 
      LEFT JOIN posts p ON c.post_id = p.id
      ORDER BY c.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const [rows] = await this.db.execute(query, [limit, offset]);
    
    // Get images for each comment
    for (let comment of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['comment', comment.id]);
      comment.images = imageRows.map(img => ({ ...img, path: this.normalizePath(img.path) }));
    }
    
    return rows;
  }

  // Mendapatkan komentar berdasarkan ID (dengan gambar)
  async getById(id) {
    const commentQuery = 'SELECT * FROM comments WHERE id = ?';
    const [commentRows] = await this.db.execute(commentQuery, [id]);
    
    if (commentRows.length === 0) return null;

    const comment = commentRows[0];

    // Get images
    const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
    const [imageRows] = await this.db.execute(imageQuery, ['comment', id]);
    
    comment.images = imageRows.map(img => ({ ...img, path: this.normalizePath(img.path) }));
    return comment;
  }

  // Memperbarui komentar
  async update(id, content) {
    const query = 'UPDATE comments SET content = ?, updated_at = NOW() WHERE id = ?';
    const [result] = await this.db.execute(query, [content, id]);
    return result.affectedRows > 0;
  }

  // Menghapus komentar
  async delete(id) {
    // Hapus gambar terkait
    await this.db.execute('DELETE FROM images WHERE entity_type = ? AND entity_id = ?', ['comment', id]);
    
    // Hapus statistik terkait
    await this.db.execute('DELETE FROM statistics WHERE entity_type = ? AND entity_id = ?', ['comment', id]);
    
    // Hapus komentar
    const query = 'DELETE FROM comments WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Like functionality
  async toggleLike(id, userIp, userAgent) {
    // Check if user already liked this comment
    const checkQuery = 'SELECT id FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [existing] = await this.db.execute(checkQuery, [userIp, userAgent, 'comment', id]);

    if (existing.length > 0) {
      // Unlike - remove like and decrement count
      const deleteQuery = 'DELETE FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
      await this.db.execute(deleteQuery, [userIp, userAgent, 'comment', id]);
      
      const updateQuery = 'UPDATE comments SET like_count = like_count - 1 WHERE id = ? AND like_count > 0';
      await this.db.execute(updateQuery, [id]);
      
      return { liked: false, action: 'unliked' };
    } else {
      // Like - add like and increment count
      const insertQuery = 'INSERT INTO likes (user_ip, user_agent, content_type, content_id) VALUES (?, ?, ?, ?)';
      await this.db.execute(insertQuery, [userIp, userAgent, 'comment', id]);
      
      const updateQuery = 'UPDATE comments SET like_count = like_count + 1 WHERE id = ?';
      await this.db.execute(updateQuery, [id]);
      
      return { liked: true, action: 'liked' };
    }
  }

  // Check if user has liked this comment
  async hasUserLiked(id, userIp, userAgent) {
    const query = 'SELECT id FROM likes WHERE user_ip = ? AND user_agent = ? AND content_type = ? AND content_id = ?';
    const [rows] = await this.db.execute(query, [userIp, userAgent, 'comment', id]);
    return rows.length > 0;
  }
}

module.exports = Comment;
