import { describe, expect, it } from 'vitest';
import { columnName, evaluateSheet, parseCellKey, rangeKeys } from './spreadsheet.js';

describe('spreadsheet helpers', () => {
  it('converts column names and cell keys', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(parseCellKey('AA12')).toEqual({ row: 11, col: 26 });
  });

  it('expands ranges', () => {
    expect(rangeKeys('A1', 'B2')).toEqual(['A1', 'B1', 'A2', 'B2']);
  });

  it('evaluates arithmetic, references and aggregate formulas', () => {
    const result = evaluateSheet({
      A1: '4',
      A2: '6',
      B1: '=A1+A2',
      B2: '=SUM(A1:B1)',
      C1: '=AVERAGE(A1:A2)'
    });
    expect(result.B1).toBe('10');
    expect(result.B2).toBe('14');
    expect(result.C1).toBe('5');
  });

  it('detects circular references and rejects arbitrary code', () => {
    const result = evaluateSheet({
      A1: '=B1',
      B1: '=A1',
      C1: '=globalThis.alert(1)'
    });
    expect(result.A1).toBe('#DÖNGÜ');
    expect(result.C1).toBe('#HATA');
  });
});

