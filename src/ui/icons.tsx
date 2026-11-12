// Inline SVG icons (stroke style, 24 px grid). No icon font or network needed.
import type { ReactNode, SVGProps } from 'react';

function Svg({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const IconBack = (p: P) => (
  <Svg {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Svg>
);
export const IconMore = (p: P) => (
  <Svg {...p}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" />
  </Svg>
);
export const IconPlus = (p: P) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconMinus = (p: P) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
);
export const IconClose = (p: P) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const IconCheck = (p: P) => (
  <Svg {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);
export const IconAlert = (p: P) => (
  <Svg {...p}>
    <path d="M12 4l9 16H3z" />
    <path d="M12 10v4M12 17.2v.3" />
  </Svg>
);
export const IconDownload = (p: P) => (
  <Svg {...p}>
    <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
  </Svg>
);
export const IconImport = (p: P) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
    <path d="M14 3v5h5M12 11v6M9.5 14.5L12 17l2.5-2.5" />
  </Svg>
);
export const IconMap = (p: P) => (
  <Svg {...p}>
    <path d="M9 4L3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5z" />
    <path d="M9 4v13.5M15 6.5V20" />
  </Svg>
);
export const IconStorage = (p: P) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
  </Svg>
);
export const IconSettings = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
  </Svg>
);
export const IconHelp = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.2-1.5 2.3M12 17v.3" />
  </Svg>
);
/** Location arrow: outline when off, filled when following. */
export const IconLocate = ({ filled, ...p }: P & { filled?: boolean }) => (
  <Svg {...p}>
    <path d="M20 4L3.5 11l7 2.5L13 20.5z" fill={filled ? 'currentColor' : 'none'} />
  </Svg>
);
export const IconCompass = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15.5 8.5l-2 5-5 2 2-5z" fill="currentColor" />
  </Svg>
);
export const IconNorth = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l4 9H8z" fill="currentColor" />
    <path d="M12 21l-4-9h8z" />
  </Svg>
);
export const IconFit = (p: P) => (
  <Svg {...p}>
    <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
  </Svg>
);
export const IconChevronUp = (p: P) => (
  <Svg {...p}>
    <path d="M6 15l6-6 6 6" />
  </Svg>
);
export const IconChevronDown = (p: P) => (
  <Svg {...p}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const IconChevronRight = (p: P) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
);
export const IconTrash = (p: P) => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6" />
  </Svg>
);
export const IconShare = (p: P) => (
  <Svg {...p}>
    <path d="M12 15V3M8 7l4-4 4 4M6 11H5a1 1 0 00-1 1v8a1 1 0 001 1h14a1 1 0 001-1v-8a1 1 0 00-1-1h-1" />
  </Svg>
);
export const IconArea = (p: P) => (
  <Svg {...p}>
    <rect x="5" y="5" width="14" height="14" rx="1" strokeDasharray="3 2.5" />
    <circle cx="5" cy="5" r="1.6" fill="currentColor" />
    <circle cx="19" cy="5" r="1.6" fill="currentColor" />
    <circle cx="5" cy="19" r="1.6" fill="currentColor" />
    <circle cx="19" cy="19" r="1.6" fill="currentColor" />
  </Svg>
);
export const IconWifiOff = (p: P) => (
  <Svg {...p}>
    <path d="M3 3l18 18M8.5 16.5a5 5 0 017 0M5 13a10 10 0 014-2.4M19 13a10 10 0 00-5.5-2.8M2 9.5a15 15 0 014-3M22 9.5A15 15 0 0010.5 5.6" />
    <circle cx="12" cy="20" r="1" fill="currentColor" />
  </Svg>
);
export const IconMountain = (p: P) => (
  <Svg {...p}>
    <path d="M3 19l6-11 4 6 2-3 6 8z" />
  </Svg>
);
