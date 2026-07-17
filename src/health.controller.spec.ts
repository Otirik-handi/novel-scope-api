import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns service availability', () => {
    expect(new HealthController().health()).toEqual({ status: 'ok' });
  });
});
