// frontend/src/terminal/dev/__tests__/DevTransport.test.ts
import { DevTransport } from '../frontend/src/terminal/dev/DevTransport';

describe('DevTransport (Mock PTY)', () => {
  let transport: DevTransport;
  let mockXtermCallback: jest.Mock;

  beforeEach(() => {
    transport = new DevTransport();
    mockXtermCallback = jest.fn();
    transport.onData(mockXtermCallback);
  });

  it('should echo standard typed characters', () => {
    transport.write('a');
    transport.write('b');
    transport.write('c');

    expect(mockXtermCallback).toHaveBeenCalledWith('a');
    expect(mockXtermCallback).toHaveBeenCalledWith('b');
    expect(mockXtermCallback).toHaveBeenCalledWith('c');
  });

  it('should send the \\b \\b erasure sequence on backspace', () => {
    // Type a character first so the buffer isn't empty
    transport.write('a'); 
    
    // Simulate pressing backspace
    transport.write('\x7f'); 

    // The transport should tell the UI to move back, write a space, and move back again
    expect(mockXtermCallback).toHaveBeenCalledWith('\b \b');
  });

  it('should safely ignore backspace if the buffer is empty', () => {
    transport.write('\x7f'); 
    
    // It should NOT broadcast the erasure sequence if there's nothing to erase
    expect(mockXtermCallback).not.toHaveBeenCalledWith('\b \b');
  });
});