const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

router.get('/', (req, res) => {
  try {
    const q = req.query.q;
    if (!q) return res.json({ skills: [], projects: [], goals: [], recipes: [], checklist_items: [] });

    const likeQ = `%${q}%`;
    
    // Search Skills
    const skills = db.prepare(`SELECT id, name, status, 'Skill' as type FROM skills WHERE name LIKE ? OR why_learning LIKE ? LIMIT 5`).all(likeQ, likeQ);
    
    // Search Projects
    const projects = db.prepare(`SELECT id, name, status, 'Project' as type FROM projects WHERE name LIKE ? OR description LIKE ? LIMIT 5`).all(likeQ, likeQ);
    
    // Search Goals
    const goals = db.prepare(`SELECT id, title as name, status, 'Goal' as type FROM goals WHERE title LIKE ? OR description LIKE ? LIMIT 5`).all(likeQ, likeQ);
    
    // Search Recipes
    const recipes = db.prepare(`SELECT id, name, 'Recipe' as type FROM recipes WHERE name LIKE ? LIMIT 5`).all(likeQ);
    
    // Search Checklist Items
    const checklist_items = db.prepare(`SELECT id, title as name, completed, 'Task' as type FROM checklist_items WHERE title LIKE ? LIMIT 10`).all(likeQ);

    res.json({
      skills,
      projects,
      goals,
      recipes,
      checklist_items
    });
  } catch (error) {
    console.error('Search failed:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

module.exports = router;
