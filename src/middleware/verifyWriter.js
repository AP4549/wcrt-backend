module.exports = (req, res, next) => {
    if (!req.user || req.user.role !== 'writer') {
      return res.status(403).json({ error: 'Writer access only.' });
    }
    next();
  };
  