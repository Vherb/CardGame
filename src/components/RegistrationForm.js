import React, { useState } from "react";
import Button from "react-bootstrap/Button";
import Form from "react-bootstrap/Form";
import Container from "react-bootstrap/Container";
import NavBar from "./NavBar";

function Registration() {
	const [formData, setFormData] = useState({
		email: "",
		username: "",
		password: "",
		confirmPassword: "",
	});

	const [registrationError, setRegistrationError] = useState(null); // Add state to track registration errors

	const handleChange = (e) => {
		const { name, value } = e.target;
		setFormData({ ...formData, [name]: value });
	};

	const handleSubmit = async (e) => {
		e.preventDefault();

		// Perform form validation
		if (formData.password !== formData.confirmPassword) {
			alert("Passwords do not match.");
			return;
		}

		try {
			// Send formData to your server for registration
			const response = await fetch("http://localhost:3001/registration", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify(formData),
			});

			if (response.ok) {
				// Registration was successful
				alert("Registration successful!"); // You can show a success message to the user
				setRegistrationError(null); // Clear any previous registration errors
			} else {
				// Registration failed
				const errorData = await response.json();
				setRegistrationError(
					errorData.message || "Registration failed. Please try again."
				);
			}
		} catch (error) {
			console.error("Error:", error);
			setRegistrationError("An error occurred. Please try again later.");
		}

		// Reset the form fields after submission
		setFormData({
			email: "",
			username: "",
			password: "",
			confirmPassword: "",
		});
	};

	return (
		<Container>
			<NavBar />
			<Form
				onSubmit={handleSubmit}
				className='mt-5'
				style={{
					backgroundColor: "#C7E7FF",
					padding: "20px",
					borderRadius: "10px",
				}}
			>
				<h2 className='mb-4'>Register</h2>

				{registrationError && (
					<div className='alert alert-danger' role='alert'>
						{registrationError}
					</div>
				)}

				<Form.Group controlId='formEmail'>
					<Form.Label>Email address</Form.Label>
					<Form.Control
						type='email'
						placeholder='Enter email'
						name='email'
						value={formData.email}
						onChange={handleChange}
						required
					/>
					<Form.Text className='text-muted'>
						We'll never share your email with anyone else.
					</Form.Text>
				</Form.Group>

				<Form.Group controlId='formUserName'>
					<Form.Label>User Name</Form.Label>
					<Form.Control
						type='text'
						placeholder='Enter username'
						name='username'
						value={formData.username}
						onChange={handleChange}
						required
					/>
				</Form.Group>

				<Form.Group controlId='formPassword'>
					<Form.Label>Password</Form.Label>
					<Form.Control
						type='password'
						placeholder='Password'
						name='password'
						value={formData.password}
						onChange={handleChange}
						required
					/>
				</Form.Group>

				<Form.Group controlId='formConfirmPassword'>
					<Form.Label>Confirm Password</Form.Label>
					<Form.Control
						type='password'
						placeholder='Confirm password'
						name='confirmPassword'
						value={formData.confirmPassword}
						onChange={handleChange}
						required
					/>
				</Form.Group>

				<Form.Group controlId='formBasicCheckbox'>
					<Form.Check
						type='checkbox'
						label='I agree to the terms and conditions'
						required
					/>
				</Form.Group>

				<Button variant='success' type='submit'>
					Register
				</Button>
			</Form>
		</Container>
	);
}

export default Registration;
