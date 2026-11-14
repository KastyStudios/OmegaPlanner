import { describe, expect, it } from 'vitest';
import { darken, itemColors, textOn } from './eventColors';

describe('item colors', () => {
  it('picks readable text', () => {
    expect(textOn('#fef9c3')).toBe('#0f172a');
    expect(textOn('#4f46e5')).toBe('#ffffff');
    expect(textOn('#ffffff')).toBe('#0f172a');
    expect(textOn('#000000')).toBe('#ffffff');
  });
  it('darkens for the border', () => {
    expect(darken('#ffffff', 0.5)).toBe('#808080');
  });
  it('prefers the item color, then the default, then the theme variables', () => {
    expect(itemColors('#dcfce7', '#fee2e2').bg).toBe('#dcfce7');
    expect(itemColors(undefined, '#fee2e2').bg).toBe('#fee2e2');
    expect(itemColors(undefined, null)).toEqual({ bg: 'var(--op-event-bg)', fg: 'var(--op-event-fg)', border: 'var(--op-event-border)' });
  });
});
