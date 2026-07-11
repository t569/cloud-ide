import React, { useEffect, useMemo } from 'react';
import { WorkspaceSession } from '../types/editor';

import { EditorTabs } from './EditorTabs';
import { StatusBar } from './StatusBar';
import { TopNavBar } from './TopNavBar';
import { ActivityBar } from './ActivityBar';
import { FileExplorer } from './FileExplorer';
import { MonacoEditorWrapper } from './MonacoEditorWrapper';
import { CommandPalette } from './CommandPalette';
import { IDETerminal } from './IDETerminal';
import { ComingSoon } from './ComingSoon';
import { VscSearch, VscExtensions, VscSettingsGear } from 'react-icons/vsc';

import { DesignSystemProvider, useDesignSystem } from '../context/DesignSystemContext';
import { WorkspaceProvider, useWorkspace } from '../context/WorkspaceContext';

import { ContributionRegistry } from '../core/ContributionRegistry';
import { coreContributions } from '../contrib/coreContributions';

import { useWorkspaceBootstrap } from '../hooks/useWorkspaceBootstrap';
import { useWorkspaceLayout } from '../hooks/useWorkspaceLayout';
import { startPanelDrag } from '../hooks/usePanelResize';

interface EditorWorkspaceProps {
  session: WorkspaceSession;
}

// ==========================================
// INNER COMPONENT (inside the Workspace/DesignSystem providers)
// ==========================================
const EditorWorkspaceInner = ({ session }: EditorWorkspaceProps) => {
  const { sandboxId } = session;
  const { state: workspaceState, dispatch } = useWorkspace();
  const { settings } = useDesignSystem();

  // Non-visual engines: bus, VFS controller, LSP registry, live file tree.
  const { eventBus, fileTree, langRegistry } = useWorkspaceBootstrap(sandboxId);

  // Layout + per-sandbox persistence + drag resizing.
  const { layout, toggleSidebar, setSidebarWidth, setBottomPanelHeight } =
    useWorkspaceLayout(sandboxId);

  // Menus + activity items come from plugins (core built-ins first).
  const { menus, activityItems } = useMemo(() => {
    const reg = ContributionRegistry.from([coreContributions, ...(session.plugins ?? [])]);
    return { menus: reg.getMenus(), activityItems: reg.getActivityItems() };
  }, [session.plugins]);

  // Seed the workspace name from the session, when the host provided one.
  useEffect(() => {
    if (session.workspaceName) {
      dispatch({ type: 'SET_WORKSPACE_NAME', payload: { name: session.workspaceName } });
    }
  }, [session.workspaceName, dispatch]);

  // Derive the active file for Monaco.
  const activeFile =
    workspaceState.openFiles.find((f) => f.path === workspaceState.activeFilePath) || null;

  return (
    <div className="h-screen w-screen flex flex-col bg-ide-bg text-ide-text font-sans overflow-hidden">
      {/* Quick-open overlay (Ctrl+P). Bus-driven; renders nothing until opened. */}
      <CommandPalette files={fileTree} eventBus={eventBus} />

      {/* ZONE 1: TOP NAVIGATION */}
      <TopNavBar
        menus={menus}
        activeFilePath={workspaceState.activeFilePath}
        workspaceName={workspaceState.workspaceName}
        eventBus={eventBus}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* ZONE 2: ACTIVITY BAR */}
        <ActivityBar
          items={activityItems}
          activePanel={layout.sidebarOpen ? layout.activeSidebarPanel : null}
          onPanelSelect={toggleSidebar}
          syncStatus={workspaceState.syncStatus}
        />

        {/* ZONE 3: SIDEBAR & HORIZONTAL RESIZER */}
        {layout.sidebarOpen && (
          <>
            <div
              style={{ width: `${layout.sidebarWidth}px` }}
              className="flex flex-col flex-shrink-0 bg-ide-panel border-r border-ide-border overflow-hidden"
            >
              {layout.activeSidebarPanel === 'explorer' && (
                <FileExplorer
                  workspaceName={workspaceState.workspaceName}
                  files={fileTree}
                  activeFilePath={workspaceState.activeFilePath}
                  eventBus={eventBus}
                />
              )}
              {layout.activeSidebarPanel === 'search' && (
                <ComingSoon
                  icon={<VscSearch size={20} />}
                  title="Search"
                  description="Full-text search across your workspace files is on the way."
                />
              )}
              {layout.activeSidebarPanel === 'plugins' && (
                <ComingSoon
                  icon={<VscExtensions size={20} />}
                  title="Plugins"
                  description="Browse and manage editor extensions. Not available yet."
                />
              )}
              {layout.activeSidebarPanel === 'settings' && (
                <ComingSoon
                  icon={<VscSettingsGear size={20} />}
                  title="Settings"
                  description="Editor and workspace preferences will live here soon."
                />
              )}
            </div>

            {/* Sidebar resizer handle */}
            <div
              onMouseDown={(e) =>
                startPanelDrag(e, {
                  axis: 'x',
                  initial: layout.sidebarWidth,
                  min: 150,
                  max: 600,
                  onResize: setSidebarWidth,
                })
              }
              className="w-2 cursor-col-resize bg-ide-border hover:bg-ide-accent z-50 transition-colors shrink-0"
            />
          </>
        )}

        <div className="flex-1 flex flex-col min-w-0 bg-ide-bg">
          {/* ZONE 4: EDITOR SURFACE */}
          <div className="flex-1 flex flex-col overflow-hidden relative">
            <EditorTabs
              activeFilePath={workspaceState.activeFilePath}
              openFiles={workspaceState.openFiles}
              eventBus={eventBus}
            />
            <div className="flex-1 relative">
              <MonacoEditorWrapper
                activeFile={activeFile}
                globalSettings={settings}
                eventBus={eventBus}
                registry={langRegistry}
              />
            </div>
          </div>

          {/* ZONE 5: TERMINAL & VERTICAL RESIZER */}
          {layout.bottomPanelOpen && (
            <>
              {/* Terminal resizer handle — invert: dragging the top edge up grows it. */}
              <div
                onMouseDown={(e) =>
                  startPanelDrag(e, {
                    axis: 'y',
                    initial: layout.bottomPanelHeight,
                    min: 100,
                    max: 800,
                    invert: true,
                    onResize: setBottomPanelHeight,
                  })
                }
                className="h-2 cursor-row-resize bg-ide-border hover:bg-ide-accent z-50 transition-colors shrink-0"
              />

              <div
                style={{ height: `${layout.bottomPanelHeight}px` }}
                className="bg-ide-panel flex flex-col flex-shrink-0"
              >
                <IDETerminal sandboxId={sandboxId} editorEventBus={eventBus} />
              </div>
            </>
          )}

          {/* ZONE 6: STATUS BAR. ponytail: cursor/formatting/git are still mock —
              real wiring is a separate feature (see REFACTOR.md deferred list). */}
          <StatusBar
            settings={settings}
            cursor={{ line: 5, column: 36 }}
            formatting={{ eol: 'LF', encoding: 'UTF8', indentMode: 'spaces', indentSize: 2 }}
            git={{ branch: 'main', hasChanges: false }}
          />
        </div>
      </div>
    </div>
  );
};

// ==========================================
// EXPORTED WRAPPER (injects the providers)
// ==========================================
export const EditorWorkspace = (props: EditorWorkspaceProps) => (
  <DesignSystemProvider>
    <WorkspaceProvider>
      <EditorWorkspaceInner {...props} />
    </WorkspaceProvider>
  </DesignSystemProvider>
);
