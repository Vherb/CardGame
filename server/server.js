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
<<<<<<< HEAD
				res
					.status(400)
					.json({
						message:
							"Username already exists. Please choose a different username.",
					});
=======
				res.status(400).json({
					message:
						"Username already exists. Please choose a different username.",
				});
>>>>>>> origin/main
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
<<<<<<< HEAD
								res
									.status(500)
									.json({
										message: "Registration failed due to a database issue",
									});
=======
								res.status(500).json({
									message: "Registration failed due to a database issue",
								});
>>>>>>> origin/main
							}
						}
					}
				);
			}
		}
	});
<<<<<<< HEAD
=======
});

app.post("/login", async (req, res) => {
	const { username, password } = req.body;

	console.log("Received a login request:", {
		username,
		password,
	});

	// Retrieve user data from the database based on the username
	const getUserQuery = "SELECT * FROM users WHERE username = ?";
	db.query(getUserQuery, [username], async (error, results) => {
		if (error) {
			console.error("User retrieval failed:", error);
			res.status(500).json({ message: "Login failed" });
		} else {
			// If a user with the given username exists
			if (results.length > 0) {
				const user = results[0]; // Assuming username is unique
				const hashedPassword = user.password; // Retrieve the hashed password from the database

				// Compare the provided password with the hashed password in the database
				const passwordMatch = await bcrypt.compare(password, hashedPassword);

				if (passwordMatch) {
					// Passwords match, login successful
					console.log("Login successful");
					res.status(200).json({ message: "Login successful" });
				} else {
					// Passwords do not match, return an error
					console.log("Incorrect password");
					res.status(400).json({ message: "Incorrect password" });
				}
			} else {
				// User with the given username does not exist
				console.log("User not found");
				res.status(404).json({ message: "User not found" });
			}
		}
	});
>>>>>>> origin/main
});

const port = 3001; // Choose an available port
app.listen(port, () => {
	console.log(`Server is running on port ${port}`);
});
