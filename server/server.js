const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const bcrypt = require("bcrypt");
const cors = require("cors");
const app = express();
app.use(bodyParser.json());
app.use(cors());

// CORS configuration
const corsOptions = {
	origin: "http://localhost:3000", // Replace with the actual origin of your frontend
	methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
	credentials: true, // Enable CORS credentials (cookies, HTTP authentication)
};

app.use(cors(corsOptions)); // Apply the CORS configuration

// Database configuration
const db = mysql.createPool({
	host: "localhost",
	user: "root", // Use your MySQL username here
	password: "", // Use your MySQL password here
	database: "game",
	port: 3306,
	connectionLimit: 10, // Adjust the connection limit as needed
});

// Connect to the database
db.getConnection((err, connection) => {
	if (err) {
		console.error("Database connection failed:", err);
		return;
	}
	console.log("Connected to the database");

	// Release the connection when done
	connection.release();
});

app.post("/registration", async (req, res) => {
	const { email, username, password } = req.body;

	console.log("Received a registration request:", {
		email,
		username,
		password,
	});

	// Check if the username already exists in the database
	const checkUsernameQuery = "SELECT * FROM users WHERE username = ?";
	db.query(checkUsernameQuery, [username], async (error, results) => {
		if (error) {
			console.error("Username check failed:", error);
			res.status(500).json({ message: "Registration failed" });
		} else {
			// If a user with the same username already exists, return an error
			if (results.length > 0) {
				res
					.status(400)
					.json({
						message:
							"Username already exists. Please choose a different username.",
					});
			} else {
				// Hash the password and insert user data into the database
				const hashedPassword = await bcrypt.hash(password, 10); // Hash the password (adjust salt rounds as needed)

				console.log("Hashed password:", hashedPassword);

				// Example query to insert data
				const insertQuery =
					"INSERT INTO users (email, username, password) VALUES (?, ?, ?)";
				db.query(
					insertQuery,
					[email, username, hashedPassword],
					(error, results) => {
						if (error) {
							console.error("Registration failed:", error);
							res.status(500).json({ message: "Registration failed" });
						} else {
							if (results.affectedRows === 1) {
								console.log("Registration successful");
								res.status(200).json({ message: "Registration successful" });
							} else {
								console.error("Registration failed due to database issue");
								res
									.status(500)
									.json({
										message: "Registration failed due to a database issue",
									});
							}
						}
					}
				);
			}
		}
	});
});

const port = 3001; // Choose an available port
app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});
