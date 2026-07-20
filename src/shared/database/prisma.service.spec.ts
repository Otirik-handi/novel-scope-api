import { PrismaService } from "./prisma.service";

describe("PrismaService", () => {
  it("connects when its module initializes", async () => {
    const service = new PrismaService();
    const connect = jest.spyOn(service, "$connect").mockResolvedValue(undefined);

    await service.onModuleInit();

    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("disconnects when its module is destroyed", async () => {
    const service = new PrismaService();
    const disconnect = jest
      .spyOn(service, "$disconnect")
      .mockResolvedValue(undefined);

    await service.onModuleDestroy();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
