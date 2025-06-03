const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');

const TABLE_NAME = 'wcrt-admin';

// GET all admins
router.get('/', async (req, res) => {
  const params = {
    TableName: TABLE_NAME,
  };

  try {
    const data = await dynamo.scan(params).promise();
    res.json({ admins: data.Items });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({ error: 'Could not fetch admins' });
  }
});

// POST admin login
router.post('/login', async (req, res) => {
  let body = req.body;
  
  // Handle case where body is a buffer
  if (Buffer.isBuffer(req.body)) {
    try {
      body = JSON.parse(req.body.toString());
    } catch (e) {
      console.error('Error parsing body buffer:', e);
      return res.status(400).json({ error: 'Invalid JSON in request body' });
    }
  }
  
  console.log('Parsed body:', body);
  
  const { adminUserName, adminPassword } = body;

  if (!adminUserName || !adminPassword) {
    console.log('Missing credentials - adminUserName:', !!adminUserName, 'adminPassword:', !!adminPassword);
    return res.status(400).json({ error: 'Username and password required' });
  }

  const params = {
    TableName: TABLE_NAME,
    FilterExpression: 'adminUserName = :username AND adminPassword = :password',
    ExpressionAttributeValues: {
      ':username': adminUserName,
      ':password': adminPassword,
    },
  };

  try {
    const data = await dynamo.scan(params).promise();

    if (data.Items.length === 1) {
      res.json({ message: 'Login successful', admin: data.Items[0] });
    } else {
      res.status(401).json({ error: 'Invalid username or password' });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
