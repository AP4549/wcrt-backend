const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');
const verifyToken = require('../middleware/verifyToken');

const TABLE_NAME = process.env.WRITER_TABLE || 'wcrt-writers';;

router.get('/', verifyToken, async (req, res) => {
    const params = {
      TableName: TABLE_NAME
    };
  
    try {
      const data = await dynamo.scan(params).promise();
      res.status(200).json({ writers: data.Items });
    } catch (err) {
      console.error('Error fetching writers:', err);
      res.status(500).json({ error: 'Failed to fetch writers' });
    }
  });
  

module.exports = router;
