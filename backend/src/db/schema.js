const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath, { verbose: console.log });

// Enable foreign keys
db.pragma('foreign_keys = ON');

const initDb = () => {
  const schema = `
    -- Core Tables
    CREATE TABLE IF NOT EXISTS user_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      display_name TEXT DEFAULT 'User',
      timezone TEXT DEFAULT 'UTC',
      date_format TEXT DEFAULT 'DD/MM/YYYY',
      time_format TEXT DEFAULT '24 Hour',
      
      default_dashboard_view TEXT DEFAULT 'Today',
      default_sort_order TEXT DEFAULT 'Priority First',
      default_landing_page TEXT DEFAULT 'Dashboard',
      queue_config TEXT DEFAULT '{}',
      
      theme TEXT DEFAULT 'Architectural Brutalism',
      density TEXT DEFAULT 'Comfortable',
      sidebar_state TEXT DEFAULT 'Expanded',
      animations TEXT DEFAULT 'Enabled',
      
      calorie_target INTEGER DEFAULT 2200,
      protein_target INTEGER DEFAULT 150,
      carbs_target INTEGER DEFAULT 250,
      fat_target INTEGER DEFAULT 70,
      fiber_target INTEGER DEFAULT 30,
      water_target REAL DEFAULT 3.0,
      body_metrics_prefs TEXT DEFAULT '{}',
      
      weekly_workout_target INTEGER DEFAULT 4,
      preferred_workout_template TEXT DEFAULT 'Push Pull Legs',
      strength_tracking_enabled BOOLEAN DEFAULT 1,
      
      default_skill_status TEXT DEFAULT 'Wishlist',
      default_skill_schedule TEXT DEFAULT 'Flexible',
      auto_complete_skills BOOLEAN DEFAULT 0,
      
      default_project_status TEXT DEFAULT 'Idea',
      default_project_schedule TEXT DEFAULT 'Flexible',
      auto_portfolio_project BOOLEAN DEFAULT 0,
      
      default_goal_type TEXT DEFAULT 'Milestone',
      default_goal_status TEXT DEFAULT 'Planned',
      default_goal_progress_mode TEXT DEFAULT 'Checklist',
      
      reminder_times TEXT DEFAULT '{}',
      deadline_alerts_enabled BOOLEAN DEFAULT 1,
      
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS life_areas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      status TEXT DEFAULT 'Wishlist',
      priority TEXT,
      schedule_type TEXT DEFAULT 'Flexible',
      target_date DATE,
      life_area_id INTEGER,
      why_learning TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (life_area_id) REFERENCES life_areas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      status TEXT DEFAULT 'Idea',
      priority TEXT,
      schedule_type TEXT DEFAULT 'Flexible',
      target_date DATE,
      life_area_id INTEGER,
      github_url TEXT,
      demo_url TEXT,
      portfolio_project BOOLEAN DEFAULT 0,
      difficulty TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (life_area_id) REFERENCES life_areas(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      goal_type TEXT,
      category TEXT,
      status TEXT DEFAULT 'Planned',
      priority TEXT,
      schedule_type TEXT DEFAULT 'Flexible',
      target_date DATE,
      life_area_id INTEGER,
      notes TEXT,
      progress_mode TEXT DEFAULT 'Checklist',
      manual_progress INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (life_area_id) REFERENCES life_areas(id) ON DELETE SET NULL
    );

    -- Goal Relationships
    CREATE TABLE IF NOT EXISTS goal_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      UNIQUE(goal_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS goal_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      project_id INTEGER NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE(goal_id, project_id)
    );

    -- Project Skills
    CREATE TABLE IF NOT EXISTS project_skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      skill_id INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      UNIQUE(project_id, skill_id)
    );

    CREATE TABLE IF NOT EXISTS project_milestones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      due_date DATE,
      completed BOOLEAN DEFAULT 0,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    -- Learning Sessions
    CREATE TABLE IF NOT EXISTS learning_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      duration_minutes INTEGER NOT NULL,
      session_date DATE NOT NULL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
    );

    -- Checklists System
    CREATE TABLE IF NOT EXISTS checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS checklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      checklist_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      completed BOOLEAN DEFAULT 0,
      scheduled_date DATE,
      scheduled_time TIME,
      completed_at DATETIME,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE
    );

    -- Specific Checklist Relationships (Fixing the polymorphic issue)
    CREATE TABLE IF NOT EXISTS skill_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      skill_id INTEGER NOT NULL,
      checklist_id INTEGER NOT NULL,
      FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
      FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE,
      UNIQUE(skill_id, checklist_id)
    );

    CREATE TABLE IF NOT EXISTS project_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      checklist_id INTEGER NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE,
      UNIQUE(project_id, checklist_id)
    );

    CREATE TABLE IF NOT EXISTS goal_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      checklist_id INTEGER NOT NULL,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
      FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE,
      UNIQUE(goal_id, checklist_id)
    );

    CREATE TABLE IF NOT EXISTS goal_targets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id INTEGER NOT NULL,
      target_type TEXT NOT NULL, -- e.g., 'weight', 'body_fat', 'calories', 'protein', 'workouts_per_week'
      target_value REAL NOT NULL,
      current_value REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workout_checklists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_log_id INTEGER NOT NULL,
      checklist_id INTEGER NOT NULL,
      FOREIGN KEY (workout_log_id) REFERENCES workout_logs(id) ON DELETE CASCADE,
      FOREIGN KEY (checklist_id) REFERENCES checklists(id) ON DELETE CASCADE,
      UNIQUE(workout_log_id, checklist_id)
    );

    -- Health & Nutrition
    CREATE TABLE IF NOT EXISTS nutrition_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      log_date DATE NOT NULL UNIQUE,
      calories INTEGER DEFAULT 0,
      protein INTEGER DEFAULT 0,
      carbs INTEGER DEFAULT 0,
      fat INTEGER DEFAULT 0,
      fiber INTEGER DEFAULT 0,
      water REAL DEFAULT 0.0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      ingredients TEXT,
      instructions TEXT,
      calories INTEGER DEFAULT 0,
      protein INTEGER DEFAULT 0,
      carbs INTEGER DEFAULT 0,
      fat INTEGER DEFAULT 0,
      fiber INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recipe_tags (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      recipe_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS body_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      measurement_date DATE NOT NULL UNIQUE,
      weight REAL,
      body_fat REAL,
      waist REAL,
      chest REAL,
      arms REAL,
      thighs REAL,
      neck REAL,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Fitness
    -- Fitness Redesign Schema
    CREATE TABLE IF NOT EXISTS workout_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      active BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS workout_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      repeat_day TEXT NOT NULL,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS exercises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_day_id INTEGER NOT NULL,
      exercise_name TEXT NOT NULL,
      exercise_type TEXT NOT NULL, -- 'Weight', 'Distance', 'Duration'
      sets INTEGER,
      target_weight REAL,
      target_reps INTEGER,
      target_distance REAL,
      target_duration INTEGER,
      notes TEXT,
      display_order INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workout_day_id) REFERENCES workout_days(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS workout_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER,
      workout_day_id INTEGER,
      session_date DATE NOT NULL,
      started_at DATETIME,
      completed_at DATETIME,
      notes TEXT,
      FOREIGN KEY (template_id) REFERENCES workout_templates(id) ON DELETE SET NULL,
      FOREIGN KEY (workout_day_id) REFERENCES workout_days(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS exercise_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workout_session_id INTEGER NOT NULL,
      exercise_name TEXT NOT NULL,
      exercise_type TEXT NOT NULL,
      weight REAL,
      reps INTEGER,
      sets INTEGER,
      distance REAL,
      duration INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (workout_session_id) REFERENCES workout_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS personal_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exercise_name TEXT NOT NULL UNIQUE,
      exercise_type TEXT NOT NULL,
      best_weight REAL,
      best_reps INTEGER,
      best_distance REAL,
      best_duration INTEGER,
      best_volume REAL,
      date_achieved DATE
    );

    CREATE TABLE IF NOT EXISTS exercise_dictionary (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      category TEXT,
      is_favorite BOOLEAN DEFAULT 0
    );

    -- Notifications & Activity
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      message TEXT,
      notification_type TEXT,
      scheduled_time DATETIME,
      completed BOOLEAN DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS activity_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_checklist_items_dashboard ON checklist_items(completed, scheduled_date, scheduled_time);
    CREATE INDEX IF NOT EXISTS idx_skills_life_area ON skills(life_area_id);
    CREATE INDEX IF NOT EXISTS idx_projects_life_area ON projects(life_area_id);
    CREATE INDEX IF NOT EXISTS idx_goals_life_area ON goals(life_area_id);
    CREATE INDEX IF NOT EXISTS idx_learning_sessions_date ON learning_sessions(session_date);
    CREATE INDEX IF NOT EXISTS idx_nutrition_logs_date ON nutrition_logs(log_date);
    CREATE INDEX IF NOT EXISTS idx_workout_sessions_date ON workout_sessions(session_date);
    CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at);
  `;

  db.exec(schema);
  console.log("Database initialized successfully.");
  
  // Seed initial life areas if empty
  const count = db.prepare('SELECT COUNT(*) as count FROM life_areas').get();
  if (count.count === 0) {
    const insert = db.prepare('INSERT INTO life_areas (name) VALUES (?)');
    const areas = ['Career', 'Learning', 'Health', 'Fitness', 'Finance', 'Personal', 'Relationships', 'Creative', 'Custom'];
    
    db.transaction(() => {
      for (const area of areas) insert.run(area);
    })();
    console.log("Default life areas seeded.");
  }

  // Seed default user settings
  const settingsCount = db.prepare('SELECT COUNT(*) as count FROM user_settings').get();
  if (settingsCount.count === 0) {
    db.prepare("INSERT INTO user_settings (id, display_name) VALUES (1, 'User')").run();
    console.log("Default user settings seeded.");
  }
};

module.exports = { db, initDb };
