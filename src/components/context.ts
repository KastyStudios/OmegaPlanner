import { createContext, useContext } from 'react';
import type { Item, ItemKind } from '../db/schema';
import type { Occurrence } from '../domain/recurrence';
import type { EditScope } from '../domain/seriesEdit';
import type { PlannerData } from '../hooks/usePlanner';

export interface EditorDefaults {
  kind?: ItemKind;
  start?: Date;
  end?: Date;
  allDay?: boolean;
  scheduled?: boolean;
  goalId?: string;
  categoryId?: string;
}

export interface EditorRequest {
  item?: Item;
  occurrence?: Occurrence;
  defaults?: EditorDefaults;
}

export interface AppContextValue {
  data: PlannerData;
  openEditor: (req?: EditorRequest) => void;
  askScope: (action: 'edit' | 'delete', allowThis: boolean) => Promise<EditScope | null>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}
