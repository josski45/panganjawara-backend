class Event {
  constructor(db) {
    this.db = db;
    this.ImagePathUtils = require('../utils/imagePathUtils');
  }

  // Helper method to normalize image path using environment-aware utils
  normalizePath(filenameOrPath) {
    return this.ImagePathUtils.toPublicUrl(filenameOrPath);
  }

  // Create new event (admin/superadmin only)
  async create(eventData) {
    const { 
      title, 
      description, 
      event_date, 
      duration_minutes, 
      location, 
      zoom_link, 
      zoom_meeting_id, 
      zoom_password, 
      max_participants, 
      status, 
      priority, 
      created_by 
    } = eventData;
    
    const query = `INSERT INTO events 
      (title, description, event_date, duration_minutes, location, zoom_link, zoom_meeting_id, 
       zoom_password, max_participants, status, priority, created_by, created_at) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
    
    const [result] = await this.db.execute(query, [
      title, description, event_date, duration_minutes || 60, location, 
      zoom_link, zoom_meeting_id, zoom_password, max_participants, 
      status || 'draft', priority || 'normal', created_by
    ]);
    
    return result.insertId;
  }

  // Get all events with pagination and filters
  async getAll(limit = 10, offset = 0, filters = {}) {
    let query = `
      SELECT e.*, 
        (SELECT COUNT(*) FROM images WHERE entity_type = 'event' AND entity_id = e.id) as image_count
      FROM events e
    `;
    
    let params = [];
    let whereConditions = [];

    // Apply filters
    if (filters.status) {
      whereConditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.priority) {
      whereConditions.push('priority = ?');
      params.push(filters.priority);
    }

    if (filters.upcoming) {
      whereConditions.push('event_date > NOW()');
    }

    if (filters.past) {
      whereConditions.push('event_date < NOW()');
    }

    if (filters.today) {
      whereConditions.push('DATE(event_date) = CURDATE()');
    }

    if (whereConditions.length > 0) {
      query += ' WHERE ' + whereConditions.join(' AND ');
    }

    query += ' ORDER BY event_date ASC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows] = await this.db.execute(query, params);
    
    // Get images for each event
    for (let event of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['event', event.id]);
      
      // Add /pajar/ prefix to image paths
      event.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Get event by ID with images
  async getById(id) {
    const eventQuery = `
      SELECT e.*, 
        (SELECT COUNT(*) FROM images WHERE entity_type = 'event' AND entity_id = e.id) as image_count
      FROM events e 
      WHERE e.id = ?
    `;
    const [eventRows] = await this.db.execute(eventQuery, [id]);
    
    if (eventRows.length === 0) {
      return null;
    }

    const event = eventRows[0];
    
    // Get images for this event
    const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
    const [imageRows] = await this.db.execute(imageQuery, ['event', id]);
    
    // Add /pajar/ prefix to image paths
    event.images = imageRows.map(img => ({
      ...img,
      path: this.normalizePath(img.path)
    }));
    
    return event;
  }

  // Update event
  async update(id, eventData) {
    const { 
      title, 
      description, 
      event_date, 
      duration_minutes, 
      location, 
      zoom_link, 
      zoom_meeting_id, 
      zoom_password, 
      max_participants, 
      status, 
      priority 
    } = eventData;
    
    const query = `UPDATE events SET 
      title = ?, description = ?, event_date = ?, duration_minutes = ?, 
      location = ?, zoom_link = ?, zoom_meeting_id = ?, zoom_password = ?, 
      max_participants = ?, status = ?, priority = ?, updated_at = NOW() 
      WHERE id = ?`;
    
    const [result] = await this.db.execute(query, [
      title || null, 
      description || null, 
      event_date || null, 
      duration_minutes || null, 
      location || null, 
      zoom_link || null, 
      zoom_meeting_id || null, 
      zoom_password || null, 
      max_participants || null, 
      status || null, 
      priority || null, 
      id
    ]);
    
    return result.affectedRows > 0;
  }

  // Delete event
  async delete(id) {
    // Delete related images first
    await this.db.execute('DELETE FROM images WHERE entity_type = ? AND entity_id = ?', ['event', id]);
    
    // Delete related statistics if any
    await this.db.execute('DELETE FROM statistics WHERE entity_type = ? AND entity_id = ?', ['event', id]);
    
    // Delete the event
    const query = 'DELETE FROM events WHERE id = ?';
    const [result] = await this.db.execute(query, [id]);
    return result.affectedRows > 0;
  }

  // Get upcoming events (public)
  async getUpcoming(limit = 5) {
    const query = `
      SELECT e.*, 
        (SELECT COUNT(*) FROM images WHERE entity_type = 'event' AND entity_id = e.id) as image_count
      FROM events e
      WHERE status = 'published' AND event_date > NOW()
      ORDER BY event_date ASC 
      LIMIT ?
    `;
    const [rows] = await this.db.execute(query, [limit]);
    
    // Get images for each event
    for (let event of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['event', event.id]);
      
      // Add /pajar/ prefix to image paths
      event.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Search events
  async search(searchTerm, limit = 10, offset = 0) {
    const query = `
      SELECT e.*, 
        (SELECT COUNT(*) FROM images WHERE entity_type = 'event' AND entity_id = e.id) as image_count
      FROM events e
      WHERE (title LIKE ? OR description LIKE ? OR location LIKE ?) AND status = 'published'
      ORDER BY event_date ASC 
      LIMIT ? OFFSET ?
    `;
    const searchPattern = `%${searchTerm}%`;
    const [rows] = await this.db.execute(query, [searchPattern, searchPattern, searchPattern, limit, offset]);
    
    // Get images for each event
    for (let event of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['event', event.id]);
      
      // Add /pajar/ prefix to image paths
      event.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Get events by date range
  async getByDateRange(startDate, endDate, status = null) {
    let query = `
      SELECT e.*, 
        (SELECT COUNT(*) FROM images WHERE entity_type = 'event' AND entity_id = e.id) as image_count
      FROM events e
      WHERE event_date BETWEEN ? AND ?
    `;
    let params = [startDate, endDate];

    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }

    query += ' ORDER BY event_date ASC';
    const [rows] = await this.db.execute(query, params);
    
    // Get images for each event
    for (let event of rows) {
      const imageQuery = 'SELECT * FROM images WHERE entity_type = ? AND entity_id = ? ORDER BY created_at ASC';
      const [imageRows] = await this.db.execute(imageQuery, ['event', event.id]);
      
      // Add /pajar/ prefix to image paths
      event.images = imageRows.map(img => ({
        ...img,
        path: this.normalizePath(img.path)
      }));
    }
    
    return rows;
  }

  // Get events statistics
  async getStats() {
    const queries = {
      total: 'SELECT COUNT(*) as count FROM events',
      published: 'SELECT COUNT(*) as count FROM events WHERE status = "published"',
      upcoming: 'SELECT COUNT(*) as count FROM events WHERE status = "published" AND event_date > NOW()',
      today: 'SELECT COUNT(*) as count FROM events WHERE status = "published" AND DATE(event_date) = CURDATE()',
      thisWeek: 'SELECT COUNT(*) as count FROM events WHERE status = "published" AND YEARWEEK(event_date) = YEARWEEK(NOW())',
      thisMonth: 'SELECT COUNT(*) as count FROM events WHERE status = "published" AND YEAR(event_date) = YEAR(NOW()) AND MONTH(event_date) = MONTH(NOW())'
    };

    const results = {};
    for (const [key, query] of Object.entries(queries)) {
      const [rows] = await this.db.execute(query);
      results[key] = rows[0].count;
    }

    return results;
  }
}

module.exports = Event;

