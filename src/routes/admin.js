const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const verifyToken = require('../middleware/verifyToken');

const TABLE_NAME = process.env.ADMIN_TABLE || 'wcrt-admin'; // use env var fallback

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
    // Parse request body
    if (Buffer.isBuffer(req.body)) {
      formData = JSON.parse(req.body.toString());
    } else if (typeof req.body === 'object') {
      formData = req.body;
    } else {
      return res.status(400).json({
        status: 'error',
        error: 'Invalid request body format'
      });
    }

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
      const admin = data.Items[0];
      const { adminPassword, ...safeAdminData } = admin;

      // Generate JWT token
      const token = jwt.sign(
        { adminId: admin.id, adminUserName: admin.adminUserName },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
      );

      res.status(200).json({
        status: 'success',
        message: 'Login successful',
        token, // send token here
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

const verifyToken = require('../middleware/verifyToken');

// Protected route
router.get('/protected', verifyToken, (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'You have accessed a protected route',
    admin: req.admin, // Decoded token data
  });
});

// Protected route
router.get('/protected', verifyToken, (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'You have accessed a protected route',
    admin: req.admin, // Decoded token data
  });
});



module.exports = router;
