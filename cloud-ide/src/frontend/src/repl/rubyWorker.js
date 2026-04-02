// src/rubyWorker.js
import { DefaultRubyVM } from "https://cdn.jsdelivr.net/npm/@ruby/wasm-wasi@2.1.2/dist/browser/+esm";

let vm;
let isReady = false;
let codeBuffer = "";

// The Ruby WASI shim automatically routes `puts` and `print` to console.log!
// We intercept it exactly like we did in JavaScript.
console.log = (...args) => {
  const output = args.map(a => String(a)).join(" ");
  self.postMessage({ type: 'STDOUT', payload: output + '\r\n' });
};
console.error = (...args) => {
  const output = args.map(a => String(a)).join(" ");
  self.postMessage({ type: 'ERROR', payload: output + '\r\n' });
};

async function init() {
  self.postMessage({ type: 'SYSTEM', payload: 'Downloading Ruby WASM environment (this may take a moment)...\r\n' });
  try {
    const response = await fetch("https://cdn.jsdelivr.net/npm/@ruby/3.2-wasm-wasi@2.1.2/dist/ruby+stdlib.wasm");
    const module = await WebAssembly.compileStreaming(response);
    const result = await DefaultRubyVM(module);
    
    vm = result.vm;
    isReady = true;
    
    self.postMessage({ type: 'SYSTEM', payload: 'Ruby ready.\r\n' });
    self.postMessage({ type: 'PROMPT' });
  } catch (err) {
    self.postMessage({ type: 'ERROR', payload: 'Failed to load Ruby: ' + err.message + '\r\n' });
  }
}

init();

self.onmessage = async (event) => {
  if (event.data.type === 'SYNC_FILES') return; 

  if (event.data.type === 'RUN') {
    if (!isReady) {
      self.postMessage({ type: 'ERROR', payload: 'Ruby is still loading...\r\n' });
      self.postMessage({ type: 'PROMPT' });
      return;
    }

    let code = event.data.payload;

    // Handle multiline Ruby blocks
    if (codeBuffer.length > 0) {
      if (code.trim() === "") {
        code = codeBuffer;
        codeBuffer = ""; 
      } else {
        codeBuffer += code + "\n";
        self.postMessage({ type: 'PROMPT_MULTI' });
        return;
      }
    } else if (["do", "def", "class", "if"].some(keyword => code.trim().endsWith(keyword))) {
      codeBuffer = code + "\n";
      self.postMessage({ type: 'PROMPT_MULTI' });
      return;
    }

    try {
      const result = vm.eval(code);
      const output = result.toString();
      
      // Mimic IRB standard formatting
      if (output !== "" && output !== "nil") {
        self.postMessage({ type: 'STDOUT', payload: "=> " + output + '\r\n' });
      }
    } catch (err) {
      self.postMessage({ type: 'ERROR', payload: err.message + '\r\n' });
      codeBuffer = ""; 
    }
    self.postMessage({ type: 'PROMPT' });
  }
};