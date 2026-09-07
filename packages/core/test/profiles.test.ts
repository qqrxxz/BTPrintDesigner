import { describe, expect, it } from 'vitest';
import {
  checkLabelWidth,
  customProfile,
  DEFAULT_PROFILE_ID,
  findProfile,
  PRINTER_PROFILES,
  profilesForLanguage,
} from '../src/printer/profiles.js';
import { SUPPORTED_DPI } from '../src/util/units.js';

describe('printer profiles', () => {
  it('has a unique id for every entry', () => {
    const ids = PRINTER_PROFILES.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only uses resolutions the renderer supports', () => {
    for (const profile of PRINTER_PROFILES) {
      expect(SUPPORTED_DPI).toContain(profile.dpi);
    }
  });

  it('gives every profile at least one language and a sane width', () => {
    for (const profile of PRINTER_PROFILES) {
      expect(profile.languages.length).toBeGreaterThan(0);
      expect(profile.maxWidthMm).toBeGreaterThan(10);
      expect(profile.maxWidthMm).toBeLessThan(300);
    }
  });

  it('finds the default profile', () => {
    expect(findProfile(DEFAULT_PROFILE_ID)).toBeDefined();
  });

  it('returns nothing for an id it does not know', () => {
    expect(findProfile('no-such-printer')).toBeUndefined();
  });

  it('lists printers by language', () => {
    expect(profilesForLanguage('tspl').every((p) => p.languages.includes('tspl'))).toBe(true);
    expect(profilesForLanguage('cpcl').length).toBeGreaterThan(0);
    expect(profilesForLanguage('zpl').some((p) => p.vendor === 'Zebra')).toBe(true);
  });

  it('offers a fallback at every supported resolution', () => {
    for (const dpi of SUPPORTED_DPI) {
      expect(PRINTER_PROFILES.some((p) => p.vendor === 'Generic' && p.dpi === dpi)).toBe(true);
    }
  });

  it('builds a profile for a printer not on the list', () => {
    const custom = customProfile(300, 80);
    expect(custom).toMatchObject({ dpi: 300, maxWidthMm: 80, vendor: 'Custom' });
  });

  it('says whether a label fits the head, and by how much it does not', () => {
    const profile = customProfile(203, 104);
    expect(checkLabelWidth(profile, 60)).toEqual({ fits: true, overflowMm: 0 });
    expect(checkLabelWidth(profile, 104)).toEqual({ fits: true, overflowMm: 0 });
    expect(checkLabelWidth(profile, 110.5)).toEqual({ fits: false, overflowMm: 6.5 });
  });
});
