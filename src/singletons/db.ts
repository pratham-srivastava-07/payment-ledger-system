import { PrismaClient } from "@prisma/client";

export class PrismaClass {
  private static instance: PrismaClient;

  static getInstance(): PrismaClient {
    if (!this.instance) {
      this.instance = new PrismaClient();
    }

    return this.instance;
  }
}
