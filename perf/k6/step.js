// Optional independent stress step; reuses the frozen real-contract journeys.
import { options as baseOptions, journey, stream, handleSummary } from './journeys.js';

export { journey, stream, handleSummary };

const users = Number(__ENV.VUS);
if (!Number.isInteger(users) || users < 1 || users > 1024) {
  throw new Error('VUS must be 1..1024 for a guarded local stress step');
}
export const options = {
  ...baseOptions,
  scenarios: {
    ordinary: {
      ...baseOptions.scenarios.ordinary,
      stages: [
        { duration: '30s', target: users },
        { duration: __ENV.HOLD || '120s', target: users },
        { duration: '30s', target: 0 },
      ],
    },
  },
};
