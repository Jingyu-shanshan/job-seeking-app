import { changedWords, wordDiff } from './word-diff';

describe('wordDiff', () => {
  it('marks the words removed and added, removed first, keeping the rest', () => {
    const parts = wordDiff(
      'Built the invoice API in Go; cut processing time by about 30%',
      'Built an invoice API in Go and cut its processing time by 30%.',
    );
    expect(parts).toEqual([
      { text: 'Built ', kind: 'same' },
      { text: 'the', kind: 'removed' },
      { text: 'an', kind: 'added' },
      { text: ' invoice API in Go', kind: 'same' },
      { text: ';', kind: 'removed' },
      { text: ' ', kind: 'same' },
      { text: 'and ', kind: 'added' },
      { text: 'cut ', kind: 'same' },
      { text: 'its ', kind: 'added' },
      { text: 'processing time by ', kind: 'same' },
      { text: 'about ', kind: 'removed' },
      { text: '30%', kind: 'same' },
      { text: '.', kind: 'added' },
    ]);
    expect(changedWords(parts)).toBe(7);
  });

  it('treats any run of spaces alike, and keeps the case of words', () => {
    expect(wordDiff('Go  and\nKafka', 'Go and kafka')).toEqual([
      { text: 'Go and ', kind: 'same' },
      { text: 'Kafka', kind: 'removed' },
      { text: 'kafka', kind: 'added' },
    ]);
  });

  it('handles empty texts', () => {
    expect(wordDiff('', 'New text')).toEqual([{ text: 'New text', kind: 'added' }]);
    expect(wordDiff('Old', '')).toEqual([{ text: 'Old', kind: 'removed' }]);
    expect(wordDiff('', '')).toEqual([]);
  });
});
