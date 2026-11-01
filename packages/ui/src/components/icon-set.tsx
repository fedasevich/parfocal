import type { ReactElement, SVGProps } from "react";

type IconShape = { svg: SVGProps<SVGSVGElement>; body: ReactElement };

export const iconSet = {
  select: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: <path d="M5 3l14 7-6 1.8L10.2 19z" />,
  },
  hand: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <path d="M8 12V5.5a1.5 1.5 0 013 0V11m0-6.5V4a1.5 1.5 0 013 0v7m0-5.5a1.5 1.5 0 013 0V12m0-3.5a1.5 1.5 0 013 0V15a6 6 0 01-6 6h-1.5a6 6 0 01-4.6-2.2L4.5 15.4a1.5 1.5 0 012.3-1.9L8 15" />
    ),
  },
  smart: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinejoin: "round",
      strokeLinecap: "round",
    },
    body: (
      <>
        <path d="M9 9l11 5.5-4.7 1.4L13 21z" />
        <path d="M5 2.5v3M3.5 4h3M4 9.5v2M3 10.5h2M9.5 3v2M8.5 4h2" />
      </>
    ),
  },
  auto: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeDasharray="3 2.5" />
        <circle cx="9" cy="10" r="2" />
        <circle cx="15" cy="9" r="1.6" />
        <circle cx="13" cy="15" r="2.2" />
      </>
    ),
  },
  poly: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: (
      <>
        <path d="M4 8l7-4.5 9 5-3 11H7z" />
        <circle cx="4" cy="8" r="1.4" fill="currentColor" />
        <circle cx="11" cy="3.5" r="1.4" fill="currentColor" />
        <circle cx="20" cy="8.5" r="1.4" fill="currentColor" />
      </>
    ),
  },
  free: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: <path d="M5 15c-2-5 3-11 8-10s7 5 5 9-7 5-9 3 1-5 4-4" />,
  },
  rect: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: <rect x="4" y="6" width="16" height="12" rx="1" />,
  },
  ellipse: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: <ellipse cx="12" cy="12" rx="8.5" ry="6.5" />,
  },
  marker: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <circle cx="12" cy="12" r="3.2" fill="currentColor" />
        <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      </>
    ),
  },
  ruler: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: (
      <>
        <path d="M3 16.5L16.5 3 21 7.5 7.5 21z" />
        <path d="M7 12.5l2 2M10 9.5l1.5 1.5M13 6.5l2 2" />
      </>
    ),
  },
  arrow: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M5 19L19 5M10 5h9v9" />,
  },
  text: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: <path d="M5 6V4.5h14V6M12 4.5v15M9 19.5h6" />,
  },
  comment: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: <path d="M4 12a8 8 0 1116 0 8 8 0 01-8 8H4z" />,
  },
  brush: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <path d="M14.5 4.5l5 5-7.5 7.5-5-5zM7 12l-2.5 2.5C3 16 3.5 19 2.5 20.5 5 20.5 8 21 9.5 19.5L12 17" />
    ),
  },
  slides: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <rect x="3" y="4" width="5" height="16" rx="1" />
        <rect x="10" y="4" width="5" height="16" rx="1" />
        <rect x="17" y="4" width="4" height="16" rx="1" />
      </>
    ),
  },
  sun: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" />
      </>
    ),
  },
  sliders: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
        <circle cx="15" cy="6" r="2" />
        <circle cx="9" cy="12" r="2" />
        <circle cx="17" cy="18" r="2" />
      </>
    ),
  },
  gear: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      </>
    ),
  },
  help: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 114 2c-1 .7-1.5 1.2-1.5 2.5M12 17h.01" />
      </>
    ),
  },
  share: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M12 15V3M7.5 7.5L12 3l4.5 4.5M5 13v7h14v-7" />,
  },
  back: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M15 5l-7 7 7 7" />,
  },
  next: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M9 5l7 7-7 7" />,
  },
  popout: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />,
  },
  mouse: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <rect x="6" y="3" width="12" height="18" rx="6" />
        <path d="M12 3v6M6 10h12" />
      </>
    ),
  },
  trackpad: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2.5" />
        <circle cx="10" cy="11" r="1.2" fill="currentColor" />
        <circle cx="14" cy="11" r="1.2" fill="currentColor" />
        <path d="M10 15h4" />
      </>
    ),
  },
  spacemouse: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <ellipse cx="12" cy="18" rx="9" ry="3" />
        <path d="M7 17V11a5 5 0 0110 0v6" />
        <ellipse cx="12" cy="10" rx="5" ry="1.8" />
      </>
    ),
  },
  gamepad: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M7 7h10a5 5 0 015 5.5l-.6 4a2.5 2.5 0 01-4.4 1.2L15 15H9l-2 2.7a2.5 2.5 0 01-4.4-1.2l-.6-4A5 5 0 017 7z" />
        <path d="M7 10v4M5 12h4" />
        <circle cx="16" cy="11" r=".9" fill="currentColor" />
        <circle cx="18" cy="13" r=".9" fill="currentColor" />
      </>
    ),
  },
  keyboard: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <rect x="2.5" y="6" width="19" height="12" rx="2" />
        <path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 13h.01M18 13h.01M8 15.5h8" />
      </>
    ),
  },
  frame: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: <path d="M8 3v18M16 3v18M3 8h18M3 16h18" />,
  },
  close: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: <path d="M6 6l12 12M18 6L6 18" />,
  },
  panel: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M15 4v16" />
      </>
    ),
  },
  home: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: <path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" />,
  },
  down: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M6 9l6 6 6-6" />,
  },
  check: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  },
  warn: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinejoin: "round",
      strokeLinecap: "round",
    },
    body: (
      <>
        <path d="M12 3.5l9.5 16.5h-19z" />
        <path d="M12 10v4.5M12 17.5h.01" />
      </>
    ),
  },
  eye: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  "eye-off": {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M9.9 5.7A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-2.6 3.4M6.3 7.4C3.9 9.2 2.5 12 2.5 12S6 18.5 12 18.5c1.7 0 3.2-.5 4.4-1.2" />
        <path d="M9.9 9.9a3 3 0 004.2 4.2" />
        <path d="M3.5 3.5l17 17" />
      </>
    ),
  },
  plus: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: <path d="M12 5v14M5 12h14" />,
  },
  minus: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: <path d="M5 12h14" />,
  },
  pause: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: <path d="M9 6v12M15 6v12" />,
  },
  undo: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
      </>
    ),
  },
  target: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="12" r="7" />
        <circle cx="12" cy="12" r="2.2" />
        <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5" />
      </>
    ),
  },
  key: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <circle cx="8" cy="15.5" r="4" />
        <path d="M10.9 12.6L19.5 4M16.5 7l2.5 2.5M14 9.5l2 2" />
      </>
    ),
  },
  lock: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 018 0v3" />
      </>
    ),
  },
  unlock: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M8 11V8a4 4 0 017.75-1.4" />
      </>
    ),
  },
  caret: { svg: { fill: "currentColor" }, body: <path d="M9 6l7 6-7 6z" /> },
  pointer: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinejoin: "round",
      strokeLinecap: "round",
    },
    body: (
      <>
        <path d="M12 3v7M8.5 6.5L12 3l3.5 3.5" />
        <circle cx="12" cy="16" r="4.5" />
      </>
    ),
  },
  pinch: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="7" cy="8" r="2.5" />
        <circle cx="17" cy="16" r="2.5" />
        <path d="M9 10l2 2M15 14l-2-2M4 4l1.5 1.5M20 20l-1.5-1.5" />
      </>
    ),
  },
  pen: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: (
      <>
        <path d="M16 3.5l4.5 4.5L9 19.5l-6 1.5 1.5-6z" />
        <path d="M14 5.5l4.5 4.5" />
      </>
    ),
  },
  search: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="11" cy="11" r="6.5" />
        <path d="M16 16l4.5 4.5" />
      </>
    ),
  },
  flag: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: <path d="M5 21V4h11l-2 4 2 4H5" />,
  },
  more: {
    svg: { fill: "currentColor" },
    body: (
      <>
        <circle cx="5.5" cy="12" r="1.7" />
        <circle cx="12" cy="12" r="1.7" />
        <circle cx="18.5" cy="12" r="1.7" />
      </>
    ),
  },
  upload: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M7 18.5H6a4 4 0 01-.6-7.95A6 6 0 0117 8.6a4.5 4.5 0 01.5 8.9H17" />
        <path d="M12 20.5V12M8.8 15L12 11.8 15.2 15" />
      </>
    ),
  },
  file: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: (
      <>
        <path d="M6 3h8l5 5v13H6z" />
        <path d="M14 3v5h5" />
      </>
    ),
  },
  folder: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: (
      <path d="M3 6.5a1.5 1.5 0 011.5-1.5H9l2 2.5h8.5A1.5 1.5 0 0121 9v9.5a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18.5z" />
    ),
  },
  info: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v5.5M12 7.5h.01" />
      </>
    ),
  },
  user: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="8.5" r="3.8" />
        <path d="M4.5 20.5a7.5 7.5 0 0115 0" />
      </>
    ),
  },
  board: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: (
      <>
        <rect x="3.5" y="4" width="17" height="16" rx="2" />
        <path d="M9.2 4v16M14.8 4v16" />
        <path d="M5.6 7.5h1.6M11.2 7.5h1.6M11.2 10.5h1.6M16.8 7.5h1.6" strokeLinecap="round" />
      </>
    ),
  },
  link: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M10 14a4 4 0 005.7 0l3.5-3.5a4 4 0 00-5.7-5.7L12 6.3" />
        <path d="M14 10a4 4 0 00-5.7 0l-3.5 3.5a4 4 0 005.7 5.7l1.5-1.5" />
      </>
    ),
  },
  logout: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M14 4.5H6.5a1 1 0 00-1 1v13a1 1 0 001 1H14" />
        <path d="M10.5 12h10M17 8.5l3.5 3.5-3.5 3.5" />
      </>
    ),
  },
  download: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M12 3.5v11.5M7.5 10.5L12 15l4.5-4.5" />
        <path d="M4.5 16.5v3h15v-3" />
      </>
    ),
  },
  expand: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />,
  },
  "x-circle": {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9 9l6 6M15 9l-6 6" />
      </>
    ),
  },
  "minus-circle": {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M8.5 12h7" />
      </>
    ),
  },
  bell: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M6 16.5V11a6 6 0 0112 0v5.5l1.5 2h-15z" />
        <path d="M10 20.5a2 2 0 004 0" />
      </>
    ),
  },
  clock: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </>
    ),
  },
  calendar: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17M8 3v4M16 3v4" />
      </>
    ),
  },
  users: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <circle cx="9" cy="9" r="3.2" />
        <path d="M3 19c.8-3.2 3.2-5 6-5s5.2 1.8 6 5" />
        <circle cx="17" cy="8" r="2.5" />
        <path d="M16.5 13.2c2.3.2 4 1.7 4.5 4.3" />
      </>
    ),
  },
  mail: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: (
      <>
        <rect x="3" y="5.5" width="18" height="13" rx="2" />
        <path d="M3.5 7l8.5 6.5L20.5 7" />
      </>
    ),
  },
  flask: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M9.5 3.5h5M10.5 3.5v6L4.8 18.4A1.5 1.5 0 006.1 20.5h11.8a1.5 1.5 0 001.3-2.1L13.5 9.5v-6" />
        <path d="M7.5 14.5h9" />
      </>
    ),
  },
  database: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
        <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
      </>
    ),
  },
  list: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" },
    body: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <circle cx="4.5" cy="6" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="12" r="1.2" fill="currentColor" />
        <circle cx="4.5" cy="18" r="1.2" fill="currentColor" />
      </>
    ),
  },
  parfocal: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75 },
    body: (
      <>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.8" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      </>
    ),
  },
  layers: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8z" />
        <path d="M3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
      </>
    ),
  },
  monitor: {
    svg: {
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.75,
      strokeLinecap: "round",
      strokeLinejoin: "round",
    },
    body: (
      <>
        <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
        <path d="M9 20h6M12 16.5V20" />
      </>
    ),
  },
  shield: {
    svg: { fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinejoin: "round" },
    body: <path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z" />,
  },
} satisfies Record<string, IconShape>;

export type IconName = keyof typeof iconSet;

export const iconNames = Object.keys(iconSet) as IconName[];
