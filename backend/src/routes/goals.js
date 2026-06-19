const express = require('express');
const { db } = require('../db/schema');
const { checkAndCompleteParents, checkGoalCompletion } = require('../services/goalHelpers');
const router = express.Router();

// GET all goals with basic aggregated progress
router.get('/', (req, res) => {
  try {
    const goals = db.prepare(`
      SELECT g.*, la.name as life_area_name,
        (
          SELECT json_object('total', COUNT(*), 'completed', SUM(CASE WHEN n.completed = 1 THEN 1 ELSE 0 END))
          FROM goal_nodes n
          WHERE n.goal_id = g.id AND n.id NOT IN (SELECT parent_id FROM goal_nodes WHERE parent_id IS NOT NULL AND goal_id = g.id)
        ) as node_stats
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
      const stats = goal.node_stats ? JSON.parse(goal.node_stats) : { total: 0, completed: 0 };
      const total = stats.total || 0;
      const completed = stats.completed || 0;
      let progress = 0;
      if (goal.progress_mode === 'Manual') {
         progress = goal.manual_progress;
      } else {
         progress = total === 0 ? 0 : Math.round((completed / total) * 100);
      }
      return {
        ...goal,
        progress,
        node_stats: { total, completed }
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

    // Fetch recursive nodes
    const nodes = db.prepare(`
      SELECT *
      FROM goal_nodes
      WHERE goal_id = ?
      ORDER BY display_order, id
    `).all(id);

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

    // Calculate aggregated progress based on leaf nodes
    let progress = 0;
    if (goal.progress_mode === 'Manual') {
      progress = goal.manual_progress || 0;
    } else {
      const parentIds = new Set(nodes.map(n => n.parent_id).filter(pid => pid !== null));
      const leafNodes = nodes.filter(n => !parentIds.has(n.id));
      const totalLeafs = leafNodes.length;
      const completedLeafs = leafNodes.filter(n => n.completed).length;
      progress = totalLeafs === 0 ? 0 : Math.round((completedLeafs / totalLeafs) * 100);
    }

    res.json({
      ...goal,
      nodes,
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
  const { title, description, goal_type, category, priority, schedule_type, start_date, target_date, life_area_id, notes } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO goals (title, description, goal_type, category, priority, schedule_type, start_date, target_date, life_area_id, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description, goal_type || 'Outcome', category, priority || 'Medium', schedule_type || 'Flexible', start_date || null, target_date || null, life_area_id || null, notes);
    
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
  const { title, description, category, status, priority, schedule_type, start_date, target_date, life_area_id, notes, progress_mode, manual_progress } = req.body;
  try {
    db.transaction(() => {
      const currentGoal = db.prepare("SELECT status FROM goals WHERE id = ?").get(id);
      let startedAtQuery = "";
      let completedAtQuery = "";
      
      if (status && status !== currentGoal.status) {
        if (status === 'Running' && currentGoal.status !== 'Running') startedAtQuery = ", started_at = CURRENT_TIMESTAMP";
        if (status === 'Completed' && currentGoal.status !== 'Completed') completedAtQuery = ", completed_at = CURRENT_TIMESTAMP";
        db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Status Changed', ?)").run(id, `Status changed to ${status}`);
        
        let projectStatus, skillStatus;
        switch (status) {
          case 'Running':
            projectStatus = 'Building';
            skillStatus = 'Learning';
            break;
          case 'Dropped':
            projectStatus = 'Cancelled';
            skillStatus = 'Dropped';
            break;
          case 'Backlog':
            projectStatus = 'Idea';
            skillStatus = 'Planned';
            break;
          case 'Completed':
            projectStatus = 'Completed';
            skillStatus = 'Completed';
            break;
          case 'Planned':
            projectStatus = 'Planned';
            skillStatus = 'Planned';
            break;
        }

        if (projectStatus) {
          db.prepare(`UPDATE projects SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT project_id FROM goal_projects WHERE goal_id = ?) AND status != 'Completed'`).run(projectStatus, id);
        }
        if (skillStatus) {
          db.prepare(`UPDATE skills SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (SELECT skill_id FROM goal_skills WHERE goal_id = ?) AND status != 'Completed'`).run(skillStatus, id);
        }
      }

      db.prepare(`
        UPDATE goals
        SET title = coalesce(?, title),
            description = coalesce(?, description),
            category = coalesce(?, category),
            status = coalesce(?, status),
            priority = coalesce(?, priority),
            schedule_type = coalesce(?, schedule_type),
            start_date = coalesce(?, start_date),
            target_date = coalesce(?, target_date),
            life_area_id = coalesce(?, life_area_id),
            notes = coalesce(?, notes),
            progress_mode = coalesce(?, progress_mode),
            manual_progress = coalesce(?, manual_progress),
            updated_at = CURRENT_TIMESTAMP
            ${startedAtQuery}
            ${completedAtQuery}
        WHERE id = ?
      `).run(title, description, category, status, priority, schedule_type, start_date || null, target_date || null, life_area_id || null, notes, progress_mode, manual_progress, id);
    })();
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update goal' });
  }
});

// POST add node
router.post('/:id/nodes', (req, res) => {
  const { title, description, parent_id, skill_id, project_id } = req.body;
  const goal_id = req.params.id;
  try {
    const result = db.prepare(`
      INSERT INTO goal_nodes (goal_id, parent_id, title, description, skill_id, project_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(goal_id, parent_id || null, title, description || null, skill_id || null, project_id || null);
    
    db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Node Added', ?)").run(goal_id, title);
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to add node' });
  }
});

// PUT update node
router.put('/:id/nodes/:nodeId', (req, res) => {
  const { title, description, display_order, skill_id, project_id } = req.body;
  const { id: goal_id, nodeId } = req.params;
  try {
    db.prepare(`
      UPDATE goal_nodes
      SET title = coalesce(?, title),
          description = coalesce(?, description),
          display_order = coalesce(?, display_order),
          skill_id = coalesce(?, skill_id),
          project_id = coalesce(?, project_id),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND goal_id = ?
    `).run(title, description, display_order, skill_id, project_id, nodeId, goal_id);
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update node' });
  }
});

// PUT toggle node
router.put('/:id/nodes/:nodeId/toggle', (req, res) => {
  const { completed } = req.body;
  const { id: goal_id, nodeId } = req.params;
  try {
    db.transaction(() => {
      // Toggle the node itself
      db.prepare(`
        UPDATE goal_nodes
        SET completed = ?, completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
            unchecked_at = CASE WHEN ? = 0 THEN CURRENT_TIMESTAMP ELSE NULL END,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(completed ? 1 : 0, completed ? 1 : 0, completed ? 1 : 0, nodeId);

      const node = db.prepare("SELECT title, parent_id FROM goal_nodes WHERE id = ?").get(nodeId);

      // Recursively complete parents if checked
      if (completed && node.parent_id) {
        checkAndCompleteParents(goal_id, node.parent_id);
      }

      checkGoalCompletion(goal_id);

      // Timeline log for the task
      db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, ?, ?)").run(
        goal_id, 
        completed ? 'Node Completed' : 'Node Unchecked', 
        node.title
      );
    })();
    res.json({ success: true });
  } catch(error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to toggle node' });
  }
});

// LINK Skills (Global)
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

// LINK Projects (Global)
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
    const timeline = db.prepare("SELECT * FROM activity_logs WHERE entity_type = 'goal' AND entity_id = ? AND action IN ('Created', 'Status Changed') ORDER BY created_at DESC").all(req.params.id);
    res.json(timeline);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch timeline' });
  }
});

// DEPRECATED POST add checklist item (kept for backwards compat if needed, but we shouldn't need it)
// We remove this to avoid confusion.

// Delete a goal
router.delete('/:id', (req, res) => {
  try {
    const id = req.params.id;
    db.prepare('DELETE FROM goals WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

module.exports = router;
