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
const VIEWS_TABLE = process.env.VIEWS_TABLE || 'wcrt-views';

// Function to record a view
async function recordView(postId, viewerInfo = {}) {
    try {
        // Update or create the view count record in the views table
        const getParams = {
            TableName: VIEWS_TABLE,
            Key: { views_ID: postId }
        };
        const existing = await dynamo.get(getParams).promise();

        let newCount = 1;
        if (existing.Item && typeof existing.Item.viewCount === 'number') {
            newCount = existing.Item.viewCount + 1;
        }

        const putParams = {
            TableName: VIEWS_TABLE,
            Item: {
                views_ID: postId,
                viewCount: newCount
            }
        };
        await dynamo.put(putParams).promise();

        // Increment view count in posts table
        await dynamo.update({
            TableName: TABLE_NAME,
            Key: { postId },
            UpdateExpression: 'ADD viewCount :inc',
            ExpressionAttributeValues: {
                ':inc': 1
            }
        }).promise();

        return { views_ID: postId, viewCount: newCount };
    } catch (error) {
        console.error('Error recording view:', error);
        throw error;
    }
}

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

  router.get('/admin/s3/upload-url', verifyToken, verifyAdmin, async (req, res) => {
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
    if (!post_status || !['open', 'approved', 'rejected','edit'].includes(post_status)) {
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

// GET post by postId (no auth)
router.get('/:postId', async (req, res) => {
    const { postId } = req.params;
    const params = {
        TableName: TABLE_NAME,
        Key: { postId }
    };

    try {
        const data = await dynamo.get(params).promise();

        if (!data.Item) {
            return res.status(404).json({
                status: 'error',
                error: 'Post not found'
            });
        }

        // Record the view and increment viewCount
        await recordView(postId, {
            ipAddress: req.ip || null,
            userAgent: req.get('User-Agent') || null,
            referrer: req.get('Referrer') || req.get('Referer') || null
        });

        // Fetch updated post data to get current view count
        const updatedData = await dynamo.get(params).promise();

        res.status(200).json({
            status: 'success',
            post: updatedData.Item
        });
    } catch (error) {
        console.error('Error fetching post by ID:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch post'
        });
    }
});

// GET all posts with post_status = 'approved' (no auth)
router.get('/status/approved', async (req, res) => {
    const params = {
        TableName: TABLE_NAME,
        FilterExpression: 'post_status = :approvedStatus',
        ExpressionAttributeValues: {
            ':approvedStatus': 'approved'
        }
    };

    try {
        const data = await dynamo.scan(params).promise();

        res.status(200).json({
            status: 'success',
            posts: data.Items
        });
    } catch (error) {
        console.error('Error fetching approved posts:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch approved posts'
        });
    }
});

// GET approved posts by category (no auth)
router.get('/category/:categoryName/approved', async (req, res) => {
    const { categoryName } = req.params;

    const params = {
        TableName: TABLE_NAME,
        FilterExpression: '#cat = :categoryVal AND post_status = :approvedStatus',
        ExpressionAttributeNames: {
            '#cat': 'category'
        },
        ExpressionAttributeValues: {
            ':categoryVal': categoryName,
            ':approvedStatus': 'approved'
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
        console.error('Error fetching approved posts by category:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch approved posts by category'
        });
    }
});


// GET view statistics for all posts (admin only)
router.get('/analytics/overview', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;

        let filterExpression = undefined;
        let expressionAttributeValues = undefined;

        // Add date range filter if provided
        if (startDate && endDate) {
            filterExpression = 'viewedAt BETWEEN :startDate AND :endDate';
            expressionAttributeValues = {
                ':startDate': startDate,
                ':endDate': endDate
            };
        }

        const params = {
            TableName: VIEWS_TABLE,
            ...(filterExpression && { FilterExpression: filterExpression }),
            ...(expressionAttributeValues && { ExpressionAttributeValues: expressionAttributeValues })
        };

        const data = await dynamo.scan(params).promise();

        // Group views by postId
        const viewsByPost = {};
        const viewsByDate = {};
        
        data.Items.forEach(view => {
            // Views by post
            viewsByPost[view.postId] = (viewsByPost[view.postId] || 0) + 1;
            
            // Views by date
            const date = view.viewedAt.split('T')[0];
            viewsByDate[date] = (viewsByDate[date] || 0) + 1;
        });

        // Get top 10 most viewed posts
        const topPosts = Object.entries(viewsByPost)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 10)
            .map(([postId, views]) => ({ postId, views }));

        res.status(200).json({
            status: 'success',
            totalViews: data.Items.length,
            uniquePosts: Object.keys(viewsByPost).length,
            topPosts,
            viewsByDate,
            dateRange: {
                startDate: startDate || null,
                endDate: endDate || null
            }
        });

    } catch (error) {
        console.error('Error fetching view overview:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch view overview'
        });
    }
});

// GET popular posts based on view count (public)
router.get('/popular/trending', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const category = req.query.category;

        let filterExpression = 'post_status = :status';
        let expressionAttributeValues = {
            ':status': 'approved'
        };

        // Add category filter if provided
        if (category) {
            filterExpression += ' AND category = :category';
            expressionAttributeValues[':category'] = category;
        }

        const params = {
            TableName: TABLE_NAME,
            FilterExpression: filterExpression,
            ExpressionAttributeValues: expressionAttributeValues
        };

        const data = await dynamo.scan(params).promise();

        // Sort by view count (descending) and limit results
        const popularPosts = data.Items
            .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
            .slice(0, limit);

        res.status(200).json({
            status: 'success',
            posts: popularPosts,
            category: category || 'all',
            limit
        });

    } catch (error) {
        console.error('Error fetching popular posts:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to fetch popular posts'
        });
    }
});

// Increment views for a post

// Increment views for a post (creates or updates a view count record in views table and increments in posts table)
router.post('/:postId/views', async (req, res) => {
    try {
        const { postId } = req.params;

        // Try to get the existing view count record for this post
        const getParams = {
            TableName: VIEWS_TABLE,
            Key: { views_ID: postId }
        };
        const existing = await dynamo.get(getParams).promise();

        let newCount = 1;
        if (existing.Item && typeof existing.Item.viewCount === 'number') {
            newCount = existing.Item.viewCount + 1;
        }

        // Put or update the view count record, always include postId
        const putParams = {
            TableName: VIEWS_TABLE,
            Item: {
                views_ID: postId,
                postId: postId,
                viewCount: newCount
            }
        };
        await dynamo.put(putParams).promise();

        // Also increment viewCount in the posts table
        await dynamo.update({
            TableName: TABLE_NAME,
            Key: { postId },
            UpdateExpression: 'ADD viewCount :inc',
            ExpressionAttributeValues: {
                ':inc': 1
            }
        }).promise();

        res.status(200).json({
            status: 'success',
            message: 'View count updated successfully',
            data: { views_ID: postId, postId: postId, viewCount: newCount }
        });
    } catch (error) {
        console.error('Error updating views:', error);
        res.status(500).json({
            status: 'error',
            error: 'Internal server error'
        });
    }
});

// Get views for a post

// Get views for a post (from views table)
router.get('/:postId/views', async (req, res) => {
    try {
        const { postId } = req.params;

        const params = {
            TableName: VIEWS_TABLE,
            Key: { views_ID: postId }
        };

        const result = await dynamo.get(params).promise();
        let data = result.Item;
        if (!data) {
            data = { views_ID: postId, postId: postId, viewCount: 0 };
        } else {
            // Ensure postId is present in the response
            if (!data.postId) data.postId = postId;
        }

        res.status(200).json({
            status: 'success',
            message: 'View count retrieved successfully',
            data: data
        });
    } catch (error) {
        console.error('Error retrieving views:', error);
        res.status(500).json({
            status: 'error',
            error: 'Internal server error'
        });
    }
});

// Edit post (writer only)
// router.patch('/:postId', verifyToken, verifyWriter, async (req, res) => {
//     try {
//         const { postId } = req.params;
//         const {
//             title,
//             content,
//             imageUrl,
//             category,
//             authorName,
//             authorImage,
//             uploadDate
//         } = req.body;

//         // if (
//         //     !title && !content && !imageUrl && !category &&
//         //     !authorName && !authorImage && !uploadDate
//         // ) {
//         //     return res.status(400).json({
//         //         status: 'error',
//         //         error: 'Missing fields to update'
//         //     });
//         // }

//         const updateExpression = [];
//         const expressionAttributeValues = {};
//         const expressionAttributeNames = {};

//         if (title) {
//             updateExpression.push('#title = :title');
//             expressionAttributeValues[':title'] = title;
//             expressionAttributeNames['#title'] = 'title';
//         }

//         if (content) {
//             updateExpression.push('#content = :content');
//             expressionAttributeValues[':content'] = content;
//             expressionAttributeNames['#content'] = 'content';
//         }

//         if (imageUrl) {
//             updateExpression.push('#imageUrl = :imageUrl');
//             expressionAttributeValues[':imageUrl'] = imageUrl;
//             expressionAttributeNames['#imageUrl'] = 'imageUrl';
//         }

//         if (category) {
//             updateExpression.push('#category = :category');
//             expressionAttributeValues[':category'] = category;
//             expressionAttributeNames['#category'] = 'category';
//         }

//         if (authorName) {
//             updateExpression.push('#authorName = :authorName');
//             expressionAttributeValues[':authorName'] = authorName;
//             expressionAttributeNames['#authorName'] = 'authorName';
//         }

//         if (authorImage) {
//             updateExpression.push('#authorImage = :authorImage');
//             expressionAttributeValues[':authorImage'] = authorImage;
//             expressionAttributeNames['#authorImage'] = 'authorImage';
//         }

//         if (uploadDate) {
//             updateExpression.push('#uploadDate = :uploadDate');
//             expressionAttributeValues[':uploadDate'] = uploadDate;
//             expressionAttributeNames['#uploadDate'] = 'uploadDate';
//         }

//         // Always reset post_status to 'open' when edited
//         updateExpression.push('#post_status = :post_status');
//         expressionAttributeValues[':post_status'] = 'open';
//         expressionAttributeNames['#post_status'] = 'post_status';

//         const params = {
//             TableName: POSTS_TABLE,
//             Key: { postId },
//             UpdateExpression: `SET ${updateExpression.join(', ')}`,
//             ExpressionAttributeValues: expressionAttributeValues,
//             ExpressionAttributeNames: expressionAttributeNames,
//             ReturnValues: 'UPDATED_NEW'
//         };

//         const result = await dynamo.update(params).promise();

//         res.status(200).json({
//             status: 'success',
//             message: 'Post updated successfully',
//             data: result.Attributes
//         });
//     } catch (error) {
//         console.error('Error updating post:', error);
//         res.status(500).json({
//             status: 'error',
//             error: 'Internal server error'
//         });
//     }
// });


router.patch('/:postId', verifyToken, verifyWriter, async (req, res) => {
    const { postId } = req.params;

    let body;
    if (Buffer.isBuffer(req.body)) {
        try {
            body = JSON.parse(req.body.toString());
        } catch (err) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid JSON body'
            });
        }
    } else {
        body = req.body;
    }

    const {
        title,
        content,
        category,
        authorName,
        authorImage,
        imageUrl,
        uploadDate,
        post_status = 'open' 
    } = body;

    // Validation
    if (!title || !content || !category || !authorName || !uploadDate) {
        return res.status(400).json({
            status: 'error',
            error: 'Missing required fields: title, content, category, authorName, uploadDate'
        });
    }

    const params = {
        TableName: TABLE_NAME,
        Key: { postId },
        UpdateExpression: `
            SET 
                title = :title,
                content = :content,
                category = :category,
                authorName = :authorName,
                authorImage = :authorImage,
                imageUrl = :imageUrl,
                uploadDate = :uploadDate,
                post_status = :post_status
        `,
        ExpressionAttributeValues: {
            ':title': title,
            ':content': content,
            ':category': category,
            ':authorName': authorName,
            ':authorImage': authorImage || '',
            ':imageUrl': imageUrl || '',
            ':uploadDate': uploadDate,
            ':post_status': post_status
        },
        ReturnValues: 'ALL_NEW'
    };

    try {
        const result = await dynamo.update(params).promise();
        res.status(200).json({
            status: 'success',
            message: 'Post updated successfully',
            updatedPost: result.Attributes
        });
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to update post'
        });
    }
});

router.patch('/adminedit/:postId', verifyToken, verifyAdmin, async (req, res) => {
    const { postId } = req.params;

    let body;
    if (Buffer.isBuffer(req.body)) {
        try {
            body = JSON.parse(req.body.toString());
        } catch (err) {
            return res.status(400).json({
                status: 'error',
                error: 'Invalid JSON body'
            });
        }
    } else {
        body = req.body;
    }

    const {
        title,
        content,
        category,
        authorName,
        authorImage,
        imageUrl,
        uploadDate
    } = body;

    // Validation
    if (!title || !content || !category || !authorName || !uploadDate) {
        return res.status(400).json({
            status: 'error',
            error: 'Missing required fields: title, content, category, authorName, uploadDate'
        });
    }

    const params = {
        TableName: TABLE_NAME,
        Key: { postId },
        UpdateExpression: `
            SET 
                title = :title,
                content = :content,
                category = :category,
                authorName = :authorName,
                authorImage = :authorImage,
                imageUrl = :imageUrl,
                uploadDate = :uploadDate
        `,
        ExpressionAttributeValues: {
            ':title': title,
            ':content': content,
            ':category': category,
            ':authorName': authorName,
            ':authorImage': authorImage || '',
            ':imageUrl': imageUrl || '',
            ':uploadDate': uploadDate
        },
        ReturnValues: 'ALL_NEW'
    };

    try {
        const result = await dynamo.update(params).promise();
        res.status(200).json({
            status: 'success',
            message: 'Post updated successfully',
            updatedPost: result.Attributes
        });
    } catch (error) {
        console.error('Error updating post:', error);
        res.status(500).json({
            status: 'error',
            error: 'Failed to update post'
        });
    }
});




module.exports = router;
