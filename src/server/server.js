const express = require('express');
const mysql = require('mysql2'); // Use 'mysql2' package
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const cors = require('cors');
const app = express();
app.use(bodyParser.json());
app.use(cors());

// Database configuration
const db = mysql.createPool({ // Use createPool for better connection handling
  host: 'pdb1007.atspace.me',
  user: '2290917_game',
  password: 'Ltmq6196!',
  database: '2290917_game',
  port: 3306,
  connectionLimit: 10, // Adjust the connection limit as needed
});

// Connect to the database
db.getConnection((err, connection) => {
  if (err) {
    console.error('Database connection failed:', err);
    return;
  }
  console.log('Connected to the database');

  // Release the connection when done
  connection.release();
});

// Registration endpoint
app.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  // Implement registration logic here
  // Hash the password and insert user data into the database
  const hashedPassword = await bcrypt.hash(password, 10); // Hash the password (adjust salt rounds as needed)

  // Example query to insert data
  const insertQuery = 'INSERT INTO users (email, username, password) VALUES (?, ?, ?)';
  db.query(insertQuery, [email, username, hashedPassword], (error, results) => {
    if (error) {
      console.error('Registration failed:', error);
      res.status(500).json({ message: 'Registration failed' });
    } else {
      res.status(200).json({ message: 'Registration successful' });
    }
  });
});

const port = 3009; // Choose an available port
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
