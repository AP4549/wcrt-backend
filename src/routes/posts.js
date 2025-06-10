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
            // authorImage,
            authorName,  // Changed from writerName to authorName
            category
        } = formData;
        const authorImage = formData.authorImage || 'https://wcrt-content-images.s3.eu-north-1.amazonaws.com/author.png';

        if (!title || !content || !imageUrl || !authorName || !category) {
            return res.status(400).json({
                status: 'error',
                error: 'Missing required fields',
                details: {
                    title: !title ? 'Missing title' : null,
                    content: !content ? 'Missing content' : null,
                    imageUrl: !imageUrl ? 'Missing image URL' : null,
                    // authorImage: !authorImage ? 'Missing author image URL' : null,
                    authorName: !authorName ? 'Missing author name' : null,
                    category: !category ? 'Missing category' : null
                }
            });
        }

        const post = {
            postId: uuidv4(),
            title,
            content,
            imageUrl,
            authorImage,
            authorName, 
            writerName: req.user.writerName, 
            category,
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

// In your /s3/upload-url endpoint:
router.get('/s3/upload-url', verifyToken, verifyWriter, async (req, res) => {
    const { fileName, fileType } = req.query;
  
    // Validate inputs
    if (!fileName || !fileType) {
      return res.status(400).json({ error: 'Missing fileName or fileType' });
    }
  
    const validTypes = ['image/jpeg', 'image/png', 'image/gif'];
    if (!validTypes.includes(fileType)) {
      return res.status(400).json({ error: 'Invalid file type' });
    }
  
    // Configure S3 parameters
    const s3Params = {
      Bucket: process.env.S3_BUCKET,
      Key: `uploads/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9.]/g, '-')}`, // Sanitize filename
      ContentType: fileType,
      Expires: 60 * 5, // 5 minutes
      // Remove ACL if your bucket has strict policies
    };
  
    try {
      const uploadURL = await s3.getSignedUrlPromise('putObject', s3Params);
      const publicUrl = `https://${s3Params.Bucket}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Params.Key}`;
      
      res.status(200).json({
        uploadURL,
        publicUrl,
        key: s3Params.Key // For debugging
      });
    } catch (err) {
      console.error('S3 URL generation error:', err);
      res.status(500).json({ 
        error: 'Failed to generate upload URL',
        details: err.message 
      });
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

// GET all posts with post_status = 'open'
router.get('/status/open', async (req, res) => {
    const params = {
        TableName: TABLE_NAME,
        FilterExpression: 'post_status = :openStatus',
        ExpressionAttributeValues: {
            ':openStatus': 'open'
        }
    };

    try {
        const data = await dynamo.scan(params).promise();

        res.status(200).json({
            status: 'success',
            posts: data.Items
        });
    } catch (error) {
        console.error('Error fetching open posts:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch open posts'
        });
    }
});


router.patch('/:postId/status', verifyToken, verifyAdmin, async (req, res) => {
    const { postId } = req.params;

    // Handle Buffer body
    let post_status;
    if (Buffer.isBuffer(req.body)) {
        try {
            const parsed = JSON.parse(req.body.toString());
            post_status = parsed.post_status;
        } catch (err) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid JSON body'
            });
        }
    } else {
        post_status = req.body.post_status;
    }

    // Validate post_status
    if (!post_status || !['open', 'approved', 'rejected'].includes(post_status)) {
        return res.status(400).json({
            status: 'error',
            error: 'Invalid or missing post_status. Must be one of: open, approved, rejected.'
        });
    }

    const params = {
        TableName: TABLE_NAME,
        Key: { postId },
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
