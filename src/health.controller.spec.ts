import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns liveness without accessing persistence', () => {
    const prisma = { $queryRaw: jest.fn() };
    const controller = new HealthController(prisma as never);

    expect(controller.live()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('keeps the legacy health route as a liveness alias', () => {
    const prisma = { $queryRaw: jest.fn() };
    const controller = new HealthController(prisma as never);

    expect(controller.health()).toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('returns readiness after checking Prisma connectivity', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const controller = new HealthController(prisma as never);

    await expect(controller.ready()).resolves.toEqual({ status: 'ok' });
    expect(prisma.$queryRaw).toHaveBeenCalledWith`SELECT 1`;
  });
});
