const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

router.get('/queue', (req, res) => {
  try {
    // Fetch today's queue logic based on dashboard.txt specification
    
    // We get all checklist items that are NOT completed, and also those completed TODAY.
    // To identify "today", we use SQLite's date function for the local timezone or UTC.
    // For simplicity, we fetch all incomplete and filter completed_at >= date('now').

    const stmt = db.prepare(`
      SELECT 
        ci.id, 
        ci.title, 
        ci.description, 
        ci.completed, 
        ci.scheduled_date,
        ci.scheduled_time, 
        ci.completed_at,
        CASE 
          WHEN sc.skill_id IS NOT NULL THEN 'Skill'
          WHEN pc.project_id IS NOT NULL THEN 'Project'
          WHEN gc.goal_id IS NOT NULL THEN 'Goal'
          ELSE 'Other'
        END as source_type
      FROM checklist_items ci
      LEFT JOIN skill_checklists sc ON ci.checklist_id = sc.checklist_id
      LEFT JOIN project_checklists pc ON ci.checklist_id = pc.checklist_id
      LEFT JOIN goal_checklists gc ON ci.checklist_id = gc.checklist_id
      WHERE (ci.completed = 0 AND (ci.scheduled_date IS NULL OR ci.scheduled_date <= date('now'))) 
         OR date(ci.completed_at) = date('now')
    `);

    const items = stmt.all();

    const scheduled = [];
    const unscheduled = [];
    const completedToday = [];

    items.forEach(item => {
      if (item.completed) {
        completedToday.push(item);
      } else if (item.scheduled_date || item.scheduled_time) {
        scheduled.push(item);
      } else {
        unscheduled.push(item);
      }
    });

    scheduled.sort((a, b) => {
      const aTime = a.scheduled_time || '23:59';
      const bTime = b.scheduled_time || '23:59';
      return aTime.localeCompare(bTime);
    });
    unscheduled.sort((a, b) => a.title.localeCompare(b.title));

    res.json({
      scheduled,
      unscheduled,
      completedToday
    });

  } catch (error) {
    console.error('Error generating queue:', error);
    res.status(500).json({ error: 'Failed to generate queue' });
  }
});

router.get('/focus', (req, res) => {
  try {
    // Current Focus queries active projects, skills, goals
    const activeSkill = db.prepare(`SELECT * FROM skills WHERE status = 'Active' ORDER BY updated_at DESC LIMIT 1`).get();
    const activeProject = db.prepare(`SELECT * FROM projects WHERE status = 'Building' ORDER BY updated_at DESC LIMIT 1`).get();
    const activeGoal = db.prepare(`
      SELECT * FROM goals 
      WHERE status = 'Active' 
      ORDER BY 
        CASE priority
          WHEN 'Critical' THEN 1
          WHEN 'High' THEN 2
          WHEN 'Medium' THEN 3
          WHEN 'Low' THEN 4
          ELSE 5
        END,
        updated_at DESC 
      LIMIT 1
    `).get();

    // Fetch progress based on checklists for these items
    const getProgress = (id, type) => {
      if (!id) return { progress: 0, completed: 0, total: 0 };
      let tableName = '';
      let idCol = '';
      if (type === 'skill') { tableName = 'skill_checklists'; idCol = 'skill_id'; }
      if (type === 'project') { tableName = 'project_checklists'; idCol = 'project_id'; }
      if (type === 'goal') { tableName = 'goal_checklists'; idCol = 'goal_id'; }
      
      const stat = db.prepare(`
        SELECT COUNT(*) as total, SUM(CASE WHEN ci.completed = 1 THEN 1 ELSE 0 END) as completed
        FROM checklist_items ci
        JOIN ${tableName} tc ON ci.checklist_id = tc.checklist_id
        WHERE tc.${idCol} = ?
      `).get(id);

      const total = stat.total || 0;
      const completed = stat.completed || 0;
      const progress = total === 0 ? 0 : Math.round((completed / total) * 100);

      return { progress, completed, total };
    };

    res.json({
      skill: activeSkill ? { ...activeSkill, ...getProgress(activeSkill.id, 'skill') } : null,
      project: activeProject ? { ...activeProject, ...getProgress(activeProject.id, 'project') } : null,
      goal: activeGoal ? { ...activeGoal, ...getProgress(activeGoal.id, 'goal') } : null
    });
  } catch (error) {
    console.error('Error fetching focus:', error);
    res.status(500).json({ error: 'Failed to fetch focus' });
  }
});

router.get('/stats', (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    const stats = {
      health: {
        calories: { current: 0, target: 2200 },
        protein: { current: 0, target: 150 }
      },
      projects: {
        active: 0,
        completed: 0
      },
      fitness: {
        workout_today: null,
        streak: 0
      }
    };

    // Health
    const healthTargets = db.prepare('SELECT * FROM user_settings LIMIT 1').get();
    if (healthTargets) {
      stats.health.calories.target = healthTargets.calorie_target;
      stats.health.protein.target = healthTargets.protein_target;
    }
    const todayLog = db.prepare('SELECT calories, protein FROM nutrition_logs WHERE log_date = ?').get(today);
    if (todayLog) {
      stats.health.calories.current = todayLog.calories;
      stats.health.protein.current = todayLog.protein;
    }

    // Projects
    stats.projects.active = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status IN ('Idea', 'Planned', 'Building', 'Testing')").get().count;
    stats.projects.completed = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'Completed'").get().count;

    // Fitness
    const todaySession = db.prepare('SELECT completed_at FROM workout_sessions WHERE session_date = ?').get(today);
    stats.fitness.workout_today = todaySession ? (todaySession.completed_at ? 'Completed' : 'Logged') : 'None';

    const recentSessions = db.prepare('SELECT session_date, completed_at FROM workout_sessions ORDER BY session_date DESC').all();
    let streak = 0;
    for (const s of recentSessions) {
      if (s.completed_at) streak++;
      else break;
    }
    stats.fitness.streak = streak;

    res.json(stats);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch quick stats' });
  }
});

router.put('/checklists/items/:itemId', (req, res) => {
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
