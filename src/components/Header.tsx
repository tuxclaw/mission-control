import { useState, useRef, useEffect } from 'react';
import { Zap, Wifi, User, Palette, ChevronDown } from 'lucide-react';
import { useClock } from '../hooks/useClock';
import { useTheme } from '../hooks/useTheme';

export function Header() {
  const { clock, date } = useClock();
  const { theme, setTheme, themes } = useTheme();
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const currentTheme = themes.find((t) => t.id === theme);

  return (
    <header className="header flex items-center justify-between px-5 py-3 border-b" role="banner">
      <div className="flex items-center gap-2">
        <Zap size={20} className="header__logo" aria-hidden="true" />
        <span className="header__logo text-lg font-bold tracking-wide">ANDY</span>
        <span className="header__subtitle text-lg font-light tracking-widest">MISSION CONTROL</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="header__status-badge glow-green flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium" role="status" aria-label="Connection status: connected">
          <Wifi size={12} aria-hidden="true" />
          Connected
        </div>

        <div className="text-right" aria-label={`Current time: ${clock}, ${date}`}>
          <div className="header__clock text-sm font-mono font-semibold">{clock}</div>
          <div className="header__date text-xs">{date} · PST</div>
        </div>

        {/* Theme selector */}
        <div className="theme-selector" ref={dropdownRef}>
          <button
            className="theme-selector__trigger"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Theme: ${currentTheme?.label}. Click to change theme.`}
          >
            <Palette size={14} aria-hidden="true" />
            <span className="theme-selector__label">{currentTheme?.label}</span>
            <ChevronDown size={12} aria-hidden="true" className={`theme-selector__chevron${open ? ' theme-selector__chevron--open' : ''}`} />
          </button>
          {open && (
            <ul className="theme-selector__dropdown" role="listbox" aria-label="Select theme">
              {themes.map((t) => (
                <li key={t.id} role="option" aria-selected={t.id === theme}>
                  <button
                    className={`theme-selector__option${t.id === theme ? ' theme-selector__option--active' : ''}`}
                    onClick={() => { setTheme(t.id); setOpen(false); }}
                  >
                    <span className="theme-selector__dot" style={{ background: t.previewColor }} />
                    {t.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="header__divider flex items-center gap-2 pl-4 border-l">
          <div className="header__avatar w-8 h-8 rounded-full flex items-center justify-center">
            <User size={14} className="header__avatar-icon" aria-hidden="true" />
          </div>
          <div>
            <div className="text-xs font-medium">tux</div>
            <div className="header__user-role text-xs">operator</div>
          </div>
        </div>
      </div>
    </header>
  );
}
