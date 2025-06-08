const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const TABLE_NAME = process.env.ADMIN_TABLE || 'wcrt-admin';

// POST admin login
router.post('/login', async (req, res) => {
  let formData;

  try {
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
        error: 'Username and password are required'
      });
    }

    const params = {
      TableName: TABLE_NAME,
      FilterExpression: 'adminUserName = :username AND adminPassword = :password',
      ExpressionAttributeValues: {
        ':username': adminUserName,
        ':password': adminPassword
      }
    };

    const data = await dynamo.scan(params).promise();

    if (data.Items.length === 1) {
      const admin = data.Items[0];
      const { adminPassword, ...safeAdminData } = admin;

      const token = jwt.sign(
        {
          adminId: admin.id,
          adminUserName: admin.adminUserName,
          role: 'admin' // ✅ include role here
        },
        process.env.JWT_SECRET,
        { expiresIn: '2h' }
      );

      res.status(200).json({
        status: 'success',
        message: 'Login successful',
        token,
        data: safeAdminData
      });
    } else {
      res.status(401).json({
        status: 'error',
        error: 'Invalid credentials'
      });
    }

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      status: 'error',
      error: 'Internal server error'
    });
  }
});


module.exports = router;
