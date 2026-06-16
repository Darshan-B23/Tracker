const express = require('express');
const { db } = require('../db/schema');
const router = express.Router();

// Get user health targets
router.get('/targets', (req, res) => {
  try {
    const settings = db.prepare('SELECT protein_target, calorie_target, water_target FROM user_settings LIMIT 1').get() 
      || { protein_target: 150, calorie_target: 2200, water_target: 3.0 };
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch targets' });
  }
});

// Update user health targets
router.put('/targets', (req, res) => {
  const { protein_target, calorie_target, water_target } = req.body;
  try {
    const count = db.prepare('SELECT COUNT(*) as count FROM user_settings').get().count;
    if (count === 0) {
      db.prepare(`
        INSERT INTO user_settings (protein_target, calorie_target, water_target)
        VALUES (?, ?, ?)
      `).run(protein_target, calorie_target, water_target);
    } else {
      db.prepare(`
        UPDATE user_settings
        SET protein_target = ?, calorie_target = ?, water_target = ?, updated_at = CURRENT_TIMESTAMP
      `).run(protein_target, calorie_target, water_target);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update targets' });
  }
});

// Get nutrition logs
router.get('/nutrition', (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    let query = 'SELECT * FROM nutrition_logs';
    let params = [];
    
    if (start_date && end_date) {
      query += ' WHERE log_date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    query += ' ORDER BY log_date DESC LIMIT 30';

    const logs = db.prepare(query).all(params);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch nutrition logs' });
  }
});

// Upsert nutrition log for a specific date
router.post('/nutrition', (req, res) => {
  const { log_date, calories, protein, carbs, fat, fiber, water, notes } = req.body;
  try {
    const dateToUse = log_date || new Date().toISOString().split('T')[0];
    
    db.prepare(`
      INSERT INTO nutrition_logs (log_date, calories, protein, carbs, fat, fiber, water, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(log_date) DO UPDATE SET
        calories = excluded.calories,
        protein = excluded.protein,
        carbs = excluded.carbs,
        fat = excluded.fat,
        fiber = excluded.fiber,
        water = excluded.water,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(dateToUse, calories || 0, protein || 0, carbs || 0, fat || 0, fiber || 0, water || 0, notes);
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save nutrition log' });
  }
});

// Get body metrics
router.get('/metrics', (req, res) => {
  try {
    const metrics = db.prepare('SELECT * FROM body_metrics ORDER BY measurement_date DESC LIMIT 30').all();
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch body metrics' });
  }
});

// Upsert body metrics
router.post('/metrics', (req, res) => {
  const { measurement_date, weight, body_fat, waist, chest, arms, thighs, neck, notes } = req.body;
  try {
    const dateToUse = measurement_date || new Date().toISOString().split('T')[0];
    
    db.prepare(`
      INSERT INTO body_metrics (measurement_date, weight, body_fat, waist, chest, arms, thighs, neck, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(measurement_date) DO UPDATE SET
        weight = excluded.weight,
        body_fat = excluded.body_fat,
        waist = excluded.waist,
        chest = excluded.chest,
        arms = excluded.arms,
        thighs = excluded.thighs,
        neck = excluded.neck,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
    `).run(dateToUse, weight || null, body_fat || null, waist || null, chest || null, arms || null, thighs || null, neck || null, notes);
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save body metrics' });
  }
});

// Get recipes
router.get('/recipes', (req, res) => {
  try {
    const recipes = db.prepare('SELECT * FROM recipes ORDER BY updated_at DESC').all();
    res.json(recipes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch recipes' });
  }
});

// Create recipe
router.post('/recipes', (req, res) => {
  const { name, description, ingredients, instructions, calories, protein, carbs, fat, fiber } = req.body;
  try {
    const result = db.prepare(`
      INSERT INTO recipes (name, description, ingredients, instructions, calories, protein, carbs, fat, fiber)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, description, ingredients, instructions, calories || 0, protein || 0, carbs || 0, fat || 0, fiber || 0);
    
    res.status(201).json({ id: result.lastInsertRowid });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create recipe' });
  }
});

module.exports = router;
