const express = require('express');
const serverless = require('serverless-http');
require('dotenv').config();

const adminRoutes = require('./src/routes/admin');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/admin', adminRoutes);

app.get('/', (req, res) => {
  res.status(200).json({ status: 'Backend is running' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK' });
});

module.exports.handler = serverless(app);
