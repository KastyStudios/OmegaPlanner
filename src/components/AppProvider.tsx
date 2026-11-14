import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { EditScope } from '../domain/seriesEdit';
import { usePlannerData } from '../hooks/usePlanner';
import { AppContext, type AppContextValue, type EditorRequest } from './context';
import { EditScopeDialog, type ScopeRequest } from './EditScopeDialog';
import { ItemEditor } from './ItemEditor';

export function AppProvider({ children }: { children: ReactNode }) {
  const data = usePlannerData();
  const [editor, setEditor] = useState<EditorRequest | null>(null);
  const [scopeReq, setScopeReq] = useState<ScopeRequest | null>(null);

  const openEditor = useCallback((req: EditorRequest = {}) => setEditor(req), []);
  const askScope = useCallback(
    (action: 'edit' | 'delete', allowThis: boolean) =>
      new Promise<EditScope | null>((resolve) =>
        setScopeReq({
          action,
          allowThis,
          resolve: (s) => {
            setScopeReq(null);
            resolve(s);
          },
        }),
      ),
    [],
  );

  // Keyboard shortcut: "n" opens a new item (when not typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      setEditor({});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const value = useMemo<AppContextValue | null>(
    () => (data ? { data, openEditor, askScope } : null),
    [data, openEditor, askScope],
  );

  if (!value) {
    return <div className="flex h-screen items-center justify-center text-slate-400">Loading…</div>;
  }
  return (
    <AppContext.Provider value={value}>
      {children}
      {editor && <ItemEditor key={editor.item?.id ?? 'new'} request={editor} onClose={() => setEditor(null)} />}
      {scopeReq && <EditScopeDialog request={scopeReq} />}
    </AppContext.Provider>
  );
}
