import { ITEM_COLOR_PRESETS, itemColors, textOn, useDefaultItemColor, type ItemColors } from '../lib/eventColors';

/**
 * Swatches + custom color. `value` '' means "use the default color"; pass `allowDefault={false}`
 * where a concrete color is required.
 */
export function ColorPicker({
  value,
  onChange,
  allowDefault = true,
  defaultLabel = 'Default',
  defaultSwatch,
}: {
  value: string;
  onChange: (color: string) => void;
  allowDefault?: boolean;
  defaultLabel?: string;
  /** Colors of the "default" button; defaults to the current default item color. */
  defaultSwatch?: Pick<ItemColors, 'bg' | 'fg'>;
}) {
  const defaultColor = useDefaultItemColor();
  const def = defaultSwatch ?? itemColors(undefined, defaultColor);
  const isCustom = !!value && !ITEM_COLOR_PRESETS.includes(value.toLowerCase());
  const ring = 'ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900';

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {allowDefault && (
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => onChange('')}
          className={`h-7 rounded-md border border-slate-300 px-2 text-xs font-medium dark:border-slate-600 ${!value ? ring : ''}`}
          style={{ background: def.bg, color: def.fg }}
        >
          {defaultLabel}
        </button>
      )}
      {ITEM_COLOR_PRESETS.map((c) => (
        <button
          key={c}
          type="button"
          aria-label={`Color ${c}`}
          aria-pressed={value.toLowerCase() === c}
          onClick={() => onChange(c)}
          className={`flex h-7 w-7 items-center justify-center rounded-md border border-black/10 text-xs ${value.toLowerCase() === c ? ring : ''}`}
          style={{ background: c, color: textOn(c) }}
        >
          {value.toLowerCase() === c ? '✓' : ''}
        </button>
      ))}
      <label
        className={`relative flex h-7 cursor-pointer items-center gap-1 rounded-md border border-slate-300 px-2 text-xs font-medium dark:border-slate-600 ${isCustom ? ring : ''}`}
        style={isCustom ? { background: value, color: textOn(value) } : undefined}
        title="Pick any color"
      >
        Custom…
        <input
          type="color"
          value={value || '#e0e7ff'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label="Custom color"
        />
      </label>
    </div>
  );
}
