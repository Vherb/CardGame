import React from "react";
import { Navbar, Nav, Container, NavDropdown } from "react-bootstrap";

function NavBar() {
	return (
		<Navbar bg='dark' variant='dark' expand='lg' fixed='top'>
			<Container>
				<Navbar.Brand>Roll of Cards</Navbar.Brand>
				<Navbar.Toggle aria-controls='basic-navbar-nav' />
				<Navbar.Collapse id='basic-navbar-nav'>
					<Nav className='ml-auto'>
						<Nav.Link href='/registration' style={{ marginRight: "10px" }}>
							Login/Register
						</Nav.Link>
						<Nav.Link href='#'>Deposit</Nav.Link>
						<NavDropdown title='Games' id='basic-nav-dropdown'>
							<NavDropdown.Item href='/Game2'>In-Between</NavDropdown.Item>
							<NavDropdown.Item href='/connect-four'>Connect Four</NavDropdown.Item>
							<NavDropdown.Item href='/'>Roll of Cards</NavDropdown.Item>
						</NavDropdown>
					</Nav>
				</Navbar.Collapse>
			</Container>
		</Navbar>
	);
}

export default NavBar;
