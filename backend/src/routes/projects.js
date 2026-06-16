const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

// Helper to log activity
const logActivity = (entity_type, entity_id, action, description = null) => {
  try {
    db.prepare(`
      INSERT INTO activity_logs (entity_type, entity_id, action, description)
      VALUES (?, ?, ?, ?)
    `).run(entity_type, entity_id, action, description);
  } catch (e) {
    console.error('Failed to log activity', e);
  }
};

// Get all projects with computed progress
router.get('/', (req, res) => {
  try {
    const { status } = req.query;
    let query = `
      SELECT p.*, la.name as life_area_name,
        (
          SELECT json_object('total', COUNT(*), 'completed', SUM(CASE WHEN ci.completed = 1 THEN 1 ELSE 0 END))
          FROM project_checklists pc
          JOIN checklist_items ci ON pc.checklist_id = ci.checklist_id
          WHERE pc.project_id = p.id
        ) as checklist_stats
      FROM projects p
      LEFT JOIN life_areas la ON p.life_area_id = la.id
    `;
    let params = [];

    if (status) {
      query += ` WHERE p.status = ?`;
      params.push(status);
    }
    
    query += ` ORDER BY p.updated_at DESC`;

    const projects = db.prepare(query).all(params).map(project => {
      const stats = JSON.parse(project.checklist_stats);
      const total = stats.total || 0;
      const completed = stats.completed || 0;
      return {
        ...project,
        progress: total === 0 ? 0 : Math.round((completed / total) * 100),
        checklist_stats: { total, completed }
      };
    });

    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get a single project by ID, including checklists, milestones, skills, and activity logs
router.get('/:id', (req, res) => {
  try {
    const id = req.params.id;
    const project = db.prepare(`
      SELECT p.*, la.name as life_area_name 
      FROM projects p 
      LEFT JOIN life_areas la ON p.life_area_id = la.id 
      WHERE p.id = ?
    `).get(id);
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Get checklists
    const checklists = db.prepare(`
      SELECT c.id as checklist_id, c.title as checklist_title, ci.id as item_id, ci.title as item_title, ci.completed, ci.scheduled_date, ci.scheduled_time
      FROM project_checklists pc
      JOIN checklists c ON pc.checklist_id = c.id
      JOIN checklist_items ci ON c.id = ci.checklist_id
      WHERE pc.project_id = ?
      ORDER BY ci.display_order, ci.id
    `).all(id);

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

    // Get milestones
    const milestones = db.prepare(`SELECT * FROM project_milestones WHERE project_id = ? ORDER BY due_date ASC, created_at ASC`).all(id);

    // Get related skills
    const skills = db.prepare(`
      SELECT s.id, s.name, s.status, s.category 
      FROM project_skills ps
      JOIN skills s ON ps.skill_id = s.id
      WHERE ps.project_id = ?
    `).all(id);

    // Get activity logs
    const activities = db.prepare(`
      SELECT * FROM activity_logs 
      WHERE entity_type = 'project' AND entity_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(id);

    res.json({
      ...project,
      checklists: groupedChecklists,
      milestones,
      skills,
      activities
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch project details' });
  }
});

// Create a new project
router.post('/', (req, res) => {
  const { name, category, status, priority, schedule_type, target_date, life_area_id, description, why_building, notes } = req.body;
  try {
    const newStatus = status || 'Idea';
    
    // Automatic date rules
    const startedAt = newStatus === 'Building' ? new Date().toISOString() : null;
    const completedAt = newStatus === 'Completed' ? new Date().toISOString() : null;

    const result = db.prepare(`
      INSERT INTO projects (name, category, status, priority, schedule_type, target_date, life_area_id, description, why_building, notes, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, category, newStatus, priority, schedule_type || 'Flexible', target_date, life_area_id, description, why_building, notes, startedAt, completedAt);
    
    logActivity('project', result.lastInsertRowid, 'Created Project', `Status initialized as ${newStatus}`);
    
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update a project
router.put('/:id', (req, res) => {
  const { status, schedule_type, target_date, description, why_building, notes } = req.body;
  const id = req.params.id;
  
  try {
    const current = db.prepare(`SELECT status FROM projects WHERE id = ?`).get(id);
    if (!current) return res.status(404).json({ error: 'Project not found' });
    
    let startedAtSql = "";
    let completedAtSql = "";
    
    if (status && current.status !== status) {
      if (status === 'Building' && current.status !== 'Testing') {
        startedAtSql = ", started_at = CURRENT_TIMESTAMP";
      } else if (status === 'Completed') {
        completedAtSql = ", completed_at = CURRENT_TIMESTAMP";
      }
      logActivity('project', id, 'Status Changed', `Changed from ${current.status} to ${status}`);
    }

    const query = `
      UPDATE projects 
      SET status = coalesce(?, status), 
          schedule_type = coalesce(?, schedule_type),
          target_date = coalesce(?, target_date),
          description = coalesce(?, description),
          why_building = coalesce(?, why_building),
          notes = coalesce(?, notes),
          updated_at = CURRENT_TIMESTAMP
          ${startedAtSql}
          ${completedAtSql}
      WHERE id = ?
    `;
    
    db.prepare(query).run(status, schedule_type, target_date, description, why_building, notes, id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Add a checklist item (and checklist if needed)
router.post('/:id/checklists', (req, res) => {
  const { checklist_title, item_title, scheduled_date, scheduled_time } = req.body;
  const project_id = req.params.id;
  
  try {
    let checklist_id;
    db.transaction(() => {
      let cl = db.prepare(`
        SELECT c.id FROM checklists c 
        JOIN project_checklists pc ON c.id = pc.checklist_id 
        WHERE pc.project_id = ? AND c.title = ?
      `).get(project_id, checklist_title || 'General');

      if (!cl) {
        const insertCl = db.prepare(`INSERT INTO checklists (title) VALUES (?)`).run(checklist_title || 'General');
        checklist_id = insertCl.lastInsertRowid;
        db.prepare(`INSERT INTO project_checklists (project_id, checklist_id) VALUES (?, ?)`).run(project_id, checklist_id);
      } else {
        checklist_id = cl.id;
      }

      db.prepare(`
        INSERT INTO checklist_items (checklist_id, title, scheduled_date, scheduled_time) VALUES (?, ?, ?, ?)
      `).run(checklist_id, item_title, scheduled_date || null, scheduled_time || null);
    })();
    
    logActivity('project', project_id, 'Added Task', `Added task: ${item_title} to ${checklist_title || 'General'}`);
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
  const project_id = req.params.id;
  
  try {
    db.prepare(`
      UPDATE checklist_items 
      SET completed = ?, completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(completed ? 1 : 0, completed ? 1 : 0, itemId);
    
    const item = db.prepare(`SELECT title FROM checklist_items WHERE id = ?`).get(itemId);
    if (completed) {
       logActivity('project', project_id, 'Completed Task', `Finished: ${item.title}`);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update checklist item' });
  }
});

// Add Milestone
router.post('/:id/milestones', (req, res) => {
  const { title, description, due_date } = req.body;
  const project_id = req.params.id;
  
  try {
    db.prepare(`
      INSERT INTO project_milestones (project_id, title, description, due_date)
      VALUES (?, ?, ?, ?)
    `).run(project_id, title, description, due_date || null);
    
    logActivity('project', project_id, 'Added Milestone', `New Milestone: ${title}`);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add milestone' });
  }
});

// Toggle Milestone
router.put('/:id/milestones/:milestoneId', (req, res) => {
  const { completed } = req.body;
  const milestoneId = req.params.milestoneId;
  const project_id = req.params.id;
  
  try {
    db.prepare(`
      UPDATE project_milestones 
      SET completed = ?, completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END
      WHERE id = ?
    `).run(completed ? 1 : 0, completed ? 1 : 0, milestoneId);
    
    const m = db.prepare(`SELECT title FROM project_milestones WHERE id = ?`).get(milestoneId);
    if (completed) {
      logActivity('project', project_id, 'Achieved Milestone', `Hit Milestone: ${m.title}`);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update milestone' });
  }
});

// Link Skill
router.post('/:id/skills', (req, res) => {
  const { skill_id } = req.body;
  const project_id = req.params.id;
  
  try {
    db.prepare(`
      INSERT INTO project_skills (project_id, skill_id) VALUES (?, ?)
    `).run(project_id, skill_id);
    
    const skill = db.prepare(`SELECT name FROM skills WHERE id = ?`).get(skill_id);
    logActivity('project', project_id, 'Linked Skill', `Linked Skill: ${skill.name}`);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to link skill' });
  }
});

module.exports = router;
