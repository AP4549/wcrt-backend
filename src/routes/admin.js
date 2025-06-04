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
  let formData;
  
  try {
    // Handle case where body is Buffer
    if (Buffer.isBuffer(req.body)) {
      formData = JSON.parse(req.body.toString());
    } 
    // Handle case where body is already parsed
    else if (typeof req.body === 'object') {
      formData = req.body;
    }
    // Handle invalid cases
    else {
      return res.status(400).json({ 
        status: 'error',
        error: 'Invalid request body format' 
      });
    }

    console.log('Processing login request:', {
      hasUsername: !!formData.adminUserName,
      hasPassword: !!formData.adminPassword
    });
    
    // Validate required fields
    const { adminUserName, adminPassword } = formData;
    if (!adminUserName || !adminPassword) {
      return res.status(400).json({ 
        status: 'error',
        error: 'Username and password are required',
        details: {
          username: !adminUserName ? 'Missing username' : null,
          password: !adminPassword ? 'Missing password' : null
        }
      });
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: 'adminUserName = :username AND adminPassword = :password',
      ExpressionAttributeValues: {
        ':username': adminUserName,
        ':password': adminPassword,
      },
    };

    const data = await dynamo.scan(params).promise();

    if (data.Items.length === 1) {
      // Successful login
      const admin = data.Items[0];
      // Don't send password back in response
      const { adminPassword, ...safeAdminData } = admin;
      
      res.status(200).json({
        status: 'success',
        message: 'Login successful',
        data: safeAdminData
      });
    } else {
      res.status(401).json({ 
        status: 'error',
        error: 'Invalid credentials',
        message: 'The provided username or password is incorrect'
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      status: 'error',
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing your request',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
