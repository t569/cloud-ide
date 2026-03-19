// frontend/src/api/buildStream.ts

/**
 * Sends the environment config to the backend and streams the Docker build logs
 * directly into the provided xterm.js terminal instance.
 * * @param newEnv The complete EnvironmentRecord object to build
 * @param terminal The active xterm.js Terminal instance (e.g., from a useRef)
 */
import { API_BASE_URL } from "../config/env";


export const streamDockerBuild = async (newEnv: any, terminal: any): Promise<void> => {
  try {
    // 1. Initiate the POST request
    const response = await fetch(`${API_BASE_URL}/environment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newEnv),
    });

    // Fallback if the backend instantly rejected the config (e.g., 400 Bad Request)
    if (!response.ok && !response.body) {
      const errorData = await response.json();
      terminal.write(`\r\n\x1b[31m[API Error]\x1b[0m ${errorData.error}\r\n`);
      return;
    }

    // 2. Grab the raw byte stream reader
    if (!response.body) {
      throw new Error('ReadableStream not supported by this browser.');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');

    // 3. The Stream Loop
    while (true) {
      // Wait for the next chunk of data from the Node.js server
      const { done, value } = await reader.read();

      if (done) {
        // The server called res.end()
        break; 
      }

      // 4. Decode the bytes into text and pipe it straight to the UI
      // { stream: true } ensures multi-byte characters aren't split incorrectly across chunks
      const textChunk = decoder.decode(value, { stream: true });
      terminal.write(textChunk); 
    }

  } catch (error: any) {
    terminal.write(`\r\n\x1b[31m[Network Error]\x1b[0m Connection lost: ${error.message}\r\n`);
  }
};