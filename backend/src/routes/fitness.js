const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

// Get all workout templates
router.get('/templates', (req, res) => {
  try {
    const templates = db.prepare('SELECT * FROM workout_templates ORDER BY created_at DESC').all();
    res.json(templates);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

// Get specific template with its days and exercises
router.get('/templates/:id', (req, res, next) => {
  try {
    if (req.params.id === 'active') return next(); // Fallthrough to /templates/active
    
    const template = db.prepare('SELECT * FROM workout_templates WHERE id = ?').get(req.params.id);
    if (!template) return res.status(404).json({ error: 'Not found' });

    const days = db.prepare('SELECT * FROM workout_days WHERE template_id = ? ORDER BY display_order ASC, id ASC').all(template.id);
    const exercisesQuery = db.prepare('SELECT * FROM exercises WHERE workout_day_id = ? ORDER BY display_order ASC, id ASC');

    template.days = days.map(day => {
      day.exercises = exercisesQuery.all(day.id);
      return day;
    });

    res.json(template);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch template' });
  }
});

// Get active template with its days and exercises
router.get('/templates/active', (req, res) => {
  try {
    const template = db.prepare('SELECT * FROM workout_templates WHERE active = 1 LIMIT 1').get();
    if (!template) return res.json(null);

    const days = db.prepare('SELECT * FROM workout_days WHERE template_id = ? ORDER BY display_order ASC, id ASC').all(template.id);
    const exercisesQuery = db.prepare('SELECT * FROM exercises WHERE workout_day_id = ? ORDER BY display_order ASC, id ASC');

    template.days = days.map(day => {
      day.exercises = exercisesQuery.all(day.id);
      return day;
    });

    res.json(template);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch active template' });
  }
});

// Create a new template with days and exercises
router.post('/templates', (req, res) => {
  const { name, description, days } = req.body;
  
  try {
    db.transaction(() => {
      // Create template
      const tplResult = db.prepare('INSERT INTO workout_templates (name, description, active) VALUES (?, ?, 0)').run(name, description);
      const tplId = tplResult.lastInsertRowid;

      // Add days
      const insertDay = db.prepare('INSERT INTO workout_days (template_id, name, repeat_day, display_order) VALUES (?, ?, ?, ?)');
      const insertExercise = db.prepare(`
        INSERT INTO exercises (workout_day_id, exercise_name, exercise_type, sets, target_weight, target_reps, target_distance, target_duration, notes, display_order) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      let dayOrder = 0;
      for (const day of days) {
        const dayResult = insertDay.run(tplId, day.name, day.repeat_day, dayOrder++);
        const dayId = dayResult.lastInsertRowid;

        let exOrder = 0;
        for (const ex of day.exercises || []) {
          insertExercise.run(
            dayId, 
            ex.exercise_name, 
            ex.exercise_type || 'Weight', 
            ex.sets || null, 
            ex.target_weight || null, 
            ex.target_reps || null, 
            ex.target_distance || null, 
            ex.target_duration || null, 
            ex.notes || '', 
            exOrder++
          );
        }
      }
    })();
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

// Update a template
router.put('/templates/:id', (req, res) => {
  const { name, description, days } = req.body;
  const tplId = req.params.id;

  try {
    db.transaction(() => {
      // Update template
      db.prepare('UPDATE workout_templates SET name = ?, description = ? WHERE id = ?').run(name, description, tplId);

      // Delete existing days (cascade deletes exercises, sets session links to null)
      db.prepare('DELETE FROM workout_days WHERE template_id = ?').run(tplId);

      // Re-add days
      const insertDay = db.prepare('INSERT INTO workout_days (template_id, name, repeat_day, display_order) VALUES (?, ?, ?, ?)');
      const insertExercise = db.prepare(`
        INSERT INTO exercises (workout_day_id, exercise_name, exercise_type, sets, target_weight, target_reps, target_distance, target_duration, notes, display_order) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      let dayOrder = 0;
      for (const day of days) {
        const dayResult = insertDay.run(tplId, day.name, day.repeat_day, dayOrder++);
        const dayId = dayResult.lastInsertRowid;

        let exOrder = 0;
        for (const ex of day.exercises || []) {
          insertExercise.run(
            dayId, 
            ex.exercise_name, 
            ex.exercise_type || 'Weight', 
            ex.sets || null, 
            ex.target_weight || null, 
            ex.target_reps || null, 
            ex.target_distance || null, 
            ex.target_duration || null, 
            ex.notes || '', 
            exOrder++
          );
        }
      }
    })();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update template' });
  }
});

// Delete a template
router.delete('/templates/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM workout_templates WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// Set active template
router.post('/templates/:id/active', (req, res) => {
  try {
    db.transaction(() => {
      db.prepare('UPDATE workout_templates SET active = 0').run();
      db.prepare('UPDATE workout_templates SET active = 1 WHERE id = ?').run(req.params.id);
    })();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to activate template' });
  }
});

// Deactivate a template
router.post('/templates/:id/deactivate', (req, res) => {
  try {
    db.prepare('UPDATE workout_templates SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to deactivate template' });
  }
});

// Get today's workout
router.get('/today', (req, res) => {
  try {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const todayStr = daysOfWeek[new Date().getDay()];

    const template = db.prepare('SELECT * FROM workout_templates WHERE active = 1 LIMIT 1').get();
    if (!template) return res.json(null);
    
    const todayDay = db.prepare('SELECT * FROM workout_days WHERE template_id = ? AND repeat_day = ? LIMIT 1').get(template.id, todayStr);
    
    if (!todayDay) {
      // Calculate generic workout streak
      let streakCount = 0;
      const pastSessions = db.prepare(`
        SELECT DISTINCT session_date, CAST(julianday(date('now', 'localtime')) - julianday(session_date) AS INTEGER) as days_ago
        FROM workout_sessions
        WHERE completed_at IS NOT NULL
        ORDER BY session_date DESC
      `).all();

      if (pastSessions.length > 0 && pastSessions[0].days_ago <= 1) {
        streakCount = 1;
        for (let i = 1; i < pastSessions.length; i++) {
          if (pastSessions[i].days_ago === pastSessions[i-1].days_ago + 1) {
            streakCount++;
          } else {
            break;
          }
        }
      }

      return res.json({ template_name: template.name, is_rest_day: true, streak_count: streakCount });
    }

    todayDay.exercises = db.prepare('SELECT * FROM exercises WHERE workout_day_id = ? ORDER BY display_order ASC, id ASC').all(todayDay.id);
    
    // Check if session already exists for today
    const session = db.prepare("SELECT * FROM workout_sessions WHERE workout_day_id = ? AND session_date = date('now', 'localtime') LIMIT 1").get(todayDay.id);

    // Calculate generic workout streak
    let streakCount = 0;
    const pastSessions = db.prepare(`
      SELECT DISTINCT session_date, CAST(julianday(date('now', 'localtime')) - julianday(session_date) AS INTEGER) as days_ago
      FROM workout_sessions
      WHERE completed_at IS NOT NULL
      ORDER BY session_date DESC
    `).all();

    if (pastSessions.length > 0 && pastSessions[0].days_ago <= 1) {
      streakCount = 1;
      for (let i = 1; i < pastSessions.length; i++) {
        if (pastSessions[i].days_ago === pastSessions[i-1].days_ago + 1) {
          streakCount++;
        } else {
          break;
        }
      }
    }

    res.json({
      template_id: template.id,
      template_name: template.name,
      workout_day: todayDay,
      session: session || null,
      is_rest_day: false,
      streak_count: streakCount
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch today workout' });
  }
});

// Create a workout session
router.post('/sessions', (req, res) => {
  const { template_id, workout_day_id, notes } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO workout_sessions (template_id, workout_day_id, session_date, started_at, notes)
      VALUES (?, ?, date('now', 'localtime'), CURRENT_TIMESTAMP, ?)
    `).run(template_id || null, workout_day_id || null, notes || '');
    
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// Get a session details
router.get('/sessions/:id', (req, res) => {
  try {
    const session = db.prepare(`
      SELECT s.*, t.name as template_name, d.name as day_name
      FROM workout_sessions s
      LEFT JOIN workout_templates t ON s.template_id = t.id
      LEFT JOIN workout_days d ON s.workout_day_id = d.id
      WHERE s.id = ?
    `).get(req.params.id);

    if (!session) return res.status(404).json({ error: 'Session not found' });

    session.logs = db.prepare('SELECT * FROM exercise_logs WHERE workout_session_id = ? ORDER BY id ASC').all(session.id);
    
    // Also fetch planned exercises to show what was missed / remaining
    if (session.workout_day_id) {
      session.planned_exercises = db.prepare('SELECT * FROM exercises WHERE workout_day_id = ? ORDER BY display_order ASC, id ASC').all(session.workout_day_id);
    } else {
      session.planned_exercises = [];
    }

    res.json(session);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Complete session
router.put('/sessions/:id/complete', (req, res) => {
  try {
    db.prepare('UPDATE workout_sessions SET completed_at = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to complete session' });
  }
});

// Log an exercise
router.post('/sessions/:id/log', (req, res) => {
  const { exercise_name, exercise_type, weight, reps, sets, distance, duration } = req.body;
  const sessionId = req.params.id;
  
  try {
    db.transaction(() => {
      // 1. Log the exercise
      db.prepare(`
        INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_type, weight, reps, sets, distance, duration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sessionId, exercise_name, exercise_type, weight || null, reps || null, sets || null, distance || null, duration || null);
      
      // 2. Add to dictionary if new
      db.prepare('INSERT OR IGNORE INTO exercise_dictionary (name, category) VALUES (?, ?)').run(exercise_name, exercise_type);

      // 3. Update PRs
      const prStmt = db.prepare('SELECT * FROM personal_records WHERE exercise_name = ?').get(exercise_name);
      
      if (!prStmt) {
        db.prepare(`
          INSERT INTO personal_records (exercise_name, exercise_type, best_weight, best_reps, best_distance, best_duration, date_achieved)
          VALUES (?, ?, ?, ?, ?, ?, date('now', 'localtime'))
        `).run(exercise_name, exercise_type, weight || null, reps || null, distance || null, duration || null);
      } else {
        let updatePR = false;
        if (exercise_type === 'Weight' && weight && (!prStmt.best_weight || weight > prStmt.best_weight)) {
          prStmt.best_weight = weight; prStmt.best_reps = reps; updatePR = true;
        } else if (exercise_type === 'Distance' && distance && (!prStmt.best_distance || distance > prStmt.best_distance)) {
          prStmt.best_distance = distance; updatePR = true;
        } else if (exercise_type === 'Duration' && duration && (!prStmt.best_duration || duration > prStmt.best_duration)) {
          prStmt.best_duration = duration; updatePR = true;
        }

        if (updatePR) {
          db.prepare(`
            UPDATE personal_records 
            SET best_weight = ?, best_reps = ?, best_distance = ?, best_duration = ?, date_achieved = date('now', 'localtime')
            WHERE id = ?
          `).run(prStmt.best_weight, prStmt.best_reps, prStmt.best_distance, prStmt.best_duration, prStmt.id);
        }
      }
    })();
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to log exercise' });
  }
});

// Update a logged exercise
router.put('/sessions/log/:log_id', (req, res) => {
  const { weight, reps, sets, distance, duration } = req.body;
  try {
    db.prepare(`
      UPDATE exercise_logs 
      SET weight = ?, reps = ?, sets = ?, distance = ?, duration = ?
      WHERE id = ?
    `).run(weight || null, reps || null, sets || null, distance || null, duration || null, req.params.log_id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update exercise log' });
  }
});

// Delete a logged exercise
router.delete('/sessions/log/:log_id', (req, res) => {
  try {
    db.prepare('DELETE FROM exercise_logs WHERE id = ?').run(req.params.log_id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete exercise log' });
  }
});

// Delete a session
router.delete('/sessions/:id', (req, res) => {
  try {
    db.prepare('DELETE FROM workout_sessions WHERE id = ?').run(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Workout History (recent sessions)
router.get('/history', (req, res) => {
  try {
    const sessions = db.prepare(`
      SELECT s.*, t.name as template_name, d.name as day_name,
             (SELECT COUNT(*) FROM exercise_logs el WHERE el.workout_session_id = s.id) as log_count
      FROM workout_sessions s
      LEFT JOIN workout_templates t ON s.template_id = t.id
      LEFT JOIN workout_days d ON s.workout_day_id = d.id
      ORDER BY s.session_date DESC, s.id DESC
      LIMIT 50
    `).all();
    res.json(sessions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// Exercise dictionary
router.get('/exercises/dictionary', (req, res) => {
  try {
    const dict = db.prepare('SELECT * FROM exercise_dictionary ORDER BY name ASC').all();
    res.json(dict);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch dictionary' });
  }
});

// Personal records
router.get('/pr', (req, res) => {
  try {
    const prs = db.prepare('SELECT * FROM personal_records ORDER BY exercise_name ASC').all();
    res.json(prs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch PRs' });
  }
});

module.exports = router;
