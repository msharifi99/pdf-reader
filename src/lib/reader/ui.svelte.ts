/** Reader-local UI state shared by the view, its panels and the commands. */
import type { Locator, Rect } from '../engines/types';
import { settings } from '../stores/settings.svelte';

export type SidebarTab = 'toc' | 'pages';

export interface FootnoteState {
  html: string;
  /** anchor rect of the note reference, stage coordinates */
  rect: Rect;
  target?: Locator;
}

export class ReaderUi {
  sidebar = $state<SidebarTab | null>(null);
  footnote = $state.raw<FootnoteState | null>(null);
  typographyOpen = $state(false);
  viewOpen = $state(false);
  /** focus requests for the sidebar list (bumped when opened from the keyboard) */
  sidebarFocusRev = $state(0);

  get sidebarWidth(): number {
    return settings.value.reader.sidebarWidth;
  }
  setSidebarWidth(px: number): void {
    settings.update('reader', (r) => ({ ...r, sidebarWidth: Math.round(Math.min(520, Math.max(220, px))) }));
  }

  toggleSidebar(tab: SidebarTab): void {
    if (this.sidebar === tab) this.sidebar = null;
    else {
      this.sidebar = tab;
      this.sidebarFocusRev++;
      if (settings.value.reader.sidebarTab !== tab) settings.update('reader', (r) => ({ ...r, sidebarTab: tab }));
    }
  }
}
