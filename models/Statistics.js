class Statistics {
  constructor(db) {
    this.db = db;
  }

  // Record a statistic action
  async record(entityType, entityId, action, ipAddress = null, userAgent = null, country = null, city = null) {
    const query = `INSERT INTO statistics (entity_type, entity_id, action, ip_address, user_agent, country, city, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
                   RETURNING id`;

    const [rows] = await this.db.execute(query, [
      entityType, entityId, action, 
      ipAddress || null, 
      userAgent || null, 
      country || null, 
      city || null
    ]);

    return rows?.[0]?.id;
  }

  // Log action with client info (helper method)
  async logAction(action, entityId, clientInfo) {
    // Extract entity type from action (e.g., 'video_create' -> 'video')
    const entityType = action.split('_')[0];
    
    return await this.record(
      entityType, 
      entityId, 
      action, 
      clientInfo.ip, 
      clientInfo.userAgent, 
      clientInfo.country, 
      clientInfo.city
    );
  }

  // Get statistics for a specific entity
  async getByEntity(entityType, entityId, action = null) {
    let query = 'SELECT * FROM statistics WHERE entity_type = ? AND entity_id = ?';
    const params = [entityType, entityId];

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    query += ' ORDER BY created_at DESC';
    const [rows] = await this.db.execute(query, params);
    return rows;
  }

  // Get statistics count for a specific entity and action
  async getCount(entityType, entityId, action) {
    const query = 'SELECT COUNT(*) as count FROM statistics WHERE entity_type = ? AND entity_id = ? AND action = ?';
    const [rows] = await this.db.execute(query, [entityType, entityId, action]);
    return rows[0].count;
  }

  // Get daily statistics summary
  async getDailySummary(date = null, entityType = null) {
    let query = `
      SELECT 
        DATE(created_at) as date,
        entity_type,
        action,
        COUNT(*) as count,
        COUNT(DISTINCT ip_address) as unique_users
      FROM statistics 
      WHERE 1=1
    `;
    const params = [];

    if (date) {
      query += ' AND DATE(created_at) = ?';
      params.push(date);
    }

    if (entityType) {
      query += ' AND entity_type = ?';
      params.push(entityType);
    }

    query += ' GROUP BY DATE(created_at), entity_type, action ORDER BY date DESC';
    const [rows] = await this.db.execute(query, params);
    return rows;
  }

  // Get top performing content
  async getTopContent(entityType, action = 'view', limit = 10, days = 30) {
    const query = `
      SELECT 
        entity_id,
        COUNT(*) as total_count,
        COUNT(DISTINCT ip_address) as unique_count
      FROM statistics 
      WHERE entity_type = ? AND action = ? 
        AND created_at >= NOW() - (? * INTERVAL '1 day')
      GROUP BY entity_id 
      ORDER BY total_count DESC 
      LIMIT ?
    `;
    
    const [rows] = await this.db.execute(query, [entityType, action, days, limit]);
    return rows;
  }

  // Get geographic distribution
  async getGeographicStats(entityType = null, days = 30) {
    let query = `
      SELECT 
        country,
        city,
        COUNT(*) as count,
        COUNT(DISTINCT ip_address) as unique_users
      FROM statistics 
      WHERE created_at >= NOW() - (? * INTERVAL '1 day')
        AND country IS NOT NULL
    `;
    const params = [days];

    if (entityType) {
      query += ' AND entity_type = ?';
      params.push(entityType);
    }

    query += ' GROUP BY country, city ORDER BY count DESC';
    const [rows] = await this.db.execute(query, params);
    return rows;
  }

  // Clean old statistics (for performance)
  async cleanOldStats(daysToKeep = 365) {
    const query = `DELETE FROM statistics 
                   WHERE created_at < NOW() - (? * INTERVAL '1 day')
                   RETURNING id`;
    const [rows] = await this.db.execute(query, [daysToKeep]);
    return rows.length;
  }
}

module.exports = Statistics;
