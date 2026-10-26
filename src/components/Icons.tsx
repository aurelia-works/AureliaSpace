import type { SVGProps } from "react";

const base = (props: SVGProps<SVGSVGElement>) => ({
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...props,
});

export const SplitRightIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M8 2.5v11" /></svg>
);
export const SingleIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /></svg>
);
export const SplitDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M2 8h12" /></svg>
);
export const MicIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="6" y="1.8" width="4" height="7" rx="2" /><path d="M3.5 7.5a4.5 4.5 0 009 0M8 12v2.2" /></svg>
);
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>
);
export const BellIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 11.5V7a4 4 0 018 0v4.5l1 1H3z" /><path d="M6.6 14a1.5 1.5 0 002.8 0" /></svg>
);
export const SparkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 1.8l1.5 4.2 4.3 1.6-4.3 1.6L8 13.4 6.5 9.2 2.2 7.6l4.3-1.6z" /></svg>
);
export const ThermometerIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6.5 9.4V3.5a1.5 1.5 0 013 0v5.9a3 3 0 11-3 0z" /><path d="M8 6v5" /></svg>
);
export const PanelIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M10 2.5v11" /></svg>
);
export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <path d="M6.9 1.6h2.2l.35 1.75 1.1.46 1.5-1 1.55 1.55-1 1.5.46 1.1 1.75.35v2.2l-1.75.35-.46 1.1 1 1.5-1.55 1.55-1.5-1-1.1.46-.35 1.75H6.9l-.35-1.75-1.1-.46-1.5 1-1.55-1.55 1-1.5-.46-1.1L1.2 9.1V6.9l1.75-.35.46-1.1-1-1.5L3.96 2.4l1.5 1 1.1-.46z" />
    <circle cx="8" cy="8" r="2.1" />
  </svg>
);
export const CopyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="5" y="5" width="8.5" height="8.5" rx="1.5" /><path d="M3 10.5V3.8C3 3.1 3.6 2.5 4.3 2.5H10.5" /></svg>
);
export const RerunIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M13 8a5 5 0 1 1-1.6-3.7" /><path d="M13 2.5v3h-3" /></svg>
);
export const TerminalIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 4.5l3.5 3.5L3 11.5M8.5 12h4.5" /></svg>
);
export const PinIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M10.5 2.5l3 3-2.2 1.1-2.6 2.6.4 2.8-1 1-2.6-2.6L3 13l2.5-3.5L2.9 6.9l1-1 2.8.4 2.6-2.6z" /></svg>
);
export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" /></svg>
);
export const OpenIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" /></svg>
);
export const FolderIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M2 4.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z" /></svg>
);
export const GridIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M8 2.5v11M2 8h12" /></svg>
);
export const DiffIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 2.5v6M2 5.5h6M8 11.5h6" /></svg>
);
export const BranchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.5 4.2" /></svg>
);
export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M5 3.5l7 4.5-7 4.5z" /></svg>
);
export const SidebarIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M6 2.5v11" /></svg>
);
export const SearchIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5l3 3" /></svg>
);
export const GlobeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="8" cy="8" r="5.8" /><path d="M2.2 8h11.6M8 2.2c1.7 1.7 2.4 3.6 2.4 5.8S9.7 12.1 8 13.8C6.3 12.1 5.6 10.2 5.6 8S6.3 3.9 8 2.2z" /></svg>
);
export const MoreIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="3.5" cy="8" r=".6" /><circle cx="8" cy="8" r=".6" /><circle cx="12.5" cy="8" r=".6" /></svg>
);
export const ReplyIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6.5 4L3 7.5 6.5 11" /><path d="M3 7.5h6.5a3.5 3.5 0 013.5 3.5v1" /></svg>
);
export const ArrowIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 8h10M9 4l4 4-4 4" /></svg>
);
export const ChevronIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M6 4l4 4-4 4" /></svg>
);
export const ArrowUpIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 13V3M4 7l4-4 4 4" /></svg>
);
export const StopIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" stroke="none" /></svg>
);
export const FileIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 2.5h5l3 3v8H4z" /><path d="M9 2.5v3h3" /></svg>
);
export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3.5 8.5l3 3 6-7" /></svg>
);
export const PenIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M10.5 3l2.5 2.5L6 12.5H3.5V10z" /><path d="M9 4.5l2.5 2.5" /></svg>
);
export const ShieldIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 1.8l5 1.9v4c0 3.1-2.1 5.4-5 6.5-2.9-1.1-5-3.4-5-6.5v-4z" /></svg>
);
/** Effort: bars filled up to `level` (0 = the account's default). */
export const GaugeIcon = ({ level = 0, ...p }: SVGProps<SVGSVGElement> & { level?: number }) => (
  <svg {...base(p)} stroke="none" fill="currentColor">
    {[0, 1, 2, 3, 4].map((i) => (
      <rect key={i} x={1.5 + i * 2.8} y={11 - i * 2} width={2} height={3 + i * 2} rx={0.6} opacity={level === 0 ? 0.55 : i < level ? 1 : 0.25} />
    ))}
  </svg>
);

/** The Aurelia jellyfish from assets/logo.svg, simplified for 16-20px. */
export const AureliaMark = (p: SVGProps<SVGSVGElement>) => (
  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden {...p}>
    <defs>
      <linearGradient id="aurelia-gold" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#ffd98a" />
        <stop offset="0.55" stopColor="#e9b04b" />
        <stop offset="1" stopColor="#b9792a" />
      </linearGradient>
    </defs>
    <path d="M3 12.2C3 6.9 7 4 12 4s9 2.9 9 8.2c-1.6-.5-2.9.4-4.2-.1-1-.4-1.6.4-2.4.4h-4.8c-.8 0-1.4-.8-2.4-.4-1.3.5-2.6-.4-4.2.1z" fill="url(#aurelia-gold)" />
    <g fill="none" stroke="url(#aurelia-gold)" strokeWidth="1.6" strokeLinecap="round">
      <path d="M7 14c-.5 1.8.8 3-.1 5" />
      <path d="M10.3 14.3c-.5 2 .8 3.2 0 5.7" />
      <path d="M13.7 14.3c.5 2-.8 3.2 0 5.7" />
      <path d="M17 14c.5 1.8-.8 3 .1 5" />
    </g>
  </svg>
);

/** A thread's state mark in the threads list: a small moon jellyfish (bio-blue while working). */
export const JellyIcon = ({ className, ...p }: SVGProps<SVGSVGElement>) => (
  <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden className={`bell${className ? ` ${className}` : ""}`} {...p}>
    <path d="M3 13C3 7.2 7 4 12 4s9 3.2 9 9c-2-.6-3 .5-4.5 0-1.4-.5-2 .5-4.5.5s-3.1-1-4.5-.5C6 13.5 5 12.4 3 13z" fill="currentColor" />
    <path d="M8 15.5v4M12 16v5M16 15.5v4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);
export const PhoneIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="4.5" y="1.5" width="7" height="13" rx="1.5" /><path d="M7 12.5h2" /></svg>
);
export const PrIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="12.5" r="1.5" /><path d="M4.5 5v6M11.5 11V6.5c0-1-.8-2-2-2H7.5M9 3l-1.5 1.5L9 6" /></svg>
);
export const WorktreeIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 14V8M8 8C8 5 5 4 3 4M8 8c0-3 3-4 5-4M3 2v4M13 2v4" /></svg>
);
export const BottomPanelIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M2.5 10h11" /></svg>
);
export const RightPanelIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" /><path d="M10 2.5v11" /></svg>
);
export const LogIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M3 4h10M3 8h10M3 12h6" /></svg>
);
export const ChevronDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
);
