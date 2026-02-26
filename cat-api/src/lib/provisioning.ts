export type ProvisionSeedTask = {
  taskId: number;
  fileId: number;
  targetLang: string;
  tmxId: number | null;
  engineId: number | null;
};

export async function runProvisionSeeding(params: {
  tasks: ProvisionSeedTask[];
  enableTmx: boolean;
  enableLlm: boolean;
  seedTmxTask: (task: ProvisionSeedTask) => Promise<void>;
  enqueueLlm: (tasks: ProvisionSeedTask[]) => Promise<void>;
}) {
  const tasks = Array.isArray(params.tasks) ? params.tasks : [];

  if (params.enableTmx) {
    for (const task of tasks) {
      if (task.tmxId != null) {
        await params.seedTmxTask(task);
      }
    }
  }

  if (params.enableLlm) {
    await params.enqueueLlm(tasks);
  }
}
