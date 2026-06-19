require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db/schema');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Serve static frontend files
const path = require('path');
app.use(express.static(path.join(__dirname, '../../frontend')));

app.get('/', (req, res) => {
  res.redirect('/dashboard.html');
});

// Initialize the database
initDb();

// Routes
const dashboardRoutes = require('./routes/dashboard');
const skillsRoutes = require('./routes/skills');
const projectsRoutes = require('./routes/projects');
const healthRoutes = require('./routes/health');
const fitnessRoutes = require('./routes/fitness');
const goalsRoutes = require('./routes/goals');
const analyticsRoutes = require('./routes/analytics');
const settingsRoutes = require('./routes/settings');
const searchRoutes = require('./routes/search');

app.use('/api/dashboard', dashboardRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/projects', projectsRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/fitness', fitnessRoutes);
app.use('/api/goals', goalsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/search', searchRoutes);

// Basic health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', message: 'Personal OS Backend Running' });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
