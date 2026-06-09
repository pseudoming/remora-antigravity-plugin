import { randomUUID } from "node:crypto";
import { runTopicGarbageCollection, setTraceId } from "@remora/core";

export function runGarbageCollection(): void {
  runTopicGarbageCollection();
}

export function main(): void {
  setTraceId(`c_${randomUUID().slice(0, 8)}`);
  runGarbageCollection();
}
