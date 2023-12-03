// stellar.js

import StellarSdk from "stellar-sdk";

StellarSdk.Network.useTestNetwork();
const server = new StellarSdk.Server("https://horizon-testnet.stellar.org");

export { StellarSdk, server };
