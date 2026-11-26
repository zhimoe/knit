// Commit-message memory (docs/02 §3.6, docs/06 §6).
//
// localStorage keyed by repoId; the host never sees the draft in P0.

export interface Draft {
  text: string;
  ts: number;
}

const draftKey = (repoId: string): string => `knit.draft.${repoId}`;
const HISTORY_KEY = 'knit.msgHistory';
const UI_KEY = (repoId: string): string => `knit.ui.${repoId}`;

export const loadDraft = (repoId: string): Draft | null => {
  try {
    const raw = localStorage.getItem(draftKey(repoId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (typeof parsed.text !== 'string' || !parsed.text.trim()) return null;
    return { text: parsed.text, ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now() };
  } catch {
    return null;
  }
};

export const saveDraft = (repoId: string, text: string): void => {
  try {
    if (!text.trim()) {
      localStorage.removeItem(draftKey(repoId));
      return;
    }
    localStorage.setItem(draftKey(repoId), JSON.stringify({ text, ts: Date.now() } satisfies Draft));
  } catch {
    /* storage disabled: drafts simply do not persist */
  }
};

export const clearDraft = (repoId: string): void => {
  try {
    localStorage.removeItem(draftKey(repoId));
  } catch {
    /* ignore */
  }
};

export const pushMessageHistory = (text: string): void => {
  try {
    const list = messageHistory().filter((item) => item !== text);
    list.unshift(text);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 20)));
  } catch {
    /* ignore */
  }
};

export const messageHistory = (): string[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
};

export interface RepoUi {
  diffMode?: 'split' | 'unified';
  ignoreWhitespace?: boolean;
  tab?: string;
}

export const loadUi = (repoId: string): RepoUi => {
  try {
    const parsed = JSON.parse(localStorage.getItem(UI_KEY(repoId)) ?? '{}') as RepoUi;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
};

export const saveUi = (repoId: string, ui: RepoUi): void => {
  try {
    localStorage.setItem(UI_KEY(repoId), JSON.stringify(ui));
  } catch {
    /* ignore */
  }
};
