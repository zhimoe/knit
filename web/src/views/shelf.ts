import type { ShelfItem } from '../types';
import { icon } from './icons';
import { esc } from './util';

export const renderShelf = (items: ShelfItem[]): string => `
  <div class="aux-head">
    ${icon('layers')}
    <span class="aux-title">Shelf · 暂存补丁箱</span>
    <span class="aux-sub">存在 .git/knit/shelf/，不污染 reflog</span>
    <span class="spacer"></span>
    <button class="btn primary" type="button" data-act="shelfsave">${icon('file-plus')} 保存当前改动</button>
    <button class="btn" type="button" data-act="shelfimport">导入 patch…</button>
  </div>
  <div class="aux-scroll" id="shelfList">${
    items.length
      ? items
          .map(
            (item) => `<div class="shelf-row">
              <span class="shelf-kind ${item.kind === 'stash' ? 'stash' : ''}">${esc(item.kind)}</span>
              <div class="shelf-info">
                <div class="shelf-name">${esc(item.name)}</div>
                <div class="shelf-sub">${esc(item.subtitle)}</div>
              </div>
              <button class="btn" type="button" data-shelfstat="${esc(item.id)}" data-popover-trigger="1">查看差异</button>
              <button class="btn primary" type="button" data-shelfapply="${esc(item.id)}">应用</button>
              <button class="btn danger" type="button" data-shelfdrop="${esc(item.id)}" title="删除">${icon('trash')}</button>
            </div>`,
          )
          .join('')
      : `<div class="cv-clean-state">${icon('layers')}<strong>Shelf 是空的</strong><span>可以把当前未提交改动存为补丁文件，或从外部导入 .patch 文件。</span></div>`
  }</div>`;
