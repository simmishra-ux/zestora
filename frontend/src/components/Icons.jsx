// Tiny inline SVG icon set (no icon library = smaller bundle). All icons inherit `currentColor`.
const base = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
const make = (d) => (props) => <svg {...base} {...props}>{d}</svg>

export const SearchIcon = make(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>)
export const MicIcon = make(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></>)
export const CartIcon = make(<><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.5L20.5 8H6" /><circle cx="10" cy="20.5" r="1.2" /><circle cx="17" cy="20.5" r="1.2" /></>)
export const HeartIcon = make(<path d="M12 20.5s-7.5-4.6-9-9.6A5 5 0 0 1 12 6.6a5 5 0 0 1 9 4.3c-1.5 5-9 9.6-9 9.6Z" />)
export const UserIcon = make(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>)
export const HomeIcon = make(<path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1Z" />)
export const GridIcon = make(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>)
export const BoxIcon = make(<><path d="M21 8 12 3 3 8v8l9 5 9-5Z" /><path d="m3 8 9 5 9-5M12 13v8" /></>)
export const CloseIcon = make(<path d="M6 6l12 12M18 6 6 18" />)
export const FilterIcon = make(<path d="M3 5h18M6 12h12M10 19h4" />)
export const TruckIcon = make(<><path d="M2 6h11v10H2zM13 10h4l4 3v3h-8" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></>)
export const ShieldIcon = make(<><path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6Z" /><path d="m9 12 2 2 4-4" /></>)
export const RefreshIcon = make(<><path d="M20 11a8 8 0 0 0-14.5-4M4 5v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4M20 19v-4h-4" /></>)
export const HeadsetIcon = make(<><path d="M4 14v-2a8 8 0 0 1 16 0v2" /><rect x="3" y="14" width="4" height="6" rx="1.5" /><rect x="17" y="14" width="4" height="6" rx="1.5" /></>)
export const TrashIcon = make(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>)
export const CheckIcon = make(<path d="m5 12.5 4.5 4.5L19 7.5" />)
