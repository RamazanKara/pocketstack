function Icon({ children, viewBox = "0 0 24 24" }) {
  return <svg viewBox={viewBox} aria-hidden="true">{children}</svg>;
}

export const BoardIcon = () => <Icon><rect x="3" y="3" width="7" height="18" rx="1" /><rect x="14" y="3" width="7" height="11" rx="1" /></Icon>;
export const ListIcon = () => <Icon><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></Icon>;
export const ChartIcon = () => <Icon><path d="M4 20V10h4v10M10 20V4h4v16M16 20v-7h4v7M2 20h20" /></Icon>;
export const TagIcon = () => <Icon><path d="m3 12 9 9 9-9-9-9H5a2 2 0 0 0-2 2Z" /><circle cx="8" cy="8" r="1.2" /></Icon>;
export const GearIcon = () => <Icon><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l2-1.5-2-3.4-2.4 1A8 8 0 0 0 14 5V2h-4v3a8 8 0 0 0-2.6 1.6l-2.4-1L3 9l2 1.5v3L3 15l2 3.4 2.4-1A8 8 0 0 0 10 19v3h4v-3a8 8 0 0 0 2.6-1.6l2.4 1 2-3.4Z" /></Icon>;
export const FilterIcon = () => <Icon><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></Icon>;
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
