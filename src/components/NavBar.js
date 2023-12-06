import React, { useEffect, useState } from "react";
import { Navbar, Nav, Container, NavDropdown } from "react-bootstrap";

function NavBar() {
  const [isUserLoggedIn, setIsUserLoggedIn] = useState(false);
  const [username, setUsername] = useState("");

  useEffect(() => {
    // Check if the user is logged in by looking for the token in local storage
    const token = localStorage.getItem("token");

    if (token) {
      // User is logged in, set the username
      const storedUsername = localStorage.getItem("username");
      setUsername(storedUsername);
      setIsUserLoggedIn(true);
    }
  }, []);

  const handleLogout = () => {
    // Clear the token and username from local storage on logout
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    setIsUserLoggedIn(false);
    setUsername("");
  };

  return (
    <Navbar bg="dark" variant="dark" expand="lg" fixed="top">
      <Container>
        <Navbar.Brand>Roll of Cards</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="ml-auto">
            {isUserLoggedIn ? (
              <>
                <Nav.Link>Welcome, {username}!</Nav.Link>
                <Nav.Link onClick={handleLogout}>Logout</Nav.Link>
              </>
            ) : (
              <Nav.Link href="/registration" style={{ marginRight: "10px" }}>
                Login/Register
              </Nav.Link>
            )}
            <Nav.Link href="#">Deposit</Nav.Link>
            <NavDropdown title="Games" id="basic-nav-dropdown">
              <NavDropdown.Item href="/Game2">In-Between</NavDropdown.Item>
              <NavDropdown.Item href="/connect-four">Connect Four</NavDropdown.Item>
              <NavDropdown.Item href="/">Roll of Cards</NavDropdown.Item>
            </NavDropdown>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
}

export default NavBar;
