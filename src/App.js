import React, { useState } from 'react';
import Game from './components/Game';
import './App.css'; // You can add CSS styles here
import 'bootstrap/dist/css/bootstrap.min.css';
import RegistrationForm from './components/RegistrationForm'; // Import your existing RegistrationForm component
import {
  Container,
  Navbar,
  Nav,
  Button,
  Typography,
  NavDropdown,
} from 'react-bootstrap';

function App() {
  const [showRegistrationModal, setShowRegistrationModal] = useState(false);

  const openRegistrationModal = () => {
    setShowRegistrationModal(true);
  };

  const closeRegistrationModal = () => {
    setShowRegistrationModal(false);
  };

  return (
    <div className="App game-background">
      <Navbar bg="dark" variant="dark" expand="lg" fixed="top">
        <Container>
          <Navbar.Brand>Roll of Cards</Navbar.Brand>
          <Navbar.Toggle aria-controls="basic-navbar-nav" />
          <Navbar.Collapse id="basic-navbar-nav">
            <Nav className="ml-auto">
              <Nav.Link href="#" style={{ marginRight: '10px' }}>
                Login/Register
              </Nav.Link>
              <Nav.Link href="#">Deposit</Nav.Link>
			 
               
            </Nav>
          </Navbar.Collapse>
        </Container>
      </Navbar>

      <Container style={{ marginTop: '64px' }}>
        {/* Add margin to create space below the navigation bar */}
        <Game />
      </Container>
    </div>
  );
}

export default App;
