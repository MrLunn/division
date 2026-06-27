const router = require('express').Router();
const bcrypt = require('bcryptjs');
const db = require('../db/pool');
const { signToken } = require('../middleware/auth');

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, email, password, characterName } = req.body;
  if (!username || !email || !password || !characterName) {
    return res.status(400).json({ error: 'All fields required: username, email, password, characterName' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be 6+ characters' });
  if (characterName.length < 3) return res.status(400).json({ error: 'Agent name must be 3+ characters' });

  try {
    // Pre-check for existing username or email with clear messages
    const existing = await db.query(
      `SELECT username, email FROM users WHERE username = $1 OR email = $2`,
      [username.toLowerCase(), email.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      const taken = existing.rows[0];
      if (taken.username === username.toLowerCase())
        return res.status(409).json({ error: `Username "${username}" is already taken — please choose another` });
      if (taken.email === email.toLowerCase())
        return res.status(409).json({ error: 'That email address is already registered' });
    }

    const hash = await bcrypt.hash(password, 12);

    const userResult = await db.query(`
      INSERT INTO users (username, email, password_hash)
      VALUES ($1, $2, $3)
      RETURNING id, username, email, created_at
    `, [username.toLowerCase(), email.toLowerCase(), hash]);

    const user = userResult.rows[0];

    // Create character automatically
    const charResult = await db.query(`
      INSERT INTO characters (user_id, name)
      VALUES ($1, $2)
      RETURNING *
    `, [user.id, characterName]);

    const token = signToken(user.id);
    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, email: user.email },
      character: charResult.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint && err.constraint.includes('email'))
        return res.status(409).json({ error: 'That email address is already registered' });
      if (err.constraint && err.constraint.includes('username'))
        return res.status(409).json({ error: `Username "${username}" is already taken — please choose another` });
    }
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  try {
    const result = await db.query(
      `SELECT * FROM users WHERE email = $1`, [email.toLowerCase()]
    );
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.rows[0];
    if (user.is_banned) return res.status(403).json({ error: 'Account banned' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await db.query(`UPDATE users SET last_login = NOW() WHERE id = $1`, [user.id]);

    const charResult = await db.query(`SELECT * FROM characters WHERE user_id = $1`, [user.id]);
    const token = signToken(user.id);

    res.json({
      token,
      user: { id: user.id, username: user.username, email: user.email },
      character: charResult.rows[0] || null,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me
router.get('/me', require('../middleware/auth').requireAuth, async (req, res) => {
  try {
    const userResult = await db.query(
      `SELECT id, username, email, created_at, last_login FROM users WHERE id = $1`, [req.userId]
    );
    const clanResult = await db.query(`
      SELECT cl.id, cl.name, cl.tag, cm.role
      FROM clan_members cm
      JOIN clans cl ON cl.id = cm.clan_id
      WHERE cm.character_id = $1
    `, [req.character.id]);

    res.json({
      user: userResult.rows[0],
      character: req.character,
      clan: clanResult.rows[0] || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load profile' });
  }
});

module.exports = router;
