const express = require('express');
const mysql = require('mysql2');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const cors = require('cors');
const app = express();
app.use(bodyParser.json());
app.use(cors());


// CORS configuration
const corsOptions = {
  origin: 'http://localhost:3000/registration', // Replace with the actual origin of your frontend
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // Enable CORS credentials (cookies, HTTP authentication)
};

app.use(cors(corsOptions)); // Apply the CORS configuration

// Database configuration
const db = mysql.createPool({
  host: 'localhost',
  user: 'root', // Use your MySQL username here
  password: '', // Use your MySQL password here
  database: 'game',
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
app.post('/registration', async (req, res) => {
  const { email, username, password } = req.body;

  console.log('Received a registration request:', { email, username, password });

  // Implement registration logic here
  // Hash the password and insert user data into the database
  const hashedPassword = await bcrypt.hash(password, 10); // Hash the password (adjust salt rounds as needed)

  console.log('Hashed password:', hashedPassword);

  // Example query to insert data
  const insertQuery = 'INSERT INTO users (email, username, password) VALUES (?, ?, ?)';
  db.query(insertQuery, [email, username, hashedPassword], (error, results) => {
    if (error) {
      console.error('Registration failed:', error);
      res.status(500).json({ message: 'Registration failed' });
    } else {
      console.log('Registration successful');
      res.status(200).json({ message: 'Registration successful' });
    }
  });
});

const port = 3001; // Choose an available port
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
