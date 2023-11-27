import axios from 'axios';

// Create an Axios instance with default configuration
const api = axios.create({
  baseURL: 'https://horizon-testnet.stellar.org/', // Your API server address
  // You can add other default configurations here if needed
});

export default api;
