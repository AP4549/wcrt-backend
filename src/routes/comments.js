const express = require('express');
const router = express.Router();
const dynamo = require('../services/db');
const verifyToken = require('../middleware/verifyToken');
const verifyAdmin = require('../middleware/verifyAdmin');
const { v4: uuidv4 } = require('uuid');

const TABLE_NAME = process.env.COMMENTS_TABLE || 'wcrt-comments';

// POST create comment (no auth required - public)
router.post('/', async (req, res) => {
    try {
        let formData;

        if (Buffer.isBuffer(req.body)) {
            formData = JSON.parse(req.body.toString());
        } else if (typeof req.body === 'object') {
            formData = req.body;
        } else {
            return res.status(400).json({ error: 'Invalid request body format' });
        }

        const { postId, commenterName, commenterEmail, commentText, website } = formData;

        if (!postId || !commenterName || !commenterEmail || !commentText) {
            return res.status(400).json({
                status: 'error',
                error: 'Missing required fields',
                details: {
                    postId: !postId ? 'Missing post ID' : null,
                    commenterName: !commenterName ? 'Missing commenter name' : null,
                    commenterEmail: !commenterEmail ? 'Missing commenter email' : null,
                    commentText: !commentText ? 'Missing comment text' : null
                }
            });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(commenterEmail)) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid email format'
            });
        }

        const comment = {
            comment_ID: uuidv4(), // Using comment_ID as your primary key
            postId,
            commenterName,
            commenterEmail,
            commentText,
            website: website || '',
            commentStatus: 'pending', // pending, approved, rejected
            createdAt: new Date().toISOString()
        };

        await dynamo.put({
            TableName: TABLE_NAME,
            Item: comment
        }).promise();

        res.status(201).json({
            status: 'success',
            message: 'Comment submitted successfully. It will be visible after admin approval.',
            data: {
                comment_ID: comment.comment_ID,
                postId: comment.postId,
                commenterName: comment.commenterName,
                commentText: comment.commentText,
                createdAt: comment.createdAt,
                commentStatus: comment.commentStatus
            }
        });

    } catch (error) {
        console.error('Error creating comment:', error);
        res.status(500).json({
            status: 'error',
            error: 'Internal server error'
        });
    }
});

// GET approved comments by postId (public)
router.get('/post/:postId', async (req, res) => {
    try {
        const { postId } = req.params;

        const params = {
            TableName: TABLE_NAME,
            FilterExpression: 'postId = :postId AND commentStatus = :status',
            ExpressionAttributeValues: {
                ':postId': postId,
                ':status': 'approved'
            }
        };

        const data = await dynamo.scan(params).promise();

        // Remove email addresses from public response
        const sanitizedComments = data.Items.map(comment => {
            const { commenterEmail, ...sanitizedComment } = comment;
            return sanitizedComment;
        });

        res.status(200).json({
            status: 'success',
            postId,
            comments: sanitizedComments
        });

    } catch (error) {
        console.error('Error fetching comments:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch comments'
        });
    }
});

// GET all pending comments (admin only)
router.get('/pending', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const params = {
            TableName: TABLE_NAME,
            FilterExpression: 'commentStatus = :status',
            ExpressionAttributeValues: {
                ':status': 'pending'
            }
        };

        const data = await dynamo.scan(params).promise();

        res.status(200).json({
            status: 'success',
            comments: data.Items
        });

    } catch (error) {
        console.error('Error fetching pending comments:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch pending comments'
        });
    }
});

// PATCH update comment status (admin only)
router.patch('/:commentId/status', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { commentId } = req.params;

        let commentStatus;
        if (Buffer.isBuffer(req.body)) {
            const parsed = JSON.parse(req.body.toString());
            commentStatus = parsed.commentStatus;
        } else {
            commentStatus = req.body.commentStatus;
        }

        if (!commentStatus || !['approved', 'rejected', 'pending'].includes(commentStatus)) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid or missing commentStatus. Must be one of: approved, rejected, pending.'
            });
        }

        const params = {
            TableName: TABLE_NAME,
            Key: { comment_ID: commentId },
            UpdateExpression: 'SET commentStatus = :status, updatedAt = :updatedAt',
            ExpressionAttributeValues: {
                ':status': commentStatus,
                ':updatedAt': new Date().toISOString()
            },
            ReturnValues: 'ALL_NEW'
        };

        const result = await dynamo.update(params).promise();

        res.status(200).json({
            status: 'success',
            message: `Comment status updated to ${commentStatus}`,
            data: result.Attributes
        });

    } catch (error) {
        console.error('Error updating comment status:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to update comment status'
        });
    }
});

// GET comments by email (for users to check their comment status)
router.get('/my-comments/:email', async (req, res) => {
    try {
        const { email } = req.params;

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid email format'
            });
        }

        const params = {
            TableName: TABLE_NAME,
            FilterExpression: 'commenterEmail = :email',
            ExpressionAttributeValues: {
                ':email': email
            }
        };

        const data = await dynamo.scan(params).promise();

        // Remove sensitive data but keep status info
        const userComments = data.Items.map(comment => ({
            comment_ID: comment.comment_ID,
            postId: comment.postId,
            commenterName: comment.commenterName,
            commentText: comment.commentText,
            commentStatus: comment.commentStatus,
            createdAt: comment.createdAt,
            updatedAt: comment.updatedAt || null,
            website: comment.website || ''
        }));

        res.status(200).json({
            status: 'success',
            email: email,
            comments: userComments
        });

    } catch (error) {
        console.error('Error fetching user comments:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch comments'
        });
    }
});

// GET specific comment status by commentId and email (for verification)
router.get('/status/:commentId/:email', async (req, res) => {
    try {
        const { commentId, email } = req.params;

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid email format'
            });
        }

        const params = {
            TableName: TABLE_NAME,
            Key: { comment_ID: commentId }
        };

        const data = await dynamo.get(params).promise();

        if (!data.Item) {
            return res.status(404).json({
                status: 'error',
                error: 'Comment not found'
            });
        }

        // Verify the email matches the commenter's email
        if (data.Item.commenterEmail !== email) {
            return res.status(403).json({
                status: 'error',
                error: 'Access denied. Email does not match comment author.'
            });
        }

        const comment = {
            comment_ID: data.Item.comment_ID,
            postId: data.Item.postId,
            commenterName: data.Item.commenterName,
            commentText: data.Item.commentText,
            commentStatus: data.Item.commentStatus,
            createdAt: data.Item.createdAt,
            updatedAt: data.Item.updatedAt || null,
            website: data.Item.website || ''
        };

        res.status(200).json({
            status: 'success',
            comment: comment
        });

    } catch (error) {
        console.error('Error fetching comment status:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch comment status'
        });
    }
});

// GET all comments (admin only)
router.get('/all', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const data = await dynamo.scan({
            TableName: TABLE_NAME
        }).promise();

        res.status(200).json({
            status: 'success',
            comments: data.Items
        });

    } catch (error) {
        console.error('Error fetching all comments:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch comments'
        });
    }
});

// DELETE comment (admin only)
router.delete('/:commentId', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { commentId } = req.params;

        // Check if comment exists
        const existingComment = await dynamo.get({
            TableName: TABLE_NAME,
            Key: { comment_ID: commentId }
        }).promise();

        if (!existingComment.Item) {
            return res.status(404).json({
                status: 'error',
                error: 'Comment not found'
            });
        }

        await dynamo.delete({
            TableName: TABLE_NAME,
            Key: { comment_ID: commentId }
        }).promise();

        res.status(200).json({
            status: 'success',
            message: 'Comment deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting comment:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to delete comment'
        });
    }
});

module.exports = router;