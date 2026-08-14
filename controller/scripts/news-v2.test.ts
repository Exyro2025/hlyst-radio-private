import assert from 'node:assert/strict';
import test from 'node:test';

const toolUrl = new URL('../src/skills/builtins/news-v2/tool.mjs', import.meta.url);
const { default: runTool } = await import(toolUrl.href);

function services() {
  const durable = new Set<string>();
  return {
    fetchMusicNews: async () => [{
      id: 'music-1', headline: 'Metallica announce an intimate UK show', artist: 'Metallica',
      artistGenres: ['Heavy Metal'], provider: 'stereogum.com', sourceLabel: 'Stereogum',
      url: 'https://stereogum.com/metallica', retrievedAt: '2026-08-14T10:00:00Z',
    }],
    relevantMusicNews: (items) => items,
    safeGeneralHeadline: () => true,
    fetchHeadlines: async () => [{
      title: 'Museum opens a new music exhibition', description: 'not evidence',
      url: 'https://bbc.co.uk/news/museum', publishedAt: '2026-08-14T09:00:00Z',
    }],
    hashHeadline: (value) => String(value.length),
    recall: {
      seen: (key) => durable.has(key),
      remember: (key) => durable.add(key),
    },
  };
}

test('News v2 alternates music and general pools when both are available', async () => {
  const state: any = {};
  const svc = services();
  const first = await runTool({ activeShow: { genres: ['Heavy Metal'] } }, state, svc);
  const second = await runTool({ activeShow: { genres: ['Heavy Metal'] } }, state, svc);
  assert.equal(first.available, true);
  assert.equal(first.subject.topic, 'music-news');
  assert.equal(second.available, true);
  assert.equal(second.subject.topic, 'general-news');
  assert.ok(!JSON.stringify(second).includes('not evidence'));
});

test('News v2 degrades to the surviving pool when one feed fails', async () => {
  const svc = services();
  svc.fetchMusicNews = async () => { throw new Error('music feeds down'); };
  const result = await runTool({}, {}, svc);
  assert.equal(result.available, true);
  assert.equal(result.subject.topic, 'general-news');
});

test('a local library relevance failure does not suppress general news', async () => {
  const svc = services();
  svc.relevantMusicNews = () => { throw new Error('library index unavailable'); };
  const result = await runTool({}, {}, svc);
  assert.equal(result.available, true);
  assert.equal(result.subject.topic, 'general-news');
});
