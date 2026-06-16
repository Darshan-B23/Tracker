const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

// Get life areas (needed for forms)
router.get('/life-areas', (req, res) => {
  try {
    const areas = db.prepare('SELECT * FROM life_areas').all();
    res.json(areas);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch life areas' });
  }
});

// Get all skills with computed progress
router.get('/', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT s.*, la.name as life_area_name,
        (
          SELECT json_object('total', COUNT(*), 'completed', SUM(CASE WHEN ci.completed = 1 THEN 1 ELSE 0 END))
          FROM skill_checklists sc
          JOIN checklist_items ci ON sc.checklist_id = ci.checklist_id
          WHERE sc.skill_id = s.id
        ) as checklist_stats
      FROM skills s
      LEFT JOIN life_areas la ON s.life_area_id = la.id
    `;
    let params = [];

    if (status) {
      query += ` WHERE s.status = ?`;
      params.push(status);
    }
    
    query += ` ORDER BY s.updated_at DESC`;

    const skills = db.prepare(query).all(params).map(skill => {
      const stats = JSON.parse(skill.checklist_stats);
      const total = stats.total || 0;
      const completed = stats.completed || 0;
      return {
        ...skill,
        progress: total === 0 ? 0 : Math.round((completed / total) * 100),
        checklist_stats: { total, completed }
      };
    });

    res.json(skills);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch skills' });
  }
});

// Get a single skill by ID, including checklists and sessions
router.get('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const skill = db.prepare(`
      SELECT s.*, la.name as life_area_name 
      FROM skills s 
      LEFT JOIN life_areas la ON s.life_area_id = la.id 
      WHERE s.id = ?
    `).get(id);
    
    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    // Get checklists
    const checklists = db.prepare(`
      SELECT c.id as checklist_id, c.title as checklist_title, ci.id as item_id, ci.title as item_title, ci.completed, ci.scheduled_date, ci.scheduled_time
      FROM skill_checklists sc
      JOIN checklists c ON sc.checklist_id = c.id
      JOIN checklist_items ci ON c.id = ci.checklist_id
      WHERE sc.skill_id = ?
      ORDER BY ci.display_order, ci.id
    `).all(id);

    // Group checklists
    const groupedChecklists = checklists.reduce((acc, curr) => {
      let cl = acc.find(c => c.id === curr.checklist_id);
      if (!cl) {
        cl = { id: curr.checklist_id, title: curr.checklist_title, items: [] };
        acc.push(cl);
      }
      cl.items.push({ 
        id: curr.item_id, 
        title: curr.item_title, 
        completed: curr.completed,
        scheduled_date: curr.scheduled_date,
        scheduled_time: curr.scheduled_time
      });
      return acc;
    }, []);

    // Get learning sessions
    const sessions = db.prepare(`
      SELECT * FROM learning_sessions WHERE skill_id = ? ORDER BY session_date DESC, created_at DESC
    `).all(id);

    res.json({
      ...skill,
      checklists: groupedChecklists,
      sessions
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch skill details' });
  }
});

// Create a new skill
router.post('/', (req, res) => {
  const { name, category, status, priority, schedule_type, target_date, life_area_id, why_learning, notes } = req.body;
  try {
    const newStatus = status || 'Wishlist';
    
    // Automatic date rules on creation
    const startedAt = newStatus === 'Active' ? new Date().toISOString() : null;
    const completedAt = newStatus === 'Completed' ? new Date().toISOString() : null;

    const result = db.prepare(`
      INSERT INTO skills (name, category, status, priority, schedule_type, target_date, life_area_id, why_learning, notes, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, category, newStatus, priority, schedule_type || 'Flexible', target_date, life_area_id, why_learning, notes, startedAt, completedAt);
    
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

// Update a skill
router.put('/:id', (req, res) => {
  const { status, schedule_type, target_date, notes } = req.body;
  const id = req.params.id;
  
  try {
    const current = db.prepare(`SELECT status FROM skills WHERE id = ?`).get(id);
    if (!current) return res.status(404).json({ error: 'Skill not found' });
    
    let startedAtSql = "";
    let completedAtSql = "";
    
    // Automatic date rules on update
    if (status && current.status !== status) {
      if (status === 'Active') {
        startedAtSql = ", started_at = CURRENT_TIMESTAMP";
      } else if (status === 'Completed') {
        completedAtSql = ", completed_at = CURRENT_TIMESTAMP";
      }
    }

    const query = `
      UPDATE skills 
      SET status = coalesce(?, status), 
          schedule_type = coalesce(?, schedule_type),
          target_date = coalesce(?, target_date),
          notes = coalesce(?, notes),
          updated_at = CURRENT_TIMESTAMP
          ${startedAtSql}
          ${completedAtSql}
      WHERE id = ?
    `;
    
    db.prepare(query).run(status, schedule_type, target_date, notes, id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update skill' });
  }
});

// Add a learning session
router.post('/:id/sessions', (req, res) => {
  const { duration_minutes, session_date, notes } = req.body;
  const skill_id = req.params.id;
  
  try {
    const result = db.prepare(`
      INSERT INTO learning_sessions (skill_id, duration_minutes, session_date, notes)
      VALUES (?, ?, ?, ?)
    `).run(skill_id, duration_minutes, session_date || new Date().toISOString().split('T')[0], notes);
    
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add learning session' });
  }
});

// Add a checklist item (and checklist if needed)
router.post('/:id/checklists', (req, res) => {
  const { checklist_title, item_title, scheduled_date, scheduled_time } = req.body;
  const skill_id = req.params.id;
  
  try {
    db.transaction(() => {
      // Find or create checklist
      let cl = db.prepare(`
        SELECT c.id FROM checklists c 
        JOIN skill_checklists sc ON c.id = sc.checklist_id 
        WHERE sc.skill_id = ? AND c.title = ?
      `).get(skill_id, checklist_title || 'General');

      let checklist_id;
      if (!cl) {
        const insertCl = db.prepare(`INSERT INTO checklists (title) VALUES (?)`).run(checklist_title || 'General');
        checklist_id = insertCl.lastInsertRowid;
        db.prepare(`INSERT INTO skill_checklists (skill_id, checklist_id) VALUES (?, ?)`).run(skill_id, checklist_id);
      } else {
        checklist_id = cl.id;
      }

      // Add item
      db.prepare(`
        INSERT INTO checklist_items (checklist_id, title, scheduled_date, scheduled_time) VALUES (?, ?, ?, ?)
      `).run(checklist_id, item_title, scheduled_date || null, scheduled_time || null);
    })();
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add checklist item' });
  }
});

// Toggle checklist item
router.put('/:id/checklists/items/:itemId', (req, res) => {
  const { completed } = req.body;
  const itemId = req.params.itemId;
  
  try {
    db.prepare(`
      UPDATE checklist_items 
      SET completed = ?, completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(completed ? 1 : 0, completed ? 1 : 0, itemId);
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update checklist item' });
  }
});

module.exports = router;
