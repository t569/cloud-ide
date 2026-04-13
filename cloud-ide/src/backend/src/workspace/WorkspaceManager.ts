// backend/src/workspace/WorkspaceManager.ts : chokidar daemon

// TODO: write this pipeline


import path from 'node:path';
import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';


export class WorkspaceManager extends EventEmitter { }