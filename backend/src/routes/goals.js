const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

// GET all goals with basic aggregated progress
router.get('/', (req, res) => {
  try {
    const goals = db.prepare(`
      SELECT g.*, la.name as life_area_name,
        (
          SELECT json_object('total', COUNT(*), 'completed', SUM(CASE WHEN ci.completed = 1 THEN 1 ELSE 0 END))
          FROM goal_checklists gc
          JOIN checklist_items ci ON gc.checklist_id = ci.checklist_id
          WHERE gc.goal_id = g.id
        ) as checklist_stats
      FROM goals g
      LEFT JOIN life_areas la ON g.life_area_id = la.id
      ORDER BY 
        CASE g.priority
          WHEN 'Critical' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          WHEN 'Low' THEN 4
          ELSE 5
        END,
        g.updated_at DESC
    `).all().map(goal => {
      // In the list view we just do a rough approximation or rely on the same calculation
      // But actually, it's better to fetch full details or just do checklist for now to save queries.
      // We will re-implement the actual progress below.
      const stats = goal.checklist_stats ? JSON.parse(goal.checklist_stats) : { total: 0, completed: 0 };
      const total = stats.total || 0;
      const completed = stats.completed || 0;
      let progress = 0;
      if (goal.progress_mode === 'Checklist') {
         progress = total === 0 ? 0 : Math.round((completed / total) * 100);
      } else if (goal.progress_mode === 'Manual') {
         progress = goal.manual_progress;
      } else {
         // Linked mode approximation (we don't have all linked data here, so we fallback to checklist for list view unless manual)
         progress = total === 0 ? 0 : Math.round((completed / total) * 100);
      }
      return {
        ...goal,
        progress,
        checklist_stats: { total, completed }
      };
    });
    res.json(goals);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch goals' });
  }
});

// GET a specific goal with full details
router.get('/:id', (req, res) => {
  const id = req.params.id;
  try {
    const goal = db.prepare(`
      SELECT g.*, la.name as life_area_name
      FROM goals g
      LEFT JOIN life_areas la ON g.life_area_id = la.id
      WHERE g.id = ?
    `).get(id);

    if (!goal) return res.status(404).json({ error: 'Goal not found' });

    // Fetch checklists
    const checklists = db.prepare(`
      SELECT c.id as checklist_id, c.title as checklist_title, ci.id as item_id, ci.title as item_title, ci.completed
      FROM goal_checklists gc
      JOIN checklists c ON gc.checklist_id = c.id
      JOIN checklist_items ci ON c.id = ci.checklist_id
      WHERE gc.goal_id = ?
      ORDER BY ci.display_order, ci.id
    `).all(id);

    const groupedChecklists = checklists.reduce((acc, curr) => {
      let cl = acc.find(c => c.id === curr.checklist_id);
      if (!cl) {
        cl = { id: curr.checklist_id, title: curr.checklist_title, items: [] };
        acc.push(cl);
      }
      cl.items.push({ id: curr.item_id, title: curr.item_title, completed: curr.completed });
      return acc;
    }, []);

    // Fetch linked skills
    const skills = db.prepare(`
      SELECT s.id, s.name, s.status, s.category
      FROM goal_skills gs
      JOIN skills s ON gs.skill_id = s.id
      WHERE gs.goal_id = ?
    `).all(id);

    // Fetch linked projects
    const projects = db.prepare(`
      SELECT p.id, p.name, p.status, p.category
      FROM goal_projects gp
      JOIN projects p ON gp.project_id = p.id
      WHERE gp.goal_id = ?
    `).all(id);

    // Fetch targets
    const targets = db.prepare(`
      SELECT * FROM goal_targets WHERE goal_id = ?
    `).all(id);

    // Calculate aggregated progress based on mode
    let progress = 0;
    
    if (goal.progress_mode === 'Checklist') {
      let clTotal = 0;
      let clCompleted = 0;
      groupedChecklists.forEach(c => {
        clTotal += c.items.length;
        clCompleted += c.items.filter(i => i.completed).length;
      });
      progress = clTotal === 0 ? 0 : Math.round((clCompleted / clTotal) * 100);
    } 
    else if (goal.progress_mode === 'Linked') {
      let lnTotal = 0;
      let lnCompleted = 0;
      skills.forEach(s => { lnTotal++; if (s.status === 'Completed') lnCompleted++; });
      projects.forEach(p => { lnTotal++; if (p.status === 'Completed') lnCompleted++; });
      targets.forEach(t => {
        lnTotal++;
        if ((t.target_type === 'weight' && t.current_value <= t.target_value && t.current_value > 0) || 
            (t.target_type !== 'weight' && t.current_value >= t.target_value)) {
          lnCompleted++;
        }
      });
      progress = lnTotal === 0 ? 0 : Math.round((lnCompleted / lnTotal) * 100);
    } 
    else if (goal.progress_mode === 'Manual') {
      progress = goal.manual_progress || 0;
    }

    res.json({
      ...goal,
      checklists: groupedChecklists,
      skills,
      projects,
      targets,
      progress
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch goal details' });
  }
});

// POST create goal
router.post('/', (req, res) => {
  const { title, description, goal_type, category, priority, schedule_type, target_date, life_area_id, notes } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO goals (title, description, goal_type, category, priority, schedule_type, target_date, life_area_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description, goal_type || 'Outcome', category, priority || 'Medium', schedule_type || 'Flexible', target_date, life_area_id, notes);
    
    db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Created', ?)").run(result.lastInsertRowid, title);
    
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// PUT update goal
router.put('/:id', (req, res) => {
  const id = req.params.id;
  const { title, description, category, status, priority, schedule_type, target_date, life_area_id, notes, progress_mode, manual_progress } = req.body;
  try {
    const currentGoal = db.prepare("SELECT status FROM goals WHERE id = ?").get(id);
    let startedAtQuery = "";
    let completedAtQuery = "";
    
    if (status && status !== currentGoal.status) {
      if (status === 'Active' && currentGoal.status !== 'Active') startedAtQuery = ", started_at = CURRENT_TIMESTAMP";
      if (status === 'Completed' && currentGoal.status !== 'Completed') completedAtQuery = ", completed_at = CURRENT_TIMESTAMP";
      db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Status Changed', ?)").run(id, `Status changed to ${status}`);
    }

    db.prepare(`
      UPDATE goals
      SET title = coalesce(?, title),
          description = coalesce(?, description),
          category = coalesce(?, category),
          status = coalesce(?, status),
          priority = coalesce(?, priority),
          schedule_type = coalesce(?, schedule_type),
          target_date = coalesce(?, target_date),
          life_area_id = coalesce(?, life_area_id),
          notes = coalesce(?, notes),
          progress_mode = coalesce(?, progress_mode),
          manual_progress = coalesce(?, manual_progress),
          updated_at = CURRENT_TIMESTAMP
          ${startedAtQuery}
          ${completedAtQuery}
      WHERE id = ?
    `).run(title, description, category, status, priority, schedule_type, target_date, life_area_id, notes, progress_mode, manual_progress, id);
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// POST add checklist item
router.post('/:id/checklists', (req, res) => {
  const { checklist_title, item_title } = req.body;
  const goal_id = req.params.id;
  
  try {
    let checklist_id;
    db.transaction(() => {
      let cl = db.prepare(`
        SELECT c.id FROM checklists c 
        JOIN goal_checklists gc ON c.id = gc.checklist_id 
        WHERE gc.goal_id = ? AND c.title = ?
      `).get(goal_id, checklist_title || 'Execution Tasks');

      if (!cl) {
        const insertCl = db.prepare(`INSERT INTO checklists (title) VALUES (?)`).run(checklist_title || 'Execution Tasks');
        checklist_id = insertCl.lastInsertRowid;
        db.prepare(`INSERT INTO goal_checklists (goal_id, checklist_id) VALUES (?, ?)`).run(goal_id, checklist_id);
      } else {
        checklist_id = cl.id;
      }

      db.prepare(`INSERT INTO checklist_items (checklist_id, title) VALUES (?, ?)`).run(checklist_id, item_title);
      db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Task Added', ?)").run(goal_id, item_title);
    })();
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add checklist item' });
  }
});

// LINK Skills
router.post('/:id/skills', (req, res) => {
  const { skill_id } = req.body;
  try {
    db.prepare("INSERT INTO goal_skills (goal_id, skill_id) VALUES (?, ?)").run(req.params.id, skill_id);
    const skillName = db.prepare("SELECT name FROM skills WHERE id = ?").get(skill_id).name;
    db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Skill Linked', ?)").run(req.params.id, skillName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to link skill' });
  }
});

// LINK Projects
router.post('/:id/projects', (req, res) => {
  const { project_id } = req.body;
  try {
    db.prepare("INSERT INTO goal_projects (goal_id, project_id) VALUES (?, ?)").run(req.params.id, project_id);
    const projectName = db.prepare("SELECT name FROM projects WHERE id = ?").get(project_id).name;
    db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Project Linked', ?)").run(req.params.id, projectName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to link project' });
  }
});

// LINK Targets (Health/Fitness)
router.post('/:id/targets', (req, res) => {
  const { target_type, target_value } = req.body;
  try {
    db.prepare("INSERT INTO goal_targets (goal_id, target_type, target_value) VALUES (?, ?, ?)").run(req.params.id, target_type, target_value);
    db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Target Added', ?)").run(req.params.id, `${target_type}: ${target_value}`);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add target' });
  }
});

// GET timeline
router.get('/:id/timeline', (req, res) => {
  try {
    const timeline = db.prepare("SELECT * FROM activity_logs WHERE entity_type = 'goal' AND entity_id = ? ORDER BY created_at DESC").all(req.params.id);
    res.json(timeline);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch timeline' });
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
