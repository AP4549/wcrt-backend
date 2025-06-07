const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');
const verifyToken = require('../middleware/verifyToken');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const TABLE_NAME = process.env.WRITER_TABLE || 'wcrt-writers';

// GET all writers (protected route)
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

// POST create writer (protected route - only admins can create writers)
router.post('/', verifyToken, async (req, res) => {
    try {
        let formData;

        if (Buffer.isBuffer(req.body)) {
            formData = JSON.parse(req.body.toString());
        } else if (typeof req.body === 'object') {
            formData = req.body;
        } else {
            return res.status(400).json({ error: 'Invalid request body format' });
        }

        console.log('Create writer - Request body:', formData);
        console.log('Create writer - Auth header:', req.headers.authorization);

        const { writerName, writerPassword, fullName, email, categories } = formData;

        if (!writerName || !writerPassword || !fullName || !email) {
            return res.status(400).json({
                status: 'error',
                error: 'Missing required fields',
                details: {
                    writerName: !writerName ? 'Missing writer name' : null,
                    writerPassword: !writerPassword ? 'Missing writer password' : null,
                    fullName: !fullName ? 'Missing full name' : null,
                    email: !email ? 'Missing email' : null
                }
            });
        }

        // Validate categories (optional but good)
        if (categories && !Array.isArray(categories)) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid categories format. It should be an array of strings.'
            });
        }

        // Check if writer already exists
        const existingWriter = await dynamo.scan({
            TableName: TABLE_NAME,
            FilterExpression: 'writerName = :writerName',
            ExpressionAttributeValues: {
                ':writerName': writerName
            }
        }).promise();

        if (existingWriter.Items.length > 0) {
            return res.status(409).json({
                status: 'error',
                error: 'Writer already exists'
            });
        }

        const writer = {
            writerName,
            writerPassword,
            fullName,
            email,
            categories: categories || [], // Save categories
            createdAt: new Date().toISOString()
        };

        await dynamo.put({
            TableName: TABLE_NAME,
            Item: writer
        }).promise();

        const { writerPassword: _, ...safeWriterData } = writer;

        res.status(201).json({
            status: 'success',
            message: 'Writer created successfully',
            data: safeWriterData
        });
    } catch (error) {
        console.error('Error creating writer:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to create writer'
        });
    }
});

// POST writer login
router.post('/login', async (req, res) => {
    try {
        let formData;
        
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
            return res.status(400).json({ error: 'Invalid request body format' });
        }

        console.log('Login request body:', formData); // Debug log
        const { writerName, writerPassword } = formData;

        if (!writerName || !writerPassword) {
            console.log('Missing fields - writerName:', writerName, 'writerPassword:', writerPassword); // Debug log
            return res.status(400).json({
                status: 'error',
                error: 'Writer name and password are required',
                details: {
                    writerName: !writerName ? 'Missing writer name' : null,
                    writerPassword: !writerPassword ? 'Missing writer password' : null
                }
            });
        }

        // Check writer credentials
        const params = {
            TableName: TABLE_NAME,
            FilterExpression: 'writerName = :writerName AND writerPassword = :writerPassword',
            ExpressionAttributeValues: {
                ':writerName': writerName,
                ':writerPassword': writerPassword
            }
        };

        const data = await dynamo.scan(params).promise();

        if (data.Items.length === 1) {
            const writer = data.Items[0];
            const { writerPassword, ...safeWriterData } = writer;            // Generate JWT token
            const token = jwt.sign(
                { writerName: writer.writerName },
                process.env.JWT_SECRET,
                { expiresIn: '2h' }
            );

            res.status(200).json({
                status: 'success',
                message: 'Login successful',
                token,
                data: safeWriterData
            });
        } else {
            res.status(401).json({
                status: 'error',
                error: 'Invalid credentials',
                message: 'The provided writer name or password is incorrect'
            });
        }
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            status: 'error',
            error: 'Internal server error',
            message: 'An unexpected error occurred while processing your request'
        });
    }
});

// DELETE writer (protected route)
router.delete('/:writerName', verifyToken, async (req, res) => {
    try {
        const { writerName } = req.params;

        // Check if writer exists
        const writer = await dynamo.get({
            TableName: TABLE_NAME,
            Key: { writerName }
        }).promise();

        if (!writer.Item) {
            return res.status(404).json({
                status: 'error',
                error: 'Writer not found'
            });
        }

        await dynamo.delete({
            TableName: TABLE_NAME,
            Key: { writerName }
        }).promise();

        res.status(200).json({
            status: 'success',
            message: 'Writer deleted successfully'
        });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to delete writer'
        });
    }
});

module.exports = router;
