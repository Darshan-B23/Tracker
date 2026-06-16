const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

const getDateFilter = (days) => {
  if (!days || days === 'all') return "1=1";
  return `date(created_at) >= date('now', '-${parseInt(days)} days')`;
};
const getLogDateFilter = (days) => {
  if (!days || days === 'all') return "1=1";
  return `date(log_date) >= date('now', '-${parseInt(days)} days')`;
};
const getSessionDateFilter = (days) => {
  if (!days || days === 'all') return "1=1";
  return `date(session_date) >= date('now', '-${parseInt(days)} days')`;
};
const getMeasurementDateFilter = (days) => {
  if (!days || days === 'all') return "1=1";
  return `date(measurement_date) >= date('now', '-${parseInt(days)} days')`;
};
const getCompletedAtFilter = (days, tablePrefix = '') => {
  if (!days || days === 'all') return "1=1";
  const col = tablePrefix ? `${tablePrefix}.completed_at` : 'completed_at';
  return `date(${col}) >= date('now', '-${parseInt(days)} days')`;
};

router.get('/overview', (req, res) => {
  try {
    const d = req.query.days;
    
    // KPI Metrics
    const activeSkills = db.prepare("SELECT COUNT(*) as count FROM skills WHERE status = 'Active'").get().count;
    const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status IN ('Idea', 'Planned', 'Building', 'Testing')").get().count;
    const activeGoals = db.prepare("SELECT COUNT(*) as count FROM goals WHERE status = 'Active'").get().count;

    // Streaks (Calculate current streak)
    const recentWorkouts = db.prepare('SELECT session_date, completed_at FROM workout_sessions ORDER BY session_date DESC').all();
    let workoutStreak = 0;
    for (const w of recentWorkouts) { if (w.completed_at) workoutStreak++; else break; }

    const recentLearning = db.prepare('SELECT session_date FROM learning_sessions GROUP BY session_date ORDER BY session_date DESC').all();
    let learningStreak = 0;
    let expectedDate = new Date();
    for (let i=0; i < recentLearning.length; i++) {
        // Simple streak logic: check consecutive days
        const dStr = recentLearning[i].session_date;
        const eStr = expectedDate.toISOString().split('T')[0];
        if (dStr === eStr) {
            learningStreak++;
            expectedDate.setDate(expectedDate.getDate() - 1);
        } else if (i === 0) {
            // Check if streak is alive but not today yet
            expectedDate.setDate(expectedDate.getDate() - 1);
            const eStrYest = expectedDate.toISOString().split('T')[0];
            if (dStr === eStrYest) {
                learningStreak++;
                expectedDate.setDate(expectedDate.getDate() - 1);
            } else {
                break;
            }
        } else {
            break;
        }
    }

    res.json({
      metrics: {
        activeSkills,
        activeProjects,
        activeGoals,
        workoutStreak,
        learningStreak
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/skills', (req, res) => {
  try {
    const d = req.query.days;
    const dateFilter = getSessionDateFilter(d);

    const activeSkills = db.prepare("SELECT COUNT(*) as count FROM skills WHERE status = 'Active'").get().count;
    const completedSkills = db.prepare("SELECT COUNT(*) as count FROM skills WHERE status = 'Completed'").get().count;
    
    const learningMetrics = db.prepare(`SELECT SUM(duration_minutes) as total_mins, COUNT(*) as sessions FROM learning_sessions WHERE ${dateFilter}`).get();
    const totalHours = Math.round((learningMetrics.total_mins || 0) / 60);

    // Chart: Learning Hours by Month
    const hoursTrend = db.prepare(`
      SELECT strftime('%Y-%m', session_date) as month, SUM(duration_minutes)/60.0 as hours 
      FROM learning_sessions 
      WHERE ${dateFilter} 
      GROUP BY month ORDER BY month
    `).all();

    res.json({
      metrics: {
        activeSkills,
        completedSkills,
        totalHours,
        sessions: learningMetrics.sessions || 0
      },
      charts: {
        hoursTrend
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/projects', (req, res) => {
  try {
    const d = req.query.days;
    
    const activeProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status IN ('Building', 'Testing')").get().count;
    const completedProjects = db.prepare("SELECT COUNT(*) as count FROM projects WHERE status = 'Completed'").get().count;
    
    const projectsTrend = db.prepare(`
      SELECT strftime('%Y-%m', created_at) as month, 
             SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status IN ('Building', 'Testing') THEN 1 ELSE 0 END) as active
      FROM projects 
      WHERE ${getDateFilter(d)}
      GROUP BY month ORDER BY month
    `).all();

    res.json({
      metrics: {
        activeProjects,
        completedProjects
      },
      charts: {
        projectsTrend
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/fitness', (req, res) => {
  try {
    const d = req.query.days;
    const sessionDateFilter = getSessionDateFilter(d).replace(/session_date/g, 's.session_date');

    const totalWorkouts = db.prepare(`SELECT COUNT(*) as count FROM workout_sessions s WHERE s.completed_at IS NOT NULL AND ${sessionDateFilter}`).get().count;
    
    const duration = db.prepare(`
      SELECT SUM(el.duration) as mins 
      FROM exercise_logs el
      JOIN workout_sessions s ON el.workout_session_id = s.id
      WHERE s.completed_at IS NOT NULL AND ${sessionDateFilter}
    `).get().mins || 0;
    
    const hoursTrend = db.prepare(`
      SELECT strftime('%Y-%m', s.session_date) as month, SUM(el.duration)/60.0 as hours 
      FROM exercise_logs el
      JOIN workout_sessions s ON el.workout_session_id = s.id
      WHERE s.completed_at IS NOT NULL AND ${sessionDateFilter}
      GROUP BY month ORDER BY month
    `).all();

    res.json({
      metrics: {
        totalWorkouts,
        totalHours: Math.round(duration/60)
      },
      charts: {
        hoursTrend
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/health', (req, res) => {
  try {
    const d = req.query.days;
    
    const currentWeight = db.prepare("SELECT weight FROM body_metrics ORDER BY measurement_date DESC LIMIT 1").get()?.weight || 0;
    const startWeightRow = db.prepare(`SELECT weight FROM body_metrics WHERE ${getMeasurementDateFilter(d)} ORDER BY measurement_date ASC LIMIT 1`).get();
    const startWeight = startWeightRow ? startWeightRow.weight : currentWeight;
    const weightChange = (currentWeight - startWeight).toFixed(1);

    const weightTrend = db.prepare(`
      SELECT measurement_date as date, weight, body_fat 
      FROM body_metrics 
      WHERE ${getMeasurementDateFilter(d)}
      ORDER BY date ASC
    `).all();

    const calTrend = db.prepare(`
      SELECT log_date as date, calories, protein 
      FROM nutrition_logs 
      WHERE ${getLogDateFilter(d)}
      ORDER BY date ASC
    `).all();

    res.json({
      metrics: {
        currentWeight,
        weightChange
      },
      charts: {
        weightTrend,
        calTrend
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/goals', (req, res) => {
  try {
    const d = req.query.days;
    
    const activeGoals = db.prepare("SELECT COUNT(*) as count FROM goals WHERE status = 'Active'").get().count;
    const completedGoals = db.prepare("SELECT COUNT(*) as count FROM goals WHERE status = 'Completed'").get().count;
    
    const goalTrend = db.prepare(`
      SELECT strftime('%Y-%m', completed_at) as month, COUNT(*) as count
      FROM goals 
      WHERE status = 'Completed' AND completed_at IS NOT NULL AND ${getCompletedAtFilter(d)}
      GROUP BY month ORDER BY month
    `).all();

    res.json({
      metrics: {
        activeGoals,
        completedGoals
      },
      charts: {
        goalTrend
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/productivity', (req, res) => {
  try {
    const d = req.query.days;
    
    const totalCompleted = db.prepare(`SELECT COUNT(*) as count FROM checklist_items WHERE completed = 1 AND ${getCompletedAtFilter(d)}`).get().count;
    
    const dailyTrend = db.prepare(`
      SELECT date(completed_at) as date, COUNT(*) as tasks
      FROM checklist_items 
      WHERE completed = 1 AND completed_at IS NOT NULL AND ${getCompletedAtFilter(d)}
      GROUP BY date ORDER BY date
    `).all();

    res.json({
      metrics: {
        totalCompletedTasks: totalCompleted
      },
      charts: {
        dailyTrend
      }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed' });
  }
});

router.get('/insights', (req, res) => {
  try {
    const d = req.query.days;
    const insights = [];

    // Most active skill
    const skillActivity = db.prepare(`
      SELECT s.name, SUM(ls.duration_minutes) as mins 
      FROM learning_sessions ls JOIN skills s ON ls.skill_id = s.id 
      WHERE ${getSessionDateFilter(d)}
      GROUP BY s.id ORDER BY mins DESC LIMIT 1
    `).get();
    if (skillActivity) insights.push(`You spent the most time learning ${skillActivity.name} (${Math.round(skillActivity.mins/60)} hours).`);

    // Most active project (by tasks)
    const projectActivity = db.prepare(`
      SELECT p.name, COUNT(*) as tasks
      FROM checklist_items ci 
      JOIN project_checklists pc ON ci.checklist_id = pc.checklist_id
      JOIN projects p ON pc.project_id = p.id
      WHERE ci.completed = 1 AND ${getCompletedAtFilter(d, 'ci')}
      GROUP BY p.id ORDER BY tasks DESC LIMIT 1
    `).get();
    if (projectActivity) insights.push(`Your most active project is ${projectActivity.name} with ${projectActivity.tasks} tasks completed.`);

    // Weight
    const wStart = db.prepare(`SELECT weight FROM body_metrics WHERE ${getMeasurementDateFilter(d)} ORDER BY measurement_date ASC LIMIT 1`).get();
    const wEnd = db.prepare(`SELECT weight FROM body_metrics WHERE ${getMeasurementDateFilter(d)} ORDER BY measurement_date DESC LIMIT 1`).get();
    if (wStart && wEnd && wStart.weight !== wEnd.weight) {
      const diff = (wEnd.weight - wStart.weight).toFixed(1);
      insights.push(`Your weight changed by ${diff > 0 ? '+' : ''}${diff}kg in this period.`);
    }

    res.json(insights);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed' });
  }
});

module.exports = router;
