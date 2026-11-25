import type { IconName } from './icons';

export type MenuAction = {
  type?: 'item';
  id: string;
  label: string;
  icon?: IconName;
  /** display only, e.g. the Command's current binding */
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  /** present (true/false) => menuitemcheckbox */
  checked?: boolean;
  /** call a Command here: () => commands.execute('reader.zoomIn') */
  onselect?: () => void;
};
export type MenuItem = MenuAction | { type: 'separator' } | { type: 'label'; label: string };

export const isAction = (i: MenuItem): i is MenuAction => i.type === undefined || i.type === 'item';
