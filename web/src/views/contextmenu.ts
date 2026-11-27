import type { ContextMenuItem } from '../types';
import { icon } from './icons';
import { esc } from './util';

export function renderContextMenu(items: ContextMenuItem[]): string {
  return items
    .map((item) => {
      if (item.divider) return `<div class="ctx-divider" role="separator"></div>`;
      return `
        <button class="ctx-item${item.danger ? ' danger' : ''}" type="button"
          data-ctx-id="${esc(item.id)}" ${item.disabled ? 'disabled' : ''} role="menuitem">
          <span class="ctx-ico">${item.icon ? icon(item.icon) : ''}</span>
          <span class="ctx-label">${esc(item.label ?? '')}</span>
          ${item.shortcut ? `<kbd class="ctx-kbd">${esc(item.shortcut)}</kbd>` : ''}
        </button>`;
    })
    .join('');
}

export function mountContextMenu(
  items: ContextMenuItem[],
  x: number,
  y: number,
  onSelect: (id: string) => void,
): () => void {
  const root = document.getElementById('contextMenuRoot');
  if (!root) return () => undefined;

  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = renderContextMenu(items);
  root.innerHTML = '';
  root.appendChild(menu);

  const rect = menu.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, x));
  const top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, y));
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;

  const close = (): void => {
    root.innerHTML = '';
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', close);
    window.removeEventListener('blur', close);
  };

  const onDocDown = (e: MouseEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && target.closest('.ctx-menu')) return;
    close();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  menu.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement | null)?.closest<HTMLButtonElement>('[data-ctx-id]');
    if (!target || target.disabled) return;
    const id = target.dataset.ctxId ?? '';
    close();
    if (id) onSelect(id);
  });

  document.addEventListener('mousedown', onDocDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', close);
  window.addEventListener('blur', close);

  return close;
}
