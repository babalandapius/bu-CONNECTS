const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const http = require('http'); 
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// 1. Create the 'uploads' folder if it doesn't exist
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// 2. Configure storage for both Images and Videos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

const app = express();
app.use(cors());
app.use(express.json());

// 4. Make the 'uploads' folder public
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173", 
    methods: ["GET", "POST"]
  }
});

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'pius1234.', 
  database: 'bu_connects'
});

db.connect(err => {
  if (err) {
    console.error('Database connection failed:', err.stack);
    return;
  }
  console.log('Connected to MySQL Database.');
});

// --- SOCKET.IO REAL-TIME LOGIC ---
io.on("connection", (socket) => {
  console.log(`User Connected: ${socket.id}`);

  socket.on("send_message", (data) => {
    const { sender, receiver, message } = data;
    const sql = "INSERT INTO messages (sender, receiver, message) VALUES (?, ?, ?)";
    
    db.query(sql, [sender, receiver, message], (err, result) => {
      if (!err) {
        const messageWithId = { ...data, id: result.insertId };
        io.emit("receive_message", messageWithId); 
      } else {
        console.error("Socket DB Error:", err);
      }
    });
  });

  socket.on("disconnect", () => {
    console.log("User Disconnected", socket.id);
  });
});

// --- API ROUTES ---

// Get all posts or filter by campus
app.get('/api/posts', (req, res) => {
  const campus = req.query.campus;
  let sql = 'SELECT * FROM posts';
  let params = [];

  if (campus && campus !== 'undefined' && campus !== '') {
    sql += ' WHERE campus = ?';
    params.push(campus);
  }
  sql += ' ORDER BY id DESC';

  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

/** * UPGRADED POST ROUTE 
 * Now handles text, images, and videos
 */
app.post('/api/posts', upload.single('media'), (req, res) => {
  const { author, content, campus } = req.body;
  const media_url = req.file ? `/uploads/${req.file.filename}` : null;
  let media_type = 'none';

  if (req.file) {
    media_type = req.file.mimetype.startsWith('video/') ? 'video' : 'image';
  }

  // Added 2 extra columns (media_url, media_type) to your original 3
  const sql = 'INSERT INTO posts (author, content, campus, media_url, media_type) VALUES (?,?,?,?,?)';

  db.query(sql, [author, content, campus, media_url, media_type], (err, result) => {
    if (err) {
      console.error("POST Error:", err);
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Post created", id: result.insertId, media_url, media_type });
  });
});

app.delete('/api/posts/:id', (req, res) => {
  const sql = "DELETE FROM posts WHERE id = ?";
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Post deleted successfully" });
  });
});

// Notifications Logic
app.get('/api/notifications/:userId', (req, res) => {
  const sql = `
    SELECT n.*, u.name as actorName, u.profile_pic as actorPic 
    FROM notifications n 
    JOIN users u ON n.actor_id = u.id 
    WHERE n.user_id = ? 
    ORDER BY n.created_at DESC 
    LIMIT 20
  `;
  db.query(sql, [req.params.userId], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
});

app.put('/api/notifications/read/:userId', (req, res) => {
  db.query("UPDATE notifications SET is_read = TRUE WHERE user_id = ?", [req.params.userId], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Marked all as read" });
  });
});

// Marketplace Logic
app.get('/api/market', (req, res) => {
  const sql = "SELECT * FROM market_items ORDER BY created_at DESC";
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.post('/api/market', upload.single('image'), (req, res) => {
  const { name, price, description, seller, campus } = req.body;
  const image_url = req.file ? `/uploads/${req.file.filename}` : null;
  const sql = "INSERT INTO market_items (name, price, description, seller, campus, image_url) VALUES (?,?,?,?,?,?)";
  db.query(sql, [name, price, description, seller, campus, image_url], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Item listed successfully!", id: result.insertId });
  });
});

// Events Logic
app.get('/api/events', (req, res) => {
  const campus = req.query.campus;
  const sql = "SELECT *, DATE_FORMAT(event_date, '%b') as month, DATE_FORMAT(event_date, '%d') as day FROM campus_events WHERE campus = ? ORDER BY event_date ASC";
  db.query(sql, [campus], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

app.post('/api/events', (req, res) => {
  const { title, location, event_date, event_time, description, campus } = req.body;
  const sql = "INSERT INTO campus_events (title, location, event_date, event_time, description, campus) VALUES (?,?,?,?,?,?)";
  db.query(sql, [title, location, event_date, event_time, description, campus], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Event added!", id: result.insertId });
  });
});

// Settings Logic
app.put('/api/settings', (req, res) => {
  const { userId, motto, password } = req.body;
  let sql = "UPDATE users SET motto = ? WHERE id = ?";
  let params = [motto, userId];
  if (password) {
    sql = "UPDATE users SET motto = ?, password = ? WHERE id = ?";
    params = [motto, password, userId];
  }
  db.query(sql, params, (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Settings updated!" });
  });
});

// Profile Pic Logic
app.post('/api/user/profile-pic', upload.single('image'), (req, res) => {
  const { userId } = req.body;
  const imagePath = req.file ? req.file.filename : null;
  if (!imagePath) return res.status(400).json({ message: "No image uploaded" });
  const sql = "UPDATE users SET profile_pic = ? WHERE id = ?";
  db.query(sql, [imagePath, userId], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Profile picture updated!", profile_pic: imagePath });
  });
});

// Auth Logic
app.post('/api/register', (req, res) => {
  const { name, email, password, campus } = req.body;
  const checkEmail = "SELECT * FROM users WHERE email = ?";
  db.query(checkEmail, [email], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length > 0) return res.status(409).json({ message: "Email registered!" });
    const sql = "INSERT INTO users (name, email, password, campus) VALUES (?, ?, ?, ?)";
    db.query(sql, [name, email, password, campus], (err, insertResult) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Registration successful!", id: insertResult.insertId, name, email, campus });
    });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const sql = "SELECT * FROM users WHERE email = ? AND password = ?";
  db.query(sql, [email, password], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length > 0) {
      const user = result[0];
      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, campus: user.campus, motto: user.motto } });
    } else {
      res.status(401).json({ message: "Invalid email or password!" });
    }
  });
});

// Chat History
app.get('/api/messages/:user1/:user2', (req, res) => {
  const { user1, user2 } = req.params;
  const sql = "SELECT * FROM messages WHERE (sender = ? AND receiver = ?) OR (sender = ? AND receiver = ?) ORDER BY created_at ASC";
  db.query(sql, [user1, user2, user2, user1], (err, result) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(result);
  });
});

// User Sync
app.get('/api/user/:id', (req, res) => {
  const sql = "SELECT id, name, email, campus, motto FROM users WHERE id = ?";
  db.query(sql, [req.params.id], (err, result) => {
    if (err) return res.status(500).json(err);
    if (result.length > 0) res.json(result[0]);
    else res.status(404).json({ message: "User not found" });
  });
});

// --- LIKES ---
app.post('/api/posts/like', (req, res) => {
    const { postId, userId } = req.body;
    // Check if already liked (Toggle Logic)
    const checkSql = "SELECT * FROM post_likes WHERE post_id = ? AND user_id = ?";
    db.query(checkSql, [postId, userId], (err, results) => {
        if (results.length > 0) {
            // Unlike
            db.query("DELETE FROM post_likes WHERE post_id = ? AND user_id = ?", [postId, userId], () => {
                res.json({ liked: false });
            });
        } else {
            // Like
            db.query("INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)", [postId, userId], () => {
                res.json({ liked: true });
            });
        }
    });
});

// --- COMMENTS ---
app.get('/api/posts/:postId/comments', (req, res) => {
    const sql = "SELECT * FROM post_comments WHERE post_id = ? ORDER BY created_at DESC";
    db.query(sql, [req.params.postId], (err, results) => {
        res.json(results);
    });
});

app.post('/api/posts/comment', (req, res) => {
    const { postId, userName, text } = req.body;
    const sql = "INSERT INTO post_comments (post_id, user_name, comment_text) VALUES (?, ?, ?)";
    db.query(sql, [postId, userName, text], (err, result) => {
        res.json({ message: "Comment added", id: result.insertId });
    });
});

const PORT = 5000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});