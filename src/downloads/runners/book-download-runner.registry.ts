import { Injectable } from "@nestjs/common";
import type { Platform } from "../../shared/types/platform.type";
import type { BookDownloadRunner } from "./book-download-runner.interface";

@Injectable()
export class BookDownloadRunnerRegistry {
  private readonly runners = new Map<Platform, BookDownloadRunner>();

  constructor(...runners: BookDownloadRunner[]) {
    for (const runner of runners) {
      this.runners.set(runner.platform, runner);
    }
  }

  list(): BookDownloadRunner[] {
    return [...this.runners.values()];
  }

  resolve(platform: Platform): BookDownloadRunner {
    const runner = this.runners.get(platform);
    if (!runner) {
      throw new Error(`No download runner for platform: ${platform}`);
    }
    return runner;
  }
}
