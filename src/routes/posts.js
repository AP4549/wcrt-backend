const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');
const verifyToken = require('../middleware/verifyToken');
const verifyAdmin = require('../middleware/verifyAdmin');
const verifyWriter = require('../middleware/verifyWriter');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

const TABLE_NAME = process.env.POSTS_TABLE || 'wcrt-posts';

router.post('/', verifyToken, verifyWriter, async (req, res) => {
    try {
        let formData;

        if (Buffer.isBuffer(req.body)) {
            formData = JSON.parse(req.body.toString());
        } else if (typeof req.body === 'object') {
            formData = req.body;
        } else {
            return res.status(400).json({ error: 'Invalid request body format' });
        }

        const {
            title,
            content,
            imageUrl,
            authorImage,
            category
        } = formData;

        if (!title || !content || !imageUrl || !authorImage || !category) {
            return res.status(400).json({
                status: 'error',
                error: 'Missing required fields',
                details: {
                    title: !title ? 'Missing title' : null,
                    content: !content ? 'Missing content' : null,
                    imageUrl: !imageUrl ? 'Missing image URL' : null,
                    authorImage: !authorImage ? 'Missing author image URL' : null,
                    category: !category ? 'Missing category' : null
                }
            });
        }

        const writerName = req.user?.writerName;

        const post = {
            postId: uuidv4(),
            title,
            content,
            imageUrl,
            authorImage,
            category,
            writerName,
            uploadDate: new Date().toISOString(),
            viewCount: 0,
            post_status: 'open'
        };

        await dynamo.put({
            TableName: TABLE_NAME,
            Item: post
        }).promise();

        res.status(201).json({
            status: 'success',
            message: 'Post created successfully',
            data: post
        });

    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).json({
            status: 'error',
            error: 'Internal server error'
        });
    }
});

router.get('/s3/upload-url', verifyToken, verifyWriter, async (req, res) => {
    const { fileName, fileType } = req.query;
  
    const params = {
      Bucket: process.env.S3_BUCKET,
      Key: fileName,
      ContentType: fileType,
      Expires: 60, // 1 minute
      ACL: 'public-read' // or private
    };
  
    try {
      const uploadURL = await s3.getSignedUrlPromise('putObject', params);
      res.status(200).json({ uploadURL });
    } catch (err) {
      console.error('Error creating S3 presigned URL', err);
      res.status(500).json({ error: 'Failed to get S3 upload URL' });
    }
  });

// GET all posts (no auth)
router.get('/', async (req, res) => {
    try {
        const params = {
            TableName: TABLE_NAME
        };

        const data = await dynamo.scan(params).promise();

        res.status(200).json({
            status: 'success',
            posts: data.Items
        });
    } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch posts'
        });
    }
});

// GET posts by category (no auth)
router.get('/category/:categoryName', async (req, res) => {
    const { categoryName } = req.params;

    const params = {
        TableName: TABLE_NAME,
        FilterExpression: '#cat = :categoryVal',
        ExpressionAttributeNames: {
            '#cat': 'category'
        },
        ExpressionAttributeValues: {
            ':categoryVal': categoryName
        }
    };

    try {
        const data = await dynamo.scan(params).promise();

        res.status(200).json({
            status: 'success',
            category: categoryName,
            posts: data.Items
        });
    } catch (error) {
        console.error('Error fetching posts by category:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch posts by category'
        });
    }
});

router.patch('/:postId/status', verifyToken, verifyAdmin, async (req, res) => {
    const { postId } = req.params;
    const { post_status } = req.body;

    if (!post_status || !['open', 'approved', 'rejected'].includes(post_status)) {
        return res.status(400).json({
            status: 'error',
            error: 'Invalid or missing post_status. Must be one of: open, approved, rejected.'
        });
    }

    const params = {
        TableName: TABLE_NAME,
        Key: {
            postId
        },
        UpdateExpression: 'SET post_status = :status',
        ExpressionAttributeValues: {
            ':status': post_status
        },
        ReturnValues: 'ALL_NEW'
    };

    try {
        const result = await dynamo.update(params).promise();
        res.status(200).json({
            status: 'success',
            message: `Post status updated to ${post_status}`,
            updatedPost: result.Attributes
        });
    } catch (error) {
        console.error('Error updating post status:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to update post status'
        });
    }
});


module.exports = router;
