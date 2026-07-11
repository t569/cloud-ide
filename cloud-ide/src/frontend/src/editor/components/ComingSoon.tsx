// A quiet placeholder for sidebar panels that aren't built yet, so selecting one in
// the activity bar shows an intentional state instead of a blank void.
import React from 'react';

interface ComingSoonProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export const ComingSoon = ({ icon, title, description }: ComingSoonProps) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center animate-fade-in">
    <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-ide-border bg-ide-hover/40 text-ide-muted">
      {icon}
    </div>
    <div>
      <p className="text-[13px] font-semibold text-ide-text">{title}</p>
      <p className="mx-auto mt-1 max-w-[15rem] text-[12px] leading-relaxed text-ide-muted">{description}</p>
    </div>
    <span className="rounded-full border border-ide-border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-ide-muted">
      In the works
    </span>
  </div>
);
