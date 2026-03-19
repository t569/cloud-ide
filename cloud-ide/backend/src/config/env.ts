// backend/src/config/env.ts

// this file has all our env data

// backend/src/config/env.ts

// this file has all our env data
import dotenv from 'dotenv';

// Load the .env file immediately when this file is imported
dotenv.config();
 // Safely check if 'window' exists before checking the protocol
    const IS_SECURE = typeof window !== 'undefined' && window.location.protocol === 'https:';


// Export a single, strictly-typed configuration object
export const config = {
  PORT: process.env.PORT || 3000,

  // You can construct the full URLs right here so the rest of the app doesn't have to
  OPENSANDBOX_API_URL: `${IS_SECURE ? 'https' : 'http'}${process.env.OPENSANDBOX_API_URL || 'localhost:8080'}`,
  BACKEND_API_URL: `${IS_SECURE ? 'https' : 'http'}${process.env.IDE_BACKEND_API_URL || 'localhost:3000'}`
};