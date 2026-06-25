const jwt = require('jsonwebtoken');
const db = require('../db/pool');

const JWT_SECRET = process.env.JWT_SECRET || 'division-shd-secret-change-in-prod';

async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;

    // Load character
    const result = await db.query(
      `SELECT * FROM characters WHERE user_id = $1`, [decoded.userId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: 'No character found. Create one first.' });
    }
    req.character = result.rows[0];
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, signToken, JWT_SECRET };
