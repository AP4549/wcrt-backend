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

module.exports = router;
