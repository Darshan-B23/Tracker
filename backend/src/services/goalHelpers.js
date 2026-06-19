const { db } = require('../db/schema');

function checkAndCompleteParents(goal_id, parent_id) {
  if (!parent_id) return;
  const children = db.prepare("SELECT completed FROM goal_nodes WHERE parent_id = ?").all(parent_id);
  if (children.length === 0) return;
  const allCompleted = children.every(c => c.completed === 1);
  const parent = db.prepare("SELECT completed, parent_id FROM goal_nodes WHERE id = ?").get(parent_id);
  
  if (allCompleted && parent && !parent.completed) {
     db.prepare("UPDATE goal_nodes SET completed = 1, completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(parent_id);
     checkAndCompleteParents(goal_id, parent.parent_id);
  }
}

function checkGoalCompletion(goal_id) {
  const allNodes = db.prepare("SELECT id, parent_id, completed FROM goal_nodes WHERE goal_id = ?").all(goal_id);
  const parentIds = new Set(allNodes.map(n => n.parent_id).filter(pid => pid !== null));
  const leafNodes = allNodes.filter(n => !parentIds.has(n.id));
  const allLeafsCompleted = leafNodes.length > 0 && leafNodes.every(n => n.completed === 1);

  if (allLeafsCompleted) {
    const goal = db.prepare("SELECT status FROM goals WHERE id = ?").get(goal_id);
    if (goal && goal.status !== 'Completed') {
      db.prepare("UPDATE goals SET status = 'Completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(goal_id);
      db.prepare("INSERT INTO activity_logs (entity_type, entity_id, action, description) VALUES ('goal', ?, 'Goal Completed', ?)").run(goal_id, 'All leaf tasks completed automatically.');
    }
  }
}

module.exports = {
  checkAndCompleteParents,
  checkGoalCompletion
};
