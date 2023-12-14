import React, { useEffect, useState } from "react";
import { Navbar, Nav } from "react-bootstrap";
import "./App.css";

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
    <Navbar bg="dark" variant="dark" fixed="top">
      <Nav justify className="w-100" defaultActiveKey="/home">
        <Nav.Item>
          <Nav.Link href="/">Roll of Cards</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link href="/Game2">In-Between</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link href="/connect-four">Connect Four</Nav.Link>
        </Nav.Item>
        <Nav.Item>
          <Nav.Link href="/war">War</Nav.Link>
        </Nav.Item>
        {isUserLoggedIn ? (
          <>
            <Nav.Item>
              <Nav.Link>Welcome, {username}!</Nav.Link>
            </Nav.Item>
            <Nav.Item>
              <Nav.Link onClick={handleLogout}>Logout</Nav.Link>
            </Nav.Item>
          </>
        ) : (
          <Nav.Item>
            <Nav.Link href="/registration">Login/Register</Nav.Link>
          </Nav.Item>
        )}
      </Nav>
    </Navbar>
  );
}

export default NavBar;
