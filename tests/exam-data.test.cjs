const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

test('bulk passing rechecks attendance before updating the result or member rank', async () => {
  const { api, docs, path, input, originalRank, targetRank, writes } = harness();
  await api.saveExamEntry(input);
  const before = writes();
  await assert.rejects(api.setExamResult('exam_member', 'passed', true), /참석 상태가 변경/);
  assert.equal(writes(), before);
  assert.deepEqual(docs.get(path('members', 'member')).rank, originalRank);
  await api.setExamAttendance('exam_member', true);
  await api.setExamResult('exam_member', 'passed', true);
  assert.equal(docs.get(path('examEntries', 'exam_member')).result, 'passed');
  assert.deepEqual(docs.get(path('members', 'member')).rank, targetRank);
  const after = writes();
  await api.setExamResult('exam_member', 'passed', true);
  assert.equal(writes(), after);
});

function harness() {
  const docs = new Map();
  let writes = 0;
  const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const ranks = {};
  vm.runInNewContext(compile('lib/member-rank.ts'), { exports: ranks });
  const reference = (...parts) => ({ path: parts.join('/'), id: parts.at(-1) });
  const firestore = {
    collection: (_db, ...parts) => reference(...parts),
    doc: (base, ...parts) => parts.length ? reference(...parts) : reference(base.path, 'new-exam'),
    serverTimestamp: () => 'server-time',
    runTransaction: async (_db, callback) => {
      const pending = [];
      const result = await callback({
        get: async ref => {
          assert.equal(pending.length, 0, 'Firestore requires all reads before writes');
          const value = docs.get(ref.path);
          return { exists: () => value !== undefined, data: () => structuredClone(value) };
        },
        set: (ref, value) => pending.push(['set', ref.path, value]),
        update: (ref, value) => pending.push(['update', ref.path, value]),
        delete: ref => pending.push(['delete', ref.path]),
      });
      for (const [operation, path, value] of pending) {
        if (operation === 'delete') docs.delete(path);
        else docs.set(path, structuredClone(operation === 'update' ? { ...docs.get(path), ...value } : value));
        writes++;
      }
      return result;
    },
  };
  const api = {};
  vm.runInNewContext(compile('lib/exam-data.ts'), {
    exports: api,
    require: name => name === 'firebase/firestore' ? firestore
      : name === '@/lib/member-rank' ? ranks
        : name === '@/lib/dojo-data' ? { LOCATION_ID: 'main' } : { db: {} },
  });
  const path = (collection, id) => `locations/main/${collection}/${id}`;
  const originalRank = { belt: 'white', dan: 3 };
  const targetRank = { belt: 'yellow', dan: 3 };
  docs.set(path('members', 'member'), { name: '동일 이름', phone: '010-1234-5678', rank: originalRank });
  docs.set(path('exams', 'exam'), { title: '11월 심사', date: '2026-11-09', time: '19:00', dates: [{ date: '2026-11-09', time: '19:00' }, { date: '2026-11-11', time: '20:00' }] });
  const input = { examId: 'exam', memberId: 'member', examDate: '2026-11-11', examTime: '20:00', examRank: originalRank, targetRank, stage: 1, course: 'dan-beginner', memo: '통합 심사' };
  return { api, ranks, docs, path, input, originalRank, targetRank, writes: () => writes };
}

test('multiple dates in one month persist, with a specific session for each applicant', async () => {
  const { api, docs, path, input } = harness();
  const id = await api.saveExam({ title: '11월 심사', date: '2026-11-11', time: '', dates: [{ date: '2026-11-11', time: '20:00' }, { date: '2026-11-09', time: '19:00' }] });
  assert.equal(docs.get(path('exams', id)).date, '2026-11-09');
  assert.equal(docs.get(path('exams', id)).dates.length, 2);
  assert.equal('location' in docs.get(path('exams', id)), false);
  await assert.rejects(api.saveExam({ title: '중복 월', date: '2026-11-20', time: '' }), /이미 등록된 월/);
  await api.saveExam({ title: '11월 수정', date: '2026-11-20', time: '' }, id);
  assert.equal(docs.get(path('exams', id)).title, '11월 수정');
  await assert.rejects(api.saveExam({ title: '월 이동', date: '2026-12-20', time: '' }, id), /월은 변경/);
  await api.saveExamEntry(input);
  assert.equal(docs.get(path('examEntries', 'exam_member')).examDate, '2026-11-11');
  await assert.rejects(api.saveExamEntry(input), /이미 등록/);
  await assert.rejects(api.saveExamEntry({ ...input, memberId: 'missing' }), /찾지 못/);
  await assert.rejects(api.saveExamEntry({ ...input, examDate: '2026-11-12' }, true), /심사일과 시간/);
});

test('invalid and duplicated sessions do not write data', async () => {
  const { api, writes } = harness();
  const cases = [
    [{ date: '2026-02-30', time: '' }],
    [{ date: '2026-11-09', time: '19:00' }, { date: '2026-11-09', time: '19:00' }],
    [{ date: '2026-11-09', time: '' }, { date: '2026-12-09', time: '' }],
    [{ date: '2026-11-09', time: '25:00' }],
  ];
  for (const dates of cases) await assert.rejects(api.saveExam({ title: '심사', date: dates[0].date, time: '', dates }));
  assert.equal(writes(), 0);
});

test('black belts require 1 to 9 dan; held dan can coexist with a white dojo belt', () => {
  const { ranks } = harness();
  assert.equal(ranks.validRank({ belt: 'black', dan: 1 }), true);
  assert.equal(ranks.validRank({ belt: 'black', dan: 9 }), true);
  assert.equal(ranks.validRank({ belt: 'black', dan: 0 }), false);
  assert.equal(ranks.validRank({ belt: 'black', dan: 10 }), false);
  assert.equal(ranks.validRank({ belt: 'white', dan: 3 }), true);
});

test('record-only passing keeps the member rank and marks examination attendance', async () => {
  const { api, docs, path, input, originalRank } = harness();
  await api.saveExamEntry({ ...input, targetRank: null });
  await api.setExamResult('exam_member', 'passed');
  assert.deepEqual(docs.get(path('members', 'member')).rank, originalRank);
  assert.equal(docs.get(path('examEntries', 'exam_member')).attended, true);
});

test('passing updates rank atomically, preserves held dan, and repeated passing has no effect', async () => {
  const { api, docs, path, input, targetRank, originalRank, writes } = harness();
  await api.saveExamEntry(input);
  await api.setExamResult('exam_member', 'passed');
  assert.deepEqual(docs.get(path('members', 'member')).rank, targetRank);
  assert.deepEqual(docs.get(path('examEntries', 'exam_member')).rankBefore, originalRank);
  const count = writes();
  await api.setExamResult('exam_member', 'passed');
  assert.equal(writes(), count);
  await assert.rejects(api.saveExamEntry(input, true), /대기로/);
  await assert.rejects(api.deleteExamEntry('exam_member'), /대기로/);
});

test('correcting a pass restores the previous rank and promotion source', async () => {
  const { api, docs, path, input, originalRank } = harness();
  await api.saveExamEntry(input);
  await api.setExamResult('exam_member', 'passed');
  await api.setExamResult('exam_member', 'pending');
  assert.deepEqual(docs.get(path('members', 'member')).rank, originalRank);
  assert.equal(docs.get(path('members', 'member')).rankSource, null);
  await api.deleteExamEntry('exam_member');
  assert.equal(docs.has(path('examEntries', 'exam_member')), false);
});

test('historical result changes cannot undo a newer promotion', async () => {
  const { api, docs, path, input, writes } = harness();
  await api.saveExamEntry(input);
  await api.setExamResult('exam_member', 'passed');
  docs.set(path('members', 'member'), { rank: { belt: 'blue', dan: 3 }, rankSource: { entryId: 'newer', examDate: '2026-12-01' } });
  const count = writes();
  await assert.rejects(api.setExamResult('exam_member', 'failed'), /최근/);
  assert.equal(writes(), count);
  assert.equal(docs.get(path('examEntries', 'exam_member')).result, 'passed');
});

test('manual rank overrides survive corrections and nonpassing results', async () => {
  const { api, docs, path, input } = harness();
  await api.saveExamEntry(input);
  await api.setExamResult('exam_member', 'passed');
  docs.set(path('members', 'member'), { rank: { belt: 'red', dan: 4 }, rankSource: null });
  await api.setExamResult('exam_member', 'failed');
  assert.equal(docs.get(path('members', 'member')).rank.belt, 'red');
  await api.setExamResult('exam_member', 'absent');
  assert.equal(docs.get(path('examEntries', 'exam_member')).attended, false);
});
