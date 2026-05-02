// frontend/src/editor/context/WorkspaceContext.tsx
import React, { createContext, useReducer, useContext } from 'react';
import { SyncStatus, OpenFileContext } from '../types/editor';

// --- STATE & ACTIONS ---
interface WorkspaceState {
  activeFilePath: string | null;
  openFiles: OpenFileContext[];
  syncStatus: SyncStatus;
}

type WorkspaceAction =
  | { type: 'OPEN_FILE'; payload: { path: string } }
  | { type: 'CLOSE_FILE'; payload: { path: string } }
  | { type: 'SET_ACTIVE_FILE'; payload: { path: string } }
  | { type: 'MARK_DIRTY'; payload: { path: string; isDirty: boolean } }
  | { type: 'SET_SYNC_STATUS'; payload: { status: SyncStatus } };

const initialState: WorkspaceState = {
  activeFilePath: null,
  openFiles: [],
  syncStatus: 'synced',
};

// --- REDUCER ---
function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'OPEN_FILE': {
      const exists = state.openFiles.find(f => f.path === action.payload.path);
      if (exists) return { ...state, activeFilePath: action.payload.path };
      return {
        ...state,
        openFiles: [...state.openFiles, { path: action.payload.path, isDirty: false }],
        activeFilePath: action.payload.path,
      };
    }
    case 'CLOSE_FILE': {
      const remaining = state.openFiles.filter(f => f.path !== action.payload.path);
      const newActive = state.activeFilePath === action.payload.path 
        ? (remaining[remaining.length - 1]?.path || null) 
        : state.activeFilePath;
      return { ...state, openFiles: remaining, activeFilePath: newActive };
    }
    case 'SET_ACTIVE_FILE':
      return { ...state, activeFilePath: action.payload.path };
    case 'MARK_DIRTY':
      return {
        ...state,
        openFiles: state.openFiles.map(f => 
          f.path === action.payload.path ? { ...f, isDirty: action.payload.isDirty } : f
        )
      };
    case 'SET_SYNC_STATUS':
      return { ...state, syncStatus: action.payload.status };
    default:
      return state;
  }
}

// --- CONTEXT & HOOK ---
const WorkspaceContext = createContext<{
  state: WorkspaceState;
  dispatch: React.Dispatch<WorkspaceAction>;
} | null>(null);

export const WorkspaceProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(workspaceReducer, initialState);
  return (
    <WorkspaceContext.Provider value={{ state, dispatch }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within WorkspaceProvider');
  return context;
};