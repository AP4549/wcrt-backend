const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');
const verifyToken = require('../middleware/verifyToken');
const { v4: uuidv4 } = require('uuid');
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

const TABLE_NAME = process.env.POSTS_TABLE || 'wcrt-posts';

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
            viewCount: 0
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

router.get('/s3/upload-url', verifyToken, async (req, res) => {
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

module.exports = router;
