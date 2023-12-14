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
  });

  const [registrationError, setRegistrationError] = useState(null);
  const [isRegistering, setIsRegistering] = useState(true);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // Send formData to your server for registration or login
      const response = await fetch(
        `http://cardndice.atspace.cc:3002${isRegistering ? "/registration" : "/login"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(formData),
        }
      );
      
      if (response.ok) {
        // Registration or login was successful
  const responseData = await response.json();
  
  // Store the token and username in localStorage
  localStorage.setItem("token", responseData.token);
  localStorage.setItem("username", responseData.username);
        // Registration or login was successful
        alert(`${isRegistering ? "Registration" : "Login"} successful!`);
        setRegistrationError(null);
      } else {
        // Registration or login failed
        const errorData = await response.json();
        setRegistrationError(
          errorData.message || `${
            isRegistering ? "Registration" : "Login"
          } failed. Please try again.`
        );
      }
    } catch (error) {
      console.error("Error:", error);
      setRegistrationError("An error occurred. Please try again later.");
    }

    // Reset the form fields after submission
    setFormData({
      username: "",
      password: "",
    });
  };

  const toggleForm = () => {
    setIsRegistering(!isRegistering);
    setRegistrationError(null);
  };

  return (
    <Container>
      <NavBar />
      <Form
        onSubmit={handleSubmit}
        className="mt-5"
        style={{
          backgroundColor: "#C7E7FF",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h2 className="mb-4">
          {isRegistering ? "Register" : "Login"}{" "}
          <small>
            <Button
              variant="link"
              onClick={toggleForm}
              className="p-0 m-0"
              style={{ fontSize: "1rem" }}
            >
              {isRegistering
                ? "Already have an account?"
                : "Don't have an account?"}
            </Button>
          </small>
        </h2>

        {registrationError && (
          <div className="alert alert-danger" role="alert">
            {registrationError}
          </div>
        )}

        <Form.Group controlId="formEmail">
          <Form.Label>Email address</Form.Label>
          <Form.Control
            type="email"
            placeholder="Enter email"
            name="email"
            value={formData.email}
            onChange={handleChange}
            required
          />
          <Form.Text className="text-muted">
            We'll never share your email with anyone else.
          </Form.Text>
        </Form.Group>

        <Form.Group controlId="formUserName">
          <Form.Label>User Name</Form.Label>
          <Form.Control
            type="text"
            placeholder="Enter username"
            name="username"
            value={formData.username}
            onChange={handleChange}
            required
          />
        </Form.Group>

        <Form.Group controlId="formPassword">
          <Form.Label>Password</Form.Label>
          <Form.Control
            type="password"
            placeholder="Password"
            name="password"
            value={formData.password}
            onChange={handleChange}
            required
          />
        </Form.Group>

        <Form.Group controlId="formBasicCheckbox">
          <Form.Check
            type="checkbox"
            label="I agree to the terms and conditions"
            required
          />
        </Form.Group>

        <Button variant="success" type="submit">
          {isRegistering ? "Register" : "Login"}
        </Button>
      </Form>
    </Container>
  );
}

export default Registration;
