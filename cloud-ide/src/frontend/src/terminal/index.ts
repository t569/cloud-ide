// frontend/src/terminal/index.ts 

// This is where we will export the terminal component for use

export {TerminalComponent } from './components/Terminal';
export type { TerminalTabs, TerminalSession } from './components/TerminalTabs';
export { WebSocketTransport } from './transport/WebSocketTransport';
export { TerminalEventBus } from './core/TerminalEventBus'
export { FileIconPlugin } from './core/plugins/FileIconPlugin';
export { LinkSnifferPlugin } from './core/plugins/LinkSnifferPluggin';