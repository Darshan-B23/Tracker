const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../../database.sqlite');
const db = new Database(dbPath, { verbose: console.log });

console.log("Starting Goal Migration...");

// 1. Ensure new table exists
db.exec(`
  CREATE TABLE IF NOT EXISTS goal_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    parent_id INTEGER,
    title TEXT NOT NULL,
    description TEXT,
    completed BOOLEAN DEFAULT 0,
    completed_at DATETIME,
    unchecked_at DATETIME,
    skill_id INTEGER,
    project_id INTEGER,
    display_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES goal_nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE SET NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
  );
`);

console.log("Created goal_nodes table.");

// 2. Migrate data
try {
  db.transaction(() => {
    // Get all goal checklists
    const checklists = db.prepare(`
      SELECT gc.goal_id, c.id as checklist_id, c.title as checklist_title, c.created_at
      FROM goal_checklists gc
      JOIN checklists c ON gc.checklist_id = c.id
    `).all();

    for (const cl of checklists) {
      // 1. Create top-level parent node for the checklist
      const insertParent = db.prepare(`
        INSERT INTO goal_nodes (goal_id, parent_id, title, created_at, updated_at)
        VALUES (?, NULL, ?, ?, ?)
      `).run(cl.goal_id, cl.checklist_title, cl.created_at, cl.created_at);

      const parentNodeId = insertParent.lastInsertRowid;

      // 2. Get all items for this checklist
      const items = db.prepare(`
        SELECT id, title, description, completed, completed_at, display_order, created_at, updated_at
        FROM checklist_items
        WHERE checklist_id = ?
      `).all(cl.checklist_id);

      let allCompleted = items.length > 0;

      for (const item of items) {
        if (!item.completed) allCompleted = false;

        db.prepare(`
          INSERT INTO goal_nodes (goal_id, parent_id, title, description, completed, completed_at, display_order, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          cl.goal_id,
          parentNodeId,
          item.title,
          item.description,
          item.completed ? 1 : 0,
          item.completed_at,
          item.display_order,
          item.created_at,
          item.updated_at
        );
      }

      // If all children completed, auto-complete parent
      if (allCompleted) {
        db.prepare(`UPDATE goal_nodes SET completed = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(parentNodeId);
      }
    }

    console.log("Data migration to goal_nodes completed.");

    // Note: We are keeping the actual `goal_checklists` and `checklists` records for backup for now.
    // They could be deleted in the future if this system proves stable.
  })();
  console.log("Migration Successful!");
} catch (error) {
  console.error("Migration failed:", error);
}

db.close();
