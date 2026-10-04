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
export const SplitDownIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M2 8h12" /></svg>
);
export const CloseIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
export const PlusIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 3v10M3 8h10" /></svg>
);
export const SparkIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><path d="M8 1.8l1.5 4.2 4.3 1.6-4.3 1.6L8 13.4 6.5 9.2 2.2 7.6l4.3-1.6z" /></svg>
);
export const PanelIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}><rect x="2" y="2.5" width="12" height="11" rx="2" /><path d="M10 2.5v11" /></svg>
);
export const GearIcon = (p: SVGProps<SVGSVGElement>) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
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
