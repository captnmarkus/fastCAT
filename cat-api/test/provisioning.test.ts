import { test } from "node:test";
import assert from "node:assert/strict";
import { runProvisionSeeding, type ProvisionSeedTask } from "../src/lib/provisioning.js";

test("provisioning seeding runs TMX for eligible tasks and LLM for all tasks", async () => {
  const tasks: ProvisionSeedTask[] = [
    { taskId: 1, fileId: 10, targetLang: "de", tmxId: 5, engineId: 100 },
    { taskId: 2, fileId: 10, targetLang: "fr", tmxId: null, engineId: 101 },
    { taskId: 3, fileId: 11, targetLang: "de", tmxId: 7, engineId: null }
  ];

  const tmxCalls: number[] = [];
  let llmTasks: ProvisionSeedTask[] = [];

  await runProvisionSeeding({
    tasks,
    enableTmx: true,
    enableLlm: true,
    seedTmxTask: async (task) => {
      tmxCalls.push(task.taskId);
    },
    enqueueLlm: async (allTasks) => {
      llmTasks = allTasks;
    }
  });

  assert.deepEqual(
    tmxCalls,
    tasks.filter((task) => task.tmxId != null).map((task) => task.taskId)
  );
  assert.equal(llmTasks.length, tasks.length);
  assert.deepEqual(
    llmTasks.map((task) => task.taskId),
    tasks.map((task) => task.taskId)
  );
});
