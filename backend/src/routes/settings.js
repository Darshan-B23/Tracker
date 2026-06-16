const express = require('express');
const { db } = require('../db/schema');
const fs = require('fs');
const path = require('path');
const router = express.Router();

router.get('/', (req, res) => {
  try {
    let settings = db.prepare('SELECT * FROM user_settings WHERE id = 1').get();
    if (!settings) {
      db.prepare("INSERT INTO user_settings (id, display_name) VALUES (1, 'User')").run();
      settings = db.prepare('SELECT * FROM user_settings WHERE id = 1').get();
    }
    
    // Parse JSON fields
    settings.queue_config = JSON.parse(settings.queue_config || '{}');
    settings.body_metrics_prefs = JSON.parse(settings.body_metrics_prefs || '{}');
    settings.reminder_times = JSON.parse(settings.reminder_times || '{}');
    
    res.json(settings);
  } catch (error) {
    console.error('Failed to load settings:', error);
    res.status(500).json({ error: 'Failed to load settings' });
  }
});

router.put('/', (req, res) => {
  try {
    const data = req.body;
    
    // Ensure JSON fields are stringified
    const queue_config = typeof data.queue_config === 'object' ? JSON.stringify(data.queue_config) : data.queue_config;
    const body_metrics_prefs = typeof data.body_metrics_prefs === 'object' ? JSON.stringify(data.body_metrics_prefs) : data.body_metrics_prefs;
    const reminder_times = typeof data.reminder_times === 'object' ? JSON.stringify(data.reminder_times) : data.reminder_times;

    const stmt = db.prepare(`
      UPDATE user_settings SET 
        display_name = ?, timezone = ?, date_format = ?, time_format = ?,
        default_dashboard_view = ?, default_sort_order = ?, default_landing_page = ?, queue_config = ?,
        theme = ?, density = ?, sidebar_state = ?, animations = ?,
        calorie_target = ?, protein_target = ?, carbs_target = ?, fat_target = ?, fiber_target = ?, water_target = ?, body_metrics_prefs = ?,
        weekly_workout_target = ?, preferred_workout_template = ?, strength_tracking_enabled = ?,
        default_skill_status = ?, default_skill_schedule = ?, auto_complete_skills = ?,
        default_project_status = ?, default_project_schedule = ?, auto_portfolio_project = ?,
        default_goal_type = ?, default_goal_status = ?, default_goal_progress_mode = ?,
        reminder_times = ?, deadline_alerts_enabled = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `);

    stmt.run(
      data.display_name, data.timezone, data.date_format, data.time_format,
      data.default_dashboard_view, data.default_sort_order, data.default_landing_page, queue_config,
      data.theme, data.density, data.sidebar_state, data.animations,
      data.calorie_target, data.protein_target, data.carbs_target, data.fat_target, data.fiber_target, data.water_target, body_metrics_prefs,
      data.weekly_workout_target, data.preferred_workout_template, data.strength_tracking_enabled ? 1 : 0,
      data.default_skill_status, data.default_skill_schedule, data.auto_complete_skills ? 1 : 0,
      data.default_project_status, data.default_project_schedule, data.auto_portfolio_project ? 1 : 0,
      data.default_goal_type, data.default_goal_status, data.default_goal_progress_mode,
      reminder_times, data.deadline_alerts_enabled ? 1 : 0
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Failed to save settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

router.get('/export', (req, res) => {
  try {
    const tables = [
      'user_settings', 'life_areas', 'skills', 'projects', 'goals',
      'goal_skills', 'goal_projects', 'project_skills', 'project_milestones',
      'learning_sessions', 'checklists', 'checklist_items',
      'skill_checklists', 'project_checklists', 'goal_checklists', 'goal_targets', 'workout_checklists',
      'nutrition_logs', 'recipes', 'recipe_tags', 'body_metrics',
      'workout_templates', 'workout_logs', 'exercises', 'strength_logs',
      'notifications', 'activity_logs'
    ];

    const exportData = {};
    tables.forEach(t => {
      exportData[t] = db.prepare(`SELECT * FROM ${t}`).all();
    });

    res.json(exportData);
  } catch (error) {
    res.status(500).json({ error: 'Export failed' });
  }
});

router.post('/import', (req, res) => {
  try {
    const data = req.body;
    if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Invalid data' });

    // Wipe and restore process (Dangerous but requested)
    db.transaction(() => {
      db.pragma('foreign_keys = OFF');
      
      for (const table of Object.keys(data)) {
        if (!Array.isArray(data[table])) continue;
        
        // Clear existing
        db.prepare(`DELETE FROM ${table}`).run();
        
        if (data[table].length === 0) continue;

        // Re-insert
        const columns = Object.keys(data[table][0]);
        const placeholders = columns.map(() => '?').join(',');
        const insertStmt = db.prepare(`INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`);
        
        for (const row of data[table]) {
          insertStmt.run(columns.map(c => row[c]));
        }
      }

      db.pragma('foreign_keys = ON');
    })();

    res.json({ success: true });
  } catch (error) {
    console.error('Import failed:', error);
    res.status(500).json({ error: 'Import failed' });
  }
});

module.exports = router;
