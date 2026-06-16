const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath, { verbose: console.log });

console.log("Starting Fitness System Migration...");

try {
  db.exec('BEGIN TRANSACTION');

  // 1. Rename old tables
  const tablesToRename = [
    { old: 'workout_templates', new: 'workout_templates_old' },
    { old: 'workout_logs', new: 'workout_logs_old' },
    { old: 'strength_logs', new: 'strength_logs_old' },
    { old: 'exercises', new: 'exercises_old' }
  ];

  for (const t of tablesToRename) {
    // Check if old table exists
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t.old);
    if (exists) {
      db.exec(`ALTER TABLE ${t.old} RENAME TO ${t.new}`);
    }
  }

  // 2. Create new schema tables
  const newSchema = `
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
  `;
  db.exec(newSchema);

  // 3. Migrate Exercise Dictionary
  const hasExercisesOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='exercises_old'").get();
  if (hasExercisesOld) {
    db.exec(`INSERT INTO exercise_dictionary (id, name, category, is_favorite) SELECT id, name, category, 0 FROM exercises_old`);
  }

  // 4. Migrate Templates
  const hasTemplatesOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workout_templates_old'").get();
  let firstTemplateId = null;
  if (hasTemplatesOld) {
    const oldTemplates = db.prepare('SELECT * FROM workout_templates_old').all();
    const insertTemplate = db.prepare('INSERT INTO workout_templates (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
    const insertDay = db.prepare('INSERT INTO workout_days (template_id, name, repeat_day) VALUES (?, ?, ?)');

    for (let i = 0; i < oldTemplates.length; i++) {
      const t = oldTemplates[i];
      if (i === 0) firstTemplateId = t.id; // We'll make the first one active
      insertTemplate.run(t.id, t.name, t.description, t.created_at, t.updated_at);

      const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      for (const d of days) {
        if (t[d] && t[d].trim() !== '') {
          const capitalizedDay = d.charAt(0).toUpperCase() + d.slice(1);
          insertDay.run(t.id, t[d].trim(), capitalizedDay);
        }
      }
    }
  }

  // Set the preferred_workout_template as active if possible, otherwise just pick one
  const userSettings = db.prepare("SELECT preferred_workout_template FROM user_settings LIMIT 1").get();
  if (userSettings && userSettings.preferred_workout_template) {
    db.prepare("UPDATE workout_templates SET active = 1 WHERE name = ?").run(userSettings.preferred_workout_template);
  } else if (firstTemplateId) {
    db.prepare("UPDATE workout_templates SET active = 1 WHERE id = ?").run(firstTemplateId);
  }

  // 5. Migrate Sessions (from old workout logs)
  const hasLogsOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workout_logs_old'").get();
  if (hasLogsOld) {
    const oldLogs = db.prepare('SELECT * FROM workout_logs_old').all();
    const insertSession = db.prepare(`
      INSERT INTO workout_sessions (id, template_id, session_date, completed_at, notes) 
      VALUES (?, ?, ?, ?, ?)
    `);
    
    for (const log of oldLogs) {
      const completedAt = log.completed ? (log.updated_at || log.created_at) : null;
      insertSession.run(log.id, log.workout_template_id, log.log_date, completedAt, log.notes);
    }
  }

  // 6. Migrate Strength Logs to Exercise Logs
  const hasStrengthOld = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='strength_logs_old'").get();
  if (hasStrengthOld) {
    const oldStrength = db.prepare(`
      SELECT sl.*, e.name as exercise_name 
      FROM strength_logs_old sl
      LEFT JOIN exercises_old e ON sl.exercise_id = e.id
    `).all();

    const insertExerciseLog = db.prepare(`
      INSERT INTO exercise_logs (workout_session_id, exercise_name, exercise_type, weight, reps, sets, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const findSession = db.prepare("SELECT id FROM workout_sessions WHERE session_date = ? LIMIT 1");
    const createGenericSession = db.prepare("INSERT INTO workout_sessions (session_date, notes) VALUES (?, 'Auto-generated for legacy strength logs')");

    for (const st of oldStrength) {
      let session = findSession.get(st.log_date);
      let sessionId;
      if (session) {
        sessionId = session.id;
      } else {
        const res = createGenericSession.run(st.log_date);
        sessionId = res.lastInsertRowid;
      }

      insertExerciseLog.run(
        sessionId,
        st.exercise_name || 'Unknown Exercise',
        'Weight',
        st.weight,
        st.reps,
        st.sets,
        st.created_at,
        st.updated_at
      );
    }
  }

  // 7. Calculate PRs
  const allLogs = db.prepare("SELECT exercise_name, weight, reps, distance, duration, s.session_date FROM exercise_logs el JOIN workout_sessions s ON el.workout_session_id = s.id").all();
  const prMap = {};

  for (const log of allLogs) {
    if (!prMap[log.exercise_name]) {
      prMap[log.exercise_name] = { weight: 0, reps: 0, distance: 0, duration: 0, date: log.session_date };
    }
    
    if (log.weight && log.weight > prMap[log.exercise_name].weight) {
      prMap[log.exercise_name].weight = log.weight;
      prMap[log.exercise_name].reps = log.reps;
      prMap[log.exercise_name].date = log.session_date;
    }
  }

  const insertPR = db.prepare("INSERT INTO personal_records (exercise_name, exercise_type, best_weight, best_reps, date_achieved) VALUES (?, ?, ?, ?, ?)");
  for (const [name, data] of Object.entries(prMap)) {
    if (data.weight > 0) {
      insertPR.run(name, 'Weight', data.weight, data.reps, data.date);
    }
  }

  db.exec('COMMIT');
  console.log("Migration completed successfully.");

} catch (error) {
  db.exec('ROLLBACK');
  console.error("Migration failed:", error);
}
