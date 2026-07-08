// The IDE page: composes the editor workspace for a booted session. Page-level
// chrome (breadcrumbs, resume banners, etc.) can wrap the editor here later.
import React from 'react';
import { EditorWorkspace } from '../editor';
import type { WorkspaceSession } from '../editor';

interface IDEWorkspaceProps {
  session: WorkspaceSession;
}

export default function IDEWorkspace({ session }: IDEWorkspaceProps) {
  return <EditorWorkspace session={session} />;
}
