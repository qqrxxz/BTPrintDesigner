import opentype from 'opentype.js';
import { Path } from '../raster/Path.js';

export interface Glyph {
  /**
   * Outline in font units, y pointing down, baseline at y = 0.
   *
   * Font units rather than dots so one parsed glyph serves every size and every
   * resolution; the caller scales at draw time.
   */
  readonly path: Path;
  readonly advanceWidth: number;
  readonly isMissing: boolean;
}

/**
 * A TrueType/OpenType face, used as a stand-in for a printer's resident font.
 *
 * The printers we target render text from bitmap fonts burnt into their ROM,
 * which we cannot obtain as files. A metrically comparable outline font answers
 * the question the preview exists for — does this text fit, does it collide —
 * while making no claim about the exact shape of any letter.
 */
export class Font {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly familyName: string;

  private readonly font: opentype.Font;
  private readonly glyphCache = new Map<number, Glyph>();

  private constructor(font: opentype.Font) {
    this.font = font;
    this.unitsPerEm = font.unitsPerEm;
    this.ascender = font.ascender;
    this.descender = font.descender;
    this.familyName = font.names.fontFamily?.en ?? 'unknown';
  }

  static fromBuffer(data: ArrayBuffer | Uint8Array): Font {
    const buffer =
      data instanceof Uint8Array
        ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
        : data;
    return new Font(opentype.parse(buffer));
  }

  /** Distance from the top of the line box to the baseline, in font units. */
  get lineAscent(): number {
    return this.ascender;
  }

  /** Distance from the baseline to the bottom of the line box, positive. */
  get lineDescent(): number {
    return -this.descender;
  }

  get lineHeight(): number {
    return this.ascender - this.descender;
  }

  hasGlyph(codePoint: number): boolean {
    return this.font.charToGlyphIndex(String.fromCodePoint(codePoint)) > 0;
  }

  /**
   * Looks up one character.
   *
   * A character the font does not cover comes back as the .notdef glyph with
   * `isMissing` set, so a caller can flag it rather than silently print a blank
   * where the label was supposed to say something.
   */
  glyph(codePoint: number): Glyph {
    const cached = this.glyphCache.get(codePoint);
    if (cached) return cached;

    const character = String.fromCodePoint(codePoint);
    const index = this.font.charToGlyphIndex(character);
    const source = this.font.charToGlyph(character);
    // getPath at a size equal to unitsPerEm keeps font units while flipping y
    // to point down, which is the orientation the rasteriser works in.
    const outline = source.getPath(0, 0, this.unitsPerEm);

    const path = new Path();
    for (const command of outline.commands) {
      switch (command.type) {
        case 'M':
          path.moveTo(command.x, command.y);
          break;
        case 'L':
          path.lineTo(command.x, command.y);
          break;
        case 'Q':
          path.quadTo(command.x1, command.y1, command.x, command.y);
          break;
        case 'C':
          path.cubicTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y);
          break;
        case 'Z':
          path.close();
          break;
      }
    }

    const glyph: Glyph = {
      path,
      advanceWidth: source.advanceWidth ?? 0,
      isMissing: index === 0,
    };
    this.glyphCache.set(codePoint, glyph);
    return glyph;
  }
}
