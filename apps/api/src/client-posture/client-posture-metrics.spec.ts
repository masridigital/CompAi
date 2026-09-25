import {
  averageScore,
  getControlStatus,
  toFrameworkScores,
} from './client-posture-metrics';
import { scoredFrameworkSchema } from './client-posture.types';

const NOW = new Date('2026-09-25T00:00:00.000Z').getTime();

describe('getControlStatus (port of app control-compliance)', () => {
  it('is completed when all artifacts are done', () => {
    expect(
      getControlStatus({
        control: {
          policies: [{ status: 'published' }],
          documentTypes: [],
          tasks: [{ status: 'done' }, { status: 'not_relevant' }],
        },
        evidenceSubmissions: [],
        now: NOW,
      }),
    ).toBe('completed');
  });

  it('is not_started when nothing has progressed', () => {
    expect(
      getControlStatus({
        control: {
          policies: [{ status: 'draft' }],
          documentTypes: [],
          tasks: [{ status: 'todo' }],
        },
        evidenceSubmissions: [],
        now: NOW,
      }),
    ).toBe('not_started');
  });

  it('treats evidence older than six months as stale', () => {
    expect(
      getControlStatus({
        control: {
          policies: [],
          documentTypes: [{ formType: 'meeting' }],
          tasks: [],
        },
        evidenceSubmissions: [
          { formType: 'meeting', submittedAt: '2025-01-01T00:00:00.000Z' },
        ],
        now: NOW,
      }),
    ).toBe('in_progress');
  });

  it('is not_relevant when only not-relevant documents are required', () => {
    expect(
      getControlStatus({
        control: {
          policies: [],
          documentTypes: [{ formType: 'meeting', isNotRelevant: true }],
          tasks: [],
        },
        evidenceSubmissions: [],
        now: NOW,
      }),
    ).toBe('not_relevant');
  });
});

describe('toFrameworkScores / averageScore', () => {
  it('clamps and names framework scores', () => {
    const frameworks = [
      scoredFrameworkSchema.parse({ id: 'fri_1', complianceScore: 104.6 }),
    ];
    expect(toFrameworkScores(frameworks)).toEqual([
      { frameworkId: 'fri_1', name: 'Framework', score: 100 },
    ]);
  });

  it('averages scores and handles empty input', () => {
    expect(averageScore([])).toBe(0);
    expect(
      averageScore([
        { frameworkId: 'a', name: 'A', score: 50 },
        { frameworkId: 'b', name: 'B', score: 75 },
      ]),
    ).toBe(63);
  });
});
