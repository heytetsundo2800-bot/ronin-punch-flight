// 画面で使うアイコン（絵文字のかわりの線画。色は文字の色 currentColor）
const S = (body, vb = '0 0 24 24') => `<svg class="ico" viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICON = {
  help: S('<path d="M12 2.5 20.5 7.3v9.4L12 21.5l-8.5-4.8V7.3z"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.4"/><path d="M12 17.1v.1"/>'),
  share: S('<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  install: S('<rect x="6" y="2.5" width="12" height="19" rx="2"/><path d="M12 7v7"/><path d="m9 11.5 3 3 3-3"/><path d="M10.5 18.5h3"/>'),
  online: S('<circle cx="8.5" cy="8" r="3"/><path d="M3 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="16.5" cy="7.5" r="2.4"/><path d="M15.5 13.2c2.8-.4 5 1.3 5.5 4.6"/>'),
  fighter: S('<path d="M12 3.2c3 0 4.8 2.1 4.8 4.9 0 1.7-.6 3-1.6 3.9l1.6 1.4"/><path d="M12 3.2c-3 0-4.8 2.1-4.8 4.9 0 1.7.6 3 1.6 3.9l-1.6 1.4"/><path d="M4.5 21c.7-3.6 3.7-5.8 7.5-5.8s6.8 2.2 7.5 5.8"/><path d="M9.6 8.4h4.8"/>'),
  disc: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3v3.2"/><path d="M19.8 16.5 17 14.9"/><path d="M4.2 16.5 7 14.9"/>'),
  home: S('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h4.5v-5.5h3V20H18V9.5"/>'),
  rank: S('<path d="M4 20V13h4.5v7"/><path d="M9.75 20V8h4.5v12"/><path d="M15.5 20v-9H20v9"/><path d="M3 20.5h18"/>'),
  gear: S('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.4"/>'),
  back: S('<path d="M15 4.5 7.5 12l7.5 7.5"/>'),
  next: S('<path d="m9 4.5 7.5 7.5L9 19.5"/>'),
  close: S('<path d="M6 6l12 12M18 6 6 18"/>'),
  chat: S('<path d="M4 5.5h16v10H11l-5 4v-4H4z"/><path d="M8 10.5h.1M12 10.5h.1M16 10.5h.1"/>'),
  copy: S('<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>'),
  play: S('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  shuffle: S('<path d="M3 7h3.5c4 0 5.5 10 9.5 10H21"/><path d="M3 17h3.5c1.6 0 2.6-1.4 3.5-3.2"/><path d="M14.2 8.5C15 7.6 15.6 7 16.8 7H21"/><path d="m18 4 3 3-3 3"/><path d="m18 14 3 3-3 3"/>'),
  sakura: S('<path d="M12 11.2c-1.6-1.8-2-4.3-.6-6.7l.6.9.6-.9c1.4 2.4 1 4.9-.6 6.7Z"/><path d="M12.8 11.9c2.4-.4 4.6.6 5.8 3.1l-1-.1.4 1c-2.7.4-4.8-.7-5.6-3Z"/><path d="M11.2 11.9c-2.4-.4-4.6.6-5.8 3.1l1-.1-.4 1c2.7.4 4.8-.7 5.6-3Z"/><path d="M12 13.4v6.6"/>'),
  campus: S('<path d="M9 21V9.5L12 5l3 4.5V21"/><circle cx="12" cy="12" r="1.8"/><path d="M4 21V14h5M15 14h5v7"/><path d="M3 21h18"/>'),
  trophy: S('<path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0z"/><path d="M7.5 6H4.5a3 3 0 0 0 3 3.5M16.5 6h3a3 3 0 0 1-3 3.5"/><path d="M12 13.5V17M8.5 20.5h7M9.5 17h5v3.5h-5z"/>'),
  friend: S('<circle cx="9.5" cy="8" r="3.2"/><path d="M3.5 20c.6-3.4 3-5.6 6-5.6s5.4 2.2 6 5.6"/><path d="M18.5 8v6M15.5 11h6"/>'),
  sound: S('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  phoneRotate: S('<rect x="7" y="3" width="10" height="18" rx="2"/><path d="M10.5 18h3"/><path d="M20.5 9.5a8.5 8.5 0 0 0-3.4-5.6"/><path d="m21 6.3-.5 3.3-3.2-.8"/>'),
  touch: S('<circle cx="12" cy="12" r="3.4" fill="currentColor"/><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="10.4" opacity=".45"/>'),
  check: S('<path d="m4.5 12.5 4.8 4.8L19.5 7"/>'),
  up: S('<path d="m5 15 7-7 7 7"/>'),
  line: S('<path d="M12 4c5 0 9 3.1 9 7 0 3.4-3.1 6.3-7.3 6.9-.6.1-.9.3-1 .8l-.3 1.6c-.1.5-.6.7-1 .4C7 18.8 3 15.4 3 11c0-3.9 4-7 9-7Z"/>'),
  menu: S('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  lock: S('<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  account: S('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20.5c.9-3.6 3.9-5.8 7.5-5.8s6.6 2.2 7.5 5.8"/>'),
  bug: S('<rect x="7.5" y="7.5" width="9" height="12" rx="4.5"/><path d="M9.5 7.5a2.5 2.5 0 0 1 5 0"/><path d="M3.5 13h4M16.5 13h4M4.5 8.5l3 1.5M19.5 8.5l-3 1.5M4.5 18l3-1.5M19.5 18l-3-1.5M12 11v8.5"/>'),
  bolt: S('<path d="M13 2.5 5 13.5h6l-1 8 8-11h-6z"/>'),
  star: S('<path d="m12 3.2 2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z"/>'),
  refresh: S('<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>'),
  iosShare: S('<path d="M12 3v11"/><path d="m8 7 4-4 4 4"/><path d="M8 10H6v10h12V10h-2"/>'),
  exit: S('<path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>'),
  // v1.7：訓練場（的）・ルール（本）
  target: S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>'),
  book: S('<path d="M4 5.5c2.6-1 5.3-1 8 .8 2.7-1.8 5.4-1.8 8-.8v13c-2.6-1-5.3-1-8 .8-2.7-1.8-5.4-1.8-8-.8z"/><path d="M12 6.3v13"/>'),
};

export function stageIcon(k) {
  return k === 'sakura' ? ICON.sakura : k === 'campus' ? ICON.campus : ICON.shuffle;
}
